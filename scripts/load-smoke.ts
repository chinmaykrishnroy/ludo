import { createApplication } from "../server/app.js";
import { botMove, soleLegalMove } from "../shared/game.js";
import { io, type Socket } from "socket.io-client";
import { once } from "node:events";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Reply, Room } from "../shared/protocol.js";

// Bounded local workload; this is not a capacity certification or internet test.
const tableCount = Number(process.env.LOAD_ROOMS) || 20;
const directory = mkdtempSync(join(tmpdir(), "ludo-load-"));
const service = createApplication({ dbPath: join(directory, "load.sqlite") });
const clients: Socket[] = [],
  latencies: number[] = [];
const tables: { code: string; players: Socket[]; state: Room }[] = [];
let manualGameActions = 0;
const loop = monitorEventLoopDelay({ resolution: 20 });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = async (s: Socket, event: string, data: unknown = {}) => {
  const start = performance.now();
  const reply = (await s.timeout(8000).emitWithAck(event, data)) as Reply;
  latencies.push(performance.now() - start);
  assert(reply.ok, reply.error);
  return reply;
};
service.http.listen(0, "127.0.0.1");
await once(service.http, "listening");
const url = `http://127.0.0.1:${(service.http.address() as { port: number }).port}`;
async function client() {
  const r = await fetch(`${url}/api/session`),
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  const s = io(url, {
    autoConnect: false,
    transports: ["websocket"],
    extraHeaders: { Cookie: cookie },
  });
  clients.push(s);
  s.connect();
  await new Promise<void>((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });
  return s;
}
try {
  for (let i = 0; i < tableCount; i++) {
    const a = await client(),
      b = await client();
    const created = await call(a, "room:create", {
      name: `Load table ${i}`,
      playerName: "Alpha",
      public: false,
      bots: 0,
    });
    const code = created.room!.code,
      table = { code, players: [a, b], state: created.room! };
    a.on("room:state", (state: Room) => {
      if (state.code === code) table.state = state;
    });
    await call(b, "room:join", { code, playerName: "Beta" });
    await call(a, "room:start");
    tables.push(table);
  }
  loop.enable();
  const started = performance.now();
  for (let i = 0; i < 20; i++) {
    await delay(1150);
    await Promise.all(
      tables.map(async (t) => {
        const g = service.rooms.get(t.code)!.game!;
        if (g.phase === "finished") return;
        if (
          t.state.game?.revision !== g.revision ||
          Date.now() < (t.state.actionReadyAt ?? 0)
        )
          return;
        if (soleLegalMove(g) !== undefined) return;
        const s = t.players[g.turn];
        await call(s, g.phase === "roll" ? "game:roll" : "game:move", {
          revision: g.revision,
          ...(g.phase === "move" ? { token: botMove(g) } : {}),
        });
        manualGameActions++;
      }),
    );
  }
  loop.disable();
  latencies.sort((a, b) => a - b);
  const percentile = (p: number) =>
    Number(latencies[Math.floor((latencies.length - 1) * p)].toFixed(2));
  const result = {
    at: new Date().toISOString(),
    scope: "local loopback, one Node process, SQLite snapshots, no audio load",
    rooms: tableCount,
    socketClients: clients.length,
    gameActions: manualGameActions,
    elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
    ackMedianMs: percentile(0.5),
    ackP95Ms: percentile(0.95),
    ackMaxMs: percentile(1),
    eventLoopP95Ms: Number((loop.percentile(95) / 1e6).toFixed(2)),
    rssMiB: Number((process.memoryUsage().rss / 1048576).toFixed(1)),
    operations: service.monitor.snapshot().timings,
  };
  mkdirSync("output", { recursive: true });
  writeFileSync("output/load-smoke.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  clients.forEach((s) => s.disconnect());
  await service.close();
  rmSync(directory, { recursive: true, force: true });
}
