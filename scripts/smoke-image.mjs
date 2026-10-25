import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
const image = process.argv[2],
  arch = process.argv[3],
  name = "ludo-image-smoke-" + randomUUID().slice(0, 8),
  volume = name + "-data",
  clients = [];
if (!image || !/^[a-z0-9][a-z0-9./:_-]+$/.test(image))
  throw new Error("Supply a Docker image reference");
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let created = false,
  volumeCreated = false;
try {
  const architecture = docker(
    "image",
    "inspect",
    image,
    "--format",
    "{{.Architecture}}",
  );
  if (arch) assert.equal(architecture, arch);
  docker("volume", "create", "--label", "io.ludo.test=true", volume);
  volumeCreated = true;
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--label",
    "io.ludo.test=true",
    "--stop-timeout",
    "30",
    "--init",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--memory",
    "768m",
    "--cpus",
    "1.5",
    "-e",
    "PUBLIC_ROOMS_ENABLED=false",
    "-e",
    "BACKUP_INTERVAL_MS=0",
    "-v",
    volume + ":/data",
    "-p",
    "127.0.0.1::3000",
    image,
  );
  created = true;
  const address = docker("port", name, "3000/tcp");
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const url = "http://" + address;
  async function ready() {
    for (let n = 0; n < 150; n++) {
      try {
        if ((await fetch(url + "/readyz")).ok) return;
      } catch {}
      await pause(200);
    }
    throw new Error("Container readiness timed out: " + docker("logs", name));
  }
  async function client(cookie) {
    const response = await fetch(url + "/api/session", {
      headers: cookie ? { Cookie: cookie } : {},
    });
    assert(response.ok);
    cookie = response.headers.get("set-cookie").split(";")[0];
    const socket = io(url, {
      autoConnect: false,
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Cookie: cookie },
    });
    clients.push(socket);
    let state;
    const restored = new Promise((r) => socket.once("room:state", r));
    socket.on("room:state", (r) => {
      state = r;
    });
    const connected = new Promise((r, j) => {
      socket.once("connect", r);
      socket.once("connect_error", j);
    });
    socket.connect();
    await connected;
    return {
      socket,
      cookie,
      restored,
      get state() {
        return state;
      },
    };
  }
  const call = (s, event, data = {}) =>
    s.timeout(10000).emitWithAck(event, data);
  await ready();
  assert.match(await (await fetch(url)).text(), /id="root"/);
  assert.equal(
    (await (await fetch(url + "/manifest.webmanifest")).json()).name,
    "Ludo Club",
  );
  const a = await client(),
    b = await client(),
    createdRoom = await call(a.socket, "room:create", {
      name: "Image smoke",
      playerName: "Alpha",
      public: false,
      bots: 0,
    });
  assert(createdRoom.ok, createdRoom.error);
  assert(
    (
      await call(b.socket, "room:join", {
        code: createdRoom.room.code,
        playerName: "Beta",
      })
    ).ok,
  );
  assert((await call(a.socket, "room:start")).ok);
  await pause(1000);
  assert((await call(a.socket, "game:roll", { revision: 0 })).ok);
  const before = structuredClone(a.state.game);
  assert.equal(before.revision, 1);
  clients.splice(0).forEach((s) => s.disconnect());
  docker("restart", "--time", "30", name);
  await ready();
  const again = await client(a.cookie);
  let restoreTimer;
  const room = await Promise.race([
    again.restored,
    new Promise((_, reject) => {
      restoreTimer = setTimeout(
        () => reject(new Error("Image reconnect timed out")),
        10000,
      );
    }),
  ]);
  clearTimeout(restoreTimer);
  assert.equal(room.code, createdRoom.room.code);
  assert.equal(room.game.revision, before.revision);
  assert.equal(room.game.deadline, before.deadline);
  assert.deepEqual(
    room.game.seats.map((s) => s?.tokens),
    before.seats.map((s) => s?.tokens),
  );
  const workerCheck = `const {AiScheduler}=await import('./build/server/ai/scheduler.js');const {newGame,seat,roll}=await import('./build/shared/game.js');const scheduler=new AiScheduler({timeoutMs:10000,searchBudget:{iterations:4,maxDepth:4,maxTimeMs:500}});try{await scheduler.request('smoke',roll(newGame([seat('a','A',0,true),seat('b','B',1,true),null,null]),6),10);if(scheduler.stats.completed!==1||scheduler.stats.fallbacks)throw new Error('Worker execution failed');}finally{await scheduler.close();}`;
  docker("exec", name, "node", "--input-type=module", "-e", workerCheck);
  console.log(
    JSON.stringify({
      ok: true,
      image,
      architecture,
      scope:
        "Real image HTTP/PWA assets, multiplayer roll, persisted restart/reconnect and compiled AI worker",
    }),
  );
} catch (error) {
  if (created) console.error(docker("logs", "--tail", "40", name));
  throw error;
} finally {
  clients.forEach((s) => s.disconnect());
  if (created) {
    try {
      docker("stop", "--time", "30", name);
    } finally {
      docker("rm", "-f", name);
    }
  }
  if (volumeCreated) docker("volume", "rm", volume);
}
