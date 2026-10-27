import { io } from "socket.io-client";
import { readFile } from "node:fs/promises";
import { legalMoves, soleLegalMove } from "../build/shared/game.js";
import { performance } from "node:perf_hooks";

// Run only against a disposable staging instance: this creates real games/stats.
if (process.env.LOAD_CONFIRM_DISPOSABLE !== "1")
  throw new Error(
    "Set LOAD_CONFIRM_DISPOSABLE=1 only for an isolated disposable instance",
  );
const url = process.env.LOAD_URL ?? "http://127.0.0.1:3000";
const duration = Number(process.env.LOAD_SECONDS ?? 300);
const count = Number(process.env.LOAD_ROOMS ?? 8);
if (
  !Number.isInteger(duration) ||
  duration < 10 ||
  duration > 3600 ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 8
)
  throw new Error("Use 10..3600 seconds and 1..8 rooms");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tables = [],
  guests = [],
  latencies = [],
  slowActions = [],
  errors = [];
let actions = 0,
  voices = 0,
  audioBytes = 0,
  reconnects = 0,
  maxRss = 0,
  maxLoop = 0,
  maxLoopDelay = 0,
  initialErrors = 0;
async function call(guest, event, data = {}, transient = false) {
  const start = performance.now();
  const reply = await guest.socket.timeout(10000).emitWithAck(event, data);
  const elapsed = performance.now() - start;
  latencies.push(elapsed);
  if (elapsed > 500 && slowActions.length < 30)
    slowActions.push({ event, ms: Number(elapsed.toFixed(2)) });
  if (reply.room && guest.table) guest.table.room = reply.room;
  if (
    !reply.ok &&
    !(
      transient &&
      (reply.code === "STALE_REVISION" ||
        /Wait for the move|not your turn/.test(reply.error ?? ""))
    )
  )
    throw new Error(`${event}: ${reply.code ?? reply.error}`);
  return reply;
}
async function connect(guest) {
  const socket = io(url, {
    autoConnect: false,
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Cookie: guest.cookie },
  });
  guest.socket = socket;
  socket.on("room:state", (room) => {
    if (guest.table) guest.table.room = room;
  });
  const ready = new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const restored = guest.table
    ? new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("room restore timeout")),
          10000,
        );
        socket.once("room:state", (room) => {
          clearTimeout(timer);
          resolve(room);
        });
      })
    : Promise.resolve(null);
  socket.connect();
  await ready;
  return await restored;
}
async function guest() {
  const response = await fetch(url + "/api/session");
  if (!response.ok) throw new Error(`session: ${response.status}`);
  const g = { cookie: response.headers.get("set-cookie").split(";")[0] };
  guests.push(g);
  await connect(g);
  return g;
}
async function health() {
  const response = await fetch(url + "/api/admin/health", {
    headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
  });
  if (!response.ok) throw new Error(`health: ${response.status}`);
  const h = await response.json();
  if (!h.ok) throw new Error("readiness failed during load");
  maxRss = Math.max(maxRss, h.memory.rss);
  maxLoop = Math.max(maxLoop, h.eventLoopP95Ms);
  maxLoopDelay = Math.max(maxLoopDelay, h.eventLoopMaxMs);
  return h;
}
try {
  initialErrors = (await health()).errors;
  for (let n = 0; n < count; n++) {
    const a = await guest(),
      b = await guest();
    const created = await call(a, "room:create", {
      name: `Disposable load ${n}`,
      playerName: "Load Alpha",
      public: false,
      bots: 2,
    });
    const table = { room: created.room, guests: [a, b], ids: [created.me] };
    a.table = b.table = table;
    const joined = await call(b, "room:join", {
      code: table.room.code,
      playerName: "Load Beta",
    });
    table.ids.push(joined.me);
    await call(a, "room:start");
    tables.push(table);
  }
  const actualAudio = !!process.env.LOAD_AUDIO_FILE;
  const audio = actualAudio
    ? await readFile(process.env.LOAD_AUDIO_FILE)
    : Buffer.alloc(128 * 1024);
  if (!actualAudio) audio.set([0x1a, 0x45, 0xdf, 0xa3]);
  const start = performance.now();
  let nextVoice = start + 35000,
    nextReconnect = start + 20000,
    nextHealth = start + 10000;
  while (performance.now() - start < duration * 1000) {
    await sleep(1350);
    await Promise.all(
      tables.map(async (table) => {
        const g = table.room.game;
        if (
          !g ||
          g.phase === "finished" ||
          soleLegalMove(g) !== undefined ||
          Date.now() < (table.room.actionReadyAt ?? 0) + 30
        )
          return;
        const i = table.ids.indexOf(g.seats[g.turn]?.id);
        if (i < 0 || !table.guests[i].socket.connected) return;
        const reply = await call(
          table.guests[i],
          g.phase === "roll" ? "game:roll" : "game:move",
          {
            revision: g.revision,
            ...(g.phase === "move" ? { token: legalMoves(g)[0] } : {}),
          },
          true,
        );
        if (reply.ok) actions++;
      }),
    );
    const now = performance.now();
    if (now >= nextVoice) {
      for (const table of tables) {
        const sender = table.guests[voices % 2],
          receiver = table.guests[(voices + 1) % 2];
        await call(sender, "voice:send", {
          audio,
          mime: "audio/webm",
          duration: actualAudio ? 0.8 : 30,
        });
        voices++;
        const id = table.room.voices.at(-1).id;
        const r = await fetch(`${url}/api/voice/${id}`, {
          headers: { Cookie: receiver.cookie },
        });
        if (!r.ok || (await r.arrayBuffer()).byteLength !== audio.length)
          throw new Error("audio retrieval mismatch");
        audioBytes += audio.length;
        await call(sender, "chat:send", {
          text: "Disposable load transport check",
        });
      }
      nextVoice = now + 35000;
    }
    if (now >= nextReconnect) {
      const g = guests[reconnects % guests.length],
        before = g.table.room.game.revision;
      g.socket.disconnect();
      await sleep(250);
      const restored = await connect(g);
      if (
        restored?.code !== g.table.room.code ||
        restored.game.revision < before
      )
        throw new Error("reconnect lost progress");
      reconnects++;
      nextReconnect = now + 20000;
    }
    if (now >= nextHealth) {
      await health();
      nextHealth = now + 10000;
    }
  }
  const h = await health();
  if (h.errors !== initialErrors)
    throw new Error(`server errors increased: ${h.errors - initialErrors}`);
  latencies.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        scope: `Disposable isolated instance; real sockets, bots, ${actualAudio ? "valid recorded WebM fixture" : "synthetic audio payload"} transport/downloads and deliberate reconnects. This is not a physical audibility test.`,
        at: new Date().toISOString(),
        seconds: Number(((performance.now() - start) / 1000).toFixed(1)),
        rooms: count,
        humanSockets: guests.length,
        computerSeats: count * 2,
        actions,
        voiceUploads: voices,
        downloadedAudioBytes: audioBytes,
        reconnects,
        ackP95Ms: Number(
          latencies[Math.floor(latencies.length * 0.95)].toFixed(2),
        ),
        ackMaxMs: Number(latencies.at(-1).toFixed(2)),
        maxRssMiB: Number((maxRss / 1048576).toFixed(1)),
        maxEventLoopP95Ms: maxLoop,
        maxEventLoopDelayMs: maxLoopDelay,
        slowActions,
        serverErrors: h.errors - initialErrors,
        aiWorker: h.ai,
        operations: h.timings,
        latencyTargets: { ackP95Ms: 250, ackMaxMs: 1000 },
        latencyTargetsMet:
          latencies[Math.floor(latencies.length * 0.95)] <= 250 &&
          latencies.at(-1) <= 1000,
      },
      null,
      2,
    ),
  );
} catch (error) {
  errors.push(error.message);
  console.error(JSON.stringify({ errors }));
  process.exitCode = 1;
} finally {
  guests.forEach((g) => g.socket?.disconnect());
}
