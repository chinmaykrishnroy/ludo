import { io } from "socket.io-client";
import { legalMoves, soleLegalMove } from "../build/shared/game.js";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
const driverLoop = monitorEventLoopDelay({ resolution: 20 });
driverLoop.enable();
if (process.env.LOAD_CONFIRM_DISPOSABLE !== "1")
  throw new Error(
    "This test requires LOAD_CONFIRM_DISPOSABLE=1 and an isolated server",
  );
const url = process.env.LOAD_URL,
  admin = process.env.ADMIN_TOKEN;
if (!url || !admin)
  throw new Error("LOAD_URL and an isolated ADMIN_TOKEN are required");
const levels = (
    process.env.STRESS_LEVELS ??
    "8,25,50,100,200,350,500,750,1000,1500,2000,3000,5000"
  )
    .split(",")
    .map(Number),
  duration = Number(process.env.STRESS_STAGE_SECONDS ?? 20);
if (
  levels.some((n) => !Number.isInteger(n) || n < 1 || n > 5000) ||
  duration < 10 ||
  duration > 120
)
  throw new Error("Invalid bounded stress configuration");
const audio = await readFile(process.env.LOAD_AUDIO_FILE),
  tables = [],
  guests = [],
  stages = [];
let serial = 0,
  stopping = false,
  hardStop = null,
  totalReplies = 0,
  totalChatDeliveries = 0,
  peakConnectedUsers = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  quantile = (values, q) =>
    values.length
      ? [...values].sort((a, b) => a - b)[
          Math.min(values.length - 1, Math.floor(values.length * q))
        ]
      : 0;
let accepted = {},
  samples = {},
  codes = {},
  failures = [],
  peakRss = 0,
  peakLoop = 0,
  inflight = new Set();
function remember(event, ms) {
  const a = (samples[event] ??= []);
  if (a.length < 50000) a.push(ms);
  totalReplies++;
}
function reason(error) {
  return (
    String(error?.message ?? error) +
    (error?.cause
      ? " [" +
        (error.cause.code ?? "") +
        " " +
        (error.cause.message ?? "") +
        "]"
      : "")
  ).slice(0, 200);
}
async function call(guest, event, data = {}) {
  const start = performance.now();
  try {
    const reply = await guest.socket.timeout(10000).emitWithAck(event, data);
    remember(event, performance.now() - start);
    if (reply.ok) accepted[event] = (accepted[event] ?? 0) + 1;
    if (!reply.ok) {
      const code = reply.code ?? "INVALID_ACTION";
      codes[code] = (codes[code] ?? 0) + 1;
      if (
        ![
          "STALE_REVISION",
          "WRONG_TURN",
          "ANIMATION_PENDING",
          "TURN_EXPIRED",
          "RATE_LIMITED",
          "VOICE_CAPACITY",
          "SERVER_BUSY",
        ].includes(code)
      )
        failures.push({ event, code, error: reply.error });
    }
    return reply;
  } catch (error) {
    remember(event, performance.now() - start);
    failures.push({ event, code: "TRANSPORT_FAILURE", error: reason(error) });
    return { ok: false, code: "TRANSPORT_FAILURE" };
  }
}
async function guest() {
  const n = ++serial,
    ip = `198.18.${Math.floor(n / 256)}.${n % 256}`;
  const response = await fetch(url + "/api/session", {
    headers: { "X-Forwarded-For": ip },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Session admission ${response.status}`);
  const cookie = response.headers.get("set-cookie").split(";")[0],
    socket = io(url, {
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie, "X-Forwarded-For": ip },
    }),
    g = { socket, cookie, ip, table: null, lastChat: null };
  await response.arrayBuffer();
  guests.push(g);
  socket.on("room:state", (room) => {
    if (!g.table) return;
    if (!g.table.room || room.updatedAt >= g.table.room.updatedAt)
      g.table.room = room;
    const last = room.chat.at(-1)?.id;
    if (last && last !== g.lastChat) totalChatDeliveries++;
    g.lastChat = last;
  });
  socket.connect();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Connection admission timed out")),
      10000,
    );
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  peakConnectedUsers = Math.max(
    peakConnectedUsers,
    guests.filter((g) => g.socket.connected).length,
  );
  return g;
}
async function addTable() {
  const a = await guest(),
    b = await guest(),
    created = await call(a, "room:create", {
      name: "Capacity " + tables.length,
      playerName: "Stress Alpha",
      public: false,
      bots: 0,
    });
  if (!created.ok) {
    a.socket.disconnect();
    b.socket.disconnect();
    throw Object.assign(
      new Error("Room admission: " + (created.error ?? created.code)),
      { code: created.code },
    );
  }
  const table = {
    room: created.room,
    guests: [a, b],
    ids: [created.me],
    gameAt: performance.now() + Math.random() * 1200,
    chatAt: performance.now() + Math.random() * 5000,
    voiceAt: performance.now() + Math.random() * 30000,
    busy: false,
    chatBusy: false,
    voiceBusy: false,
  };
  a.table = b.table = table;
  const joined = await call(b, "room:join", {
    code: created.room.code,
    playerName: "Stress Beta",
  });
  if (!joined.ok) throw new Error("Join admission: " + joined.error);
  table.ids.push(joined.me);
  const started = await call(a, "room:start");
  if (!started.ok) {
    await call(a, "room:leave");
    await call(b, "room:leave");
    a.socket.disconnect();
    b.socket.disconnect();
    throw Object.assign(new Error("Start: " + started.error), {
      code: started.code,
    });
  }
  tables.push(table);
}
async function health() {
  const r = await fetch(url + "/api/admin/health", {
    headers: { Authorization: "Bearer " + admin },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error("Health " + r.status);
  const h = await r.json();
  peakRss = Math.max(peakRss, h.memory.rss);
  peakLoop = Math.max(peakLoop, h.eventLoopMaxMs);
  return h;
}
function launch(promise) {
  inflight.add(promise);
  void promise.finally(() => inflight.delete(promise));
}
function pump(now) {
  for (const t of tables) {
    const game = t.room.game;
    if (
      !t.busy &&
      game &&
      game.phase !== "finished" &&
      now >= t.gameAt &&
      Date.now() >= (t.room.actionReadyAt ?? 0) + 30 &&
      soleLegalMove(game) === undefined
    ) {
      const index = t.ids.indexOf(game.seats[game.turn]?.id);
      if (index >= 0) {
        t.busy = true;
        t.gameAt = now + 1200 + Math.random() * 100;
        launch(
          call(
            t.guests[index],
            game.phase === "roll" ? "game:roll" : "game:move",
            {
              revision: game.revision,
              ...(game.phase === "move" ? { token: legalMoves(game)[0] } : {}),
            },
          ).finally(() => {
            t.busy = false;
          }),
        );
      }
    }
    if (!t.chatBusy && now >= t.chatAt) {
      t.chatBusy = true;
      t.chatAt = now + 5000 + Math.random() * 500;
      launch(
        call(t.guests[0], "chat:send", {
          text: "Capacity chat: " + "message ".repeat(15),
        }).finally(() => {
          t.chatBusy = false;
        }),
      );
    }
    if (!t.voiceBusy && now >= t.voiceAt) {
      t.voiceBusy = true;
      t.voiceAt = now + 30000 + Math.random() * 1000;
      launch(
        (async () => {
          const r = await call(t.guests[1], "voice:send", {
            audio,
            mime: "audio/webm",
            duration: 0.8,
          });
          if (r.ok) {
            const id = t.room.voices.at(-1)?.id;
            if (id) {
              const start = performance.now(),
                res = await fetch(url + "/api/voice/" + id, {
                  headers: {
                    Cookie: t.guests[0].cookie,
                    "X-Forwarded-For": t.guests[0].ip,
                  },
                  signal: AbortSignal.timeout(12000),
                });
              if (
                !res.ok ||
                (await res.arrayBuffer()).byteLength !== audio.length
              )
                failures.push({
                  event: "voice:download",
                  error: "Media mismatch",
                });
              remember("voice:download", performance.now() - start);
            }
          }
        })()
          .catch((e) =>
            failures.push({ event: "voice:download", error: reason(e) }),
          )
          .finally(() => {
            t.voiceBusy = false;
          }),
      );
    }
  }
}
async function run() {
  const baseline = await health(),
    wallStart = performance.now();
  // Existing tables remain active throughout the ramp, not only between bursts
  // of room creation. Otherwise a quiet setup can conceal actual pressure.
  const pumpTimer = setInterval(() => {
    if (!stopping) pump(performance.now());
  }, 100);
  pumpTimer.unref();
  let admissionPaused = false;
  console.log(
    JSON.stringify({
      event: "start",
      levels,
      stageSeconds: duration,
      scope:
        "Isolated Delta k3s; synthetic distinct client IPs through a trusted private load proxy; no public ingress or real players",
    }),
  );
  for (const target of levels) {
    if (performance.now() - wallStart > 900000) {
      hardStop = "15-minute bounded run limit";
      break;
    }
    const setupStart = performance.now();
    let admissionError = null;
    while (tables.length < target) {
      try {
        const batch = Array.from(
          { length: Math.min(8, target - tables.length) },
          () => addTable(),
        );
        const outcomes = await Promise.allSettled(batch);
        const failed = outcomes.find((r) => r.status === "rejected");
        if (failed) throw failed.reason;
      } catch (e) {
        if (e.code === "SERVER_BUSY") admissionPaused = true;
        else admissionError = reason(e);
        break;
      }
    }
    const setupSeconds = (performance.now() - setupStart) / 1000;
    accepted = {};
    driverLoop.reset();
    const cpuStart = process.cpuUsage();
    const phaseClock = performance.now();
    samples = {};
    codes = {};
    failures = [];
    peakRss = 0;
    peakLoop = 0;
    const deliveries = totalChatDeliveries,
      replies = totalReplies,
      start = performance.now();
    let lastHealth = 0,
      current = baseline;
    while (!admissionError && performance.now() - start < duration * 1000) {
      pump(performance.now());
      if (performance.now() - lastHealth > 4000) {
        lastHealth = performance.now();
        try {
          current = await health();
        } catch (e) {
          admissionError = reason(e);
          break;
        }
        if (
          current.uptimeSeconds < baseline.uptimeSeconds ||
          current.actions < baseline.actions
        ) {
          admissionError = "Server restarted or monitoring counters reset";
          break;
        }
        if (current.errors > baseline.errors) {
          admissionError = "Server error counter increased";
          break;
        }
      }
      if (
        failures.some(
          (f) =>
            f.code === "TRANSPORT_FAILURE" || f.error?.includes("timed out"),
        )
      ) {
        admissionError = "Action transport timeout or disconnect";
        break;
      }
      await sleep(100);
    }
    await Promise.allSettled([...inflight]);
    try {
      current = await health();
    } catch (e) {
      admissionError ??= reason(e);
    }
    const byEvent = Object.fromEntries(
      Object.entries(samples).map(([event, values]) => [
        event,
        {
          count: values.length,
          p50Ms: +quantile(values, 0.5).toFixed(2),
          p95Ms: +quantile(values, 0.95).toFixed(2),
          p99Ms: +quantile(values, 0.99).toFixed(2),
          maxMs: +quantile(values, 1).toFixed(2),
        },
      ]),
    );
    const actionSamples = Object.entries(samples)
      .filter(([event]) => event.startsWith("game:") || event === "chat:send")
      .flatMap(([, values]) => values);
    const elapsed = (performance.now() - start) / 1000,
      stage = {
        targetRooms: target,
        rooms: tables.length,
        connectedUsers: guests.filter((g) => g.socket.connected).length,
        setupSeconds: +setupSeconds.toFixed(2),
        seconds: +elapsed.toFixed(2),
        replies: totalReplies - replies,
        repliesPerSecond: +((totalReplies - replies) / elapsed).toFixed(2),
        chatDeliveries: totalChatDeliveries - deliveries,
        byEvent,
        p95Ms: +quantile(actionSamples, 0.95).toFixed(2),
        maxMs: +quantile(actionSamples, 1).toFixed(2),
        latencyTargetsMet:
          actionSamples.length > 0 &&
          !admissionError &&
          quantile(actionSamples, 0.95) <= 250 &&
          quantile(actionSamples, 1) <= 1000,
        acceptedByEvent: { ...accepted },
        failureCount: failures.length,
        replyCodes: { ...codes },
        failures: failures.slice(0, 20),
        peakServerRssMiB: +(peakRss / 1048576).toFixed(1),
        eventLoopMaxMs: peakLoop,
        serverErrors: current.errors - baseline.errors,
        operations: current.timings,
        rateBudgets: current.rateBudgets,
        serverConnections: current.connections,
        serverRooms: current.rooms,
        admission: current.admission,
        expectedAdmissionPause: admissionPaused,
        peakConnectedUsers,
        driver: {
          fileDescriptors: (await readdir("/proc/self/fd")).length,
          rssMiB: +(process.memoryUsage().rss / 1048576).toFixed(1),
          loopP95Ms: +(driverLoop.percentile(95) / 1e6).toFixed(2),
          loopMaxMs: +(driverLoop.max / 1e6).toFixed(2),
          cpuSeconds: +(
            (process.cpuUsage(cpuStart).user +
              process.cpuUsage(cpuStart).system) /
            1e6
          ).toFixed(2),
        },
        stopReason: admissionError,
      };
    stages.push(stage);
    console.log(JSON.stringify({ event: "stage", ...stage }));
    if (admissionPaused) {
      hardStop = "Dynamic pressure admission refused new work";
      break;
    }
    if (admissionError) {
      hardStop = admissionError;
      break;
    }
    if (stage.p95Ms > 5000) {
      hardStop = "Sustained p95 exceeded five seconds";
      break;
    }
  }
  stopping = true;
  clearInterval(pumpTimer);
  await Promise.allSettled([...inflight]);
  let recovery = null;
  if (admissionPaused) {
    // Disconnect load, retain room data, and verify reopening without restart.
    guests.forEach((g) => g.socket.disconnect());
    const start = performance.now();
    while (performance.now() - start < 30000) {
      await sleep(1000);
      const status = await (await fetch(url + "/api/admission")).json();
      if (status.newRoomsAvailable) {
        const visitor = await guest();
        const reply = await call(visitor, "room:create", {
          name: "Recovery check",
          playerName: "Recovery",
          public: false,
          bots: 0,
        });
        recovery = {
          seconds: +((performance.now() - start) / 1000).toFixed(2),
          newRoomAccepted: reply.ok,
          admission: (await health()).admission,
        };
        break;
      }
    }
    recovery ??= {
      newRoomAccepted: false,
      error: "Admission did not recover within 30 seconds",
    };
  }
  const summary = {
    at: new Date().toISOString(),
    scope:
      "Resource-limited isolated Delta k3s server; distinct simulated proxy IPs; human games, text chat, valid WebM uploads/downloads and background backups",
    serverLimits: {
      cpu: "1500m",
      memoryMiB: 768,
      maxRooms: 5000,
      maxConnections: 10000,
      sqliteMiB: 256,
      voiceMiB: 64,
    },
    workload: {
      humansPerRoom: 2,
      bots: 0,
      gameIntentIntervalMs: 1200,
      chatIntervalMs: 5000,
      voiceIntervalMs: 30000,
      voiceBytes: audio.length,
      phaseSeconds: duration,
    },
    stages,
    recovery,
    highestAdmittedRooms: Math.max(0, ...stages.map((s) => s.rooms)),
    highestConnectedUsers: peakConnectedUsers,
    highestPassingLatencyRooms: Math.max(
      0,
      ...stages
        .filter((s) => s.latencyTargetsMet && !s.stopReason)
        .map((s) => s.rooms),
    ),
    firstLatencyFailureRooms:
      stages.find((s) => !s.latencyTargetsMet)?.rooms ?? null,
    stopReason:
      hardStop ??
      "Reached configured test ceiling; no unbounded maximum inferred",
  };
  await writeFile("/tmp/stress-result.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ event: "summary", ...summary }));
}
try {
  await run();
} catch (e) {
  console.error(
    JSON.stringify({
      event: "fatal",
      error: reason(e),
      rooms: tables.length,
      users: guests.filter((g) => g.socket.connected).length,
    }),
  );
  process.exitCode = 1;
} finally {
  stopping = true;
  guests.forEach((g) => g.socket.disconnect());
}
