// Local-only relay envelope check. Never targets a deployment or uses a microphone.
import { once } from "node:events";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { io, type Socket } from "socket.io-client";
import { WebSocket } from "ws";
import { createApplication } from "../server/app.js";
import { AdmissionController } from "../server/admission.js";
import {
  LIVE_VOICE_PROTOCOL,
  LIVE_VOICE_PATH,
  livePacket,
} from "../shared/liveVoice.js";
import type { Reply } from "../shared/protocol.js";

const count = Number(process.env.LIVE_LOAD_ROOMS ?? 12);
const seconds = Number(process.env.LIVE_LOAD_SECONDS ?? 10);
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 20 ||
  !Number.isInteger(seconds) ||
  seconds < 1 ||
  seconds > 30
)
  throw Error(
    "Use 1–20 rooms and 1–30 seconds; public ingress budgets remain enabled.",
  );
const service = createApplication({
  dbPath: ":memory:",
  maxIpConnections: 100,
  // Isolate relay cost from unrelated host pressure. Production retains its real sampler.
  admission: new AdmissionController(),
});
const sockets: Socket[] = [],
  audio: WebSocket[] = [];
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
let received = 0,
  maxBuffered = 0;
type Client = {
  game: Socket;
  ws: WebSocket;
  control: (data: unknown) => void;
  call: (event: string, data?: unknown) => Promise<Reply>;
  stream?: number;
};
const speakers: Client[] = [],
  latencies: number[] = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
service.http.listen(0, "127.0.0.1");
await once(service.http, "listening");
const origin = `http://127.0.0.1:${(service.http.address() as { port: number }).port}`;
async function guest(code?: string): Promise<{ client: Client; code: string }> {
  const response = await fetch(`${origin}/api/session`);
  if (!response.ok) throw Error(`Session: ${response.status}`);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const game = io(origin, {
    transports: ["websocket"],
    extraHeaders: { Cookie: cookie },
    autoConnect: false,
    reconnection: false,
  });
  sockets.push(game);
  await new Promise<void>((resolve, reject) => {
    game.once("connect", resolve);
    game.once("connect_error", reject);
    game.connect();
  });
  const call = async (event: string, data: unknown = {}) =>
    game.timeout(3000).emitWithAck(event, data) as Promise<Reply>;
  const joined = await call(
    code ? "room:join" : "room:create",
    code
      ? { code, playerName: `Guest ${sockets.length}` }
      : {
          name: "Local voice load",
          playerName: `Guest ${sockets.length}`,
          public: false,
          bots: 0,
        },
  );
  if (!joined.ok || !joined.room) throw Error(joined.error);
  const ws = new WebSocket(
    origin.replace("http", "ws") + LIVE_VOICE_PATH,
    LIVE_VOICE_PROTOCOL,
    { headers: { Cookie: cookie } },
  );
  audio.push(ws);
  ws.on("message", (data, binary) => {
    if (binary) {
      received++;
      return;
    }
    const m = JSON.parse(data.toString());
    if (m.type === "end")
      ws.send(JSON.stringify({ type: "delivered", stream: m.stream }));
  });
  await once(ws, "open");
  const control = (data: unknown) => ws.send(JSON.stringify(data));
  control({ type: "listen", ready: true, muted: false });
  return { client: { game, ws, call, control }, code: joined.room.code };
}
try {
  for (let r = 0; r < count; r++) {
    const owner = await guest();
    speakers.push(owner.client);
    for (let i = 0; i < 3; i++) await guest(owner.code);
  }
  await delay(30);
  for (const client of speakers) {
    const grant = new Promise<any>((resolve) => {
      const listener = (data: Buffer, binary: boolean) => {
        if (!binary) {
          const m = JSON.parse(data.toString());
          if (m.type === "grant") {
            client.ws.off("message", listener);
            resolve(m);
          }
        }
      };
      client.ws.on("message", listener);
    });
    client.control({ type: "start", request: 1 });
    const result = await grant;
    if (!result.ok) throw Error(`Room denied: ${result.reason}`);
    client.stream = result.stream;
  }
  const frames = seconds * 50;
  const started = performance.now(),
    cpuStarted = process.cpuUsage(),
    memoryStarted = process.memoryUsage().rss;
  // Opaque synthetic 60-byte packets model 24-kbps/20ms Opus bandwidth.
  // Clients acknowledge transport only; this does not benchmark codecs or acoustics.
  const payload = new Uint8Array(60);
  const chat: Promise<void>[] = [];
  for (let sequence = 0; sequence < frames; sequence++) {
    await delay(Math.max(0, started + sequence * 20 - performance.now()));
    for (const client of speakers) {
      maxBuffered = Math.max(maxBuffered, client.ws.bufferedAmount);
      client.ws.send(livePacket(client.stream!, sequence, payload));
      if (sequence % 50 === 0)
        chat.push(
          (async () => {
            const at = performance.now();
            const reply = await client.call("chat:send", {
              text: `Frame ${sequence}`,
            });
            if (!reply.ok) throw Error(reply.error);
            latencies.push(performance.now() - at);
          })(),
        );
    }
  }
  await Promise.all(chat);
  for (const client of speakers) client.control({ type: "end", request: 1 });
  await delay(250);
  const expected = count * frames * 3;
  if (received !== expected || service.liveVoice.stats.completed !== count)
    throw Error(
      `Delivery mismatch: ${received}/${expected}, completed=${service.liveVoice.stats.completed}`,
    );
  latencies.sort((a, b) => a - b);
  const cpu = process.cpuUsage(cpuStarted);
  const report = {
    scope:
      "local single-process relay + synthetic clients, in-memory SQLite, externally controlled admission, no tunnel/codecs/physical devices",
    rooms: count,
    guests: count * 4,
    simultaneousSpeakers: count,
    seconds,
    framesIn: service.liveVoice.stats.frames,
    framesOut: received,
    expectedFramesOut: expected,
    completed: service.liveVoice.stats.completed,
    fallbacks: service.liveVoice.stats.fallbacks,
    bytesIn: service.liveVoice.stats.bytesIn,
    bytesOut: service.liveVoice.stats.bytesOut,
    chatCommands: latencies.length,
    chatP95Ms: +latencies[Math.floor(latencies.length * 0.95)].toFixed(2),
    eventLoopP95Ms: +(lag.percentile(95) / 1e6).toFixed(2),
    eventLoopMaxMs: +(lag.max / 1e6).toFixed(2),
    maxClientBufferedBytes: maxBuffered,
    rssDeltaMiB: +(
      (process.memoryUsage().rss - memoryStarted) /
      1048576
    ).toFixed(2),
    cpuCorePercent: +(
      ((cpu.user + cpu.system) / ((performance.now() - started) * 1000)) *
      100
    ).toFixed(2),
  };
  if (process.env.LIVE_LOAD_REPORT)
    await writeFile(
      process.env.LIVE_LOAD_REPORT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(JSON.stringify(report, null, 2));
} finally {
  lag.disable();
  for (const ws of audio) ws.terminate();
  for (const socket of sockets) socket.disconnect();
  await service.close();
}
