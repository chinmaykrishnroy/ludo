import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { io, type Socket } from "socket.io-client";
import { createApplication } from "../server/app.js";
import type { Reply, Room } from "../shared/protocol.js";
import { Store } from "../server/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function openClient(url: string, previousCookie?: string) {
  const response = await fetch(`${url}/api/session`, {
    headers: previousCookie ? { Cookie: previousCookie } : {},
  });
  const cookie =
    previousCookie ?? response.headers.get("set-cookie")!.split(";")[0];
  const socket = io(url, {
    transports: ["websocket"],
    autoConnect: false,
    extraHeaders: { Cookie: cookie },
  });
  let me = "";
  socket.on("session", (value) => {
    me = value.me;
  });
  socket.connect();
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  await delay(30);
  return {
    socket,
    cookie,
    get me() {
      return me;
    },
  };
}
async function listening(service: ReturnType<typeof createApplication>) {
  service.http.listen(0, "127.0.0.1");
  await once(service.http, "listening");
  return `http://127.0.0.1:${(service.http.address() as { port: number }).port}`;
}
test("real multiplayer: private/public rooms, authority, optional bots, chat, audio isolation, reconnect, host transfer", async () => {
  const service = createApplication({
    dbPath: ":memory:",
    botDelay: 25,
    publicRoomsEnabled: true,
    adminToken: "test-admin-token-at-least-32-characters",
  });
  service.http.listen(0, "127.0.0.1");
  await once(service.http, "listening");
  const address = service.http.address() as { port: number },
    url = `http://127.0.0.1:${address.port}`;
  const clients: Socket[] = [];
  async function connect(cookie?: string) {
    const response = await fetch(`${url}/api/session`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    cookie ??= response.headers.get("set-cookie")!.split(";")[0];
    const s = io(url, {
      extraHeaders: { Cookie: cookie },
      transports: ["websocket"],
      autoConnect: false,
    });
    clients.push(s);
    let me = "";
    s.on("session", (x) => {
      me = x.me;
    });
    s.connect();
    await new Promise<void>((resolve) => s.once("connect", () => resolve()));
    await delay(40);
    return { s, cookie, me };
  }
  const call = (s: Socket, event: string, data: unknown = {}) =>
    s.timeout(2000).emitWithAck(event, data) as Promise<Reply>;
  try {
    const a = await connect(),
      b = await connect(),
      outsider = await connect();
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
    const created = await call(a.s, "room:create", {
      name: "Private test",
      playerName: "Alice",
      public: false,
      bots: 0,
    });
    assert(created.ok);
    const code = created.room!.code;
    assert.match(code, /^[A-Z2-9]{6}$/);
    assert.equal((await call(outsider.s, "rooms:list")).rooms!.length, 0);
    assert.equal((await call(a.s, "room:start")).ok, false);
    assert.equal(
      (await call(b.s, "room:join", { code, playerName: "Bob" })).ok,
      true,
    );
    assert.equal(
      (await call(b.s, "room:configure", { seat: 2, bot: true })).ok,
      false,
    );
    assert.equal(
      (await call(a.s, "room:configure", { seat: 2, bot: true })).ok,
      true,
    );
    assert.equal(
      (await call(a.s, "room:configure", { seat: 3, bot: true })).ok,
      true,
    );
    assert.equal(
      (await call(a.s, "room:configure", { seat: 3, bot: false })).ok,
      true,
    );
    assert.equal(service.rooms.get(code)!.seats.filter(Boolean).length, 3);
    assert.equal(
      (await call(a.s, "chat:send", { text: "Hello table" })).ok,
      true,
    );
    assert.equal(service.rooms.get(code)!.chat[0].text, "Hello table");
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(60).fill(0)]);
    assert.equal(
      (
        await call(a.s, "voice:send", {
          audio,
          mime: "audio/webm",
          duration: 1,
        })
      ).ok,
      true,
    );
    const voice = service.rooms.get(code)!.voices[0];
    const memberAudio = await fetch(`${url}/api/voice/${voice.id}`, {
      headers: { Cookie: b.cookie },
    });
    assert.equal(memberAudio.status, 200);
    assert.deepEqual(Buffer.from(await memberAudio.arrayBuffer()), audio);
    assert.equal(
      (
        await fetch(`${url}/api/voice/${voice.id}`, {
          headers: { Cookie: outsider.cookie },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call(a.s, "voice:send", {
          audio: Buffer.alloc(20),
          mime: "audio/webm",
          duration: 1,
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await call(outsider.s, "voice:send", {
          audio,
          mime: "audio/webm",
          duration: 1,
        })
      ).ok,
      false,
    );
    assert.equal((await call(b.s, "room:start")).ok, false);
    assert.equal((await call(a.s, "room:start")).ok, true);
    assert.equal((await call(b.s, "game:roll", { revision: 0 })).ok, false);
    await delay(950);
    assert.equal((await call(a.s, "game:roll", { revision: 42 })).ok, false);
    assert.equal((await call(a.s, "game:roll", { revision: 0 })).ok, true);
    assert.equal(service.rooms.get(code)!.game!.revision, 1);
    assert.equal((await call(a.s, "game:roll", { revision: 0 })).ok, false);
    const revision = service.rooms.get(code)!.game!.revision;
    a.s.disconnect();
    await delay(40);
    assert.equal(service.rooms.get(code)!.host, b.me);
    const again = await connect(a.cookie);
    assert.equal(again.me, a.me);
    assert.equal(
      service.rooms.get(code)!.seats.filter((s) => s?.id === a.me).length,
      1,
    );
    assert.equal(service.rooms.get(code)!.game!.revision, revision);
    assert.equal(service.rooms.get(code)!.seats[0]!.connected, true);
    const pub = await call(outsider.s, "room:create", {
      name: "Public test",
      playerName: "Carol",
      public: true,
      bots: 2,
    });
    assert(pub.ok);
    const browser = await connect();
    assert.equal(
      (await call(browser.s, "rooms:list")).rooms![0].code,
      pub.room!.code,
    );
    assert.equal((await call(b.s, "room:leave")).ok, true);
    assert.equal(service.rooms.get(code)!.game!.seats[1]!.bot, true);
  } finally {
    clients.forEach((s) => s.disconnect());
    await service.close();
  }
});
test("SQLite snapshots and voice blobs survive restart", () => {
  const folder = mkdtempSync(join(tmpdir(), "ludo-test-")),
    file = join(folder, "rooms.sqlite");
  try {
    let s = new Store(file);
    const room: Room = {
      code: "ABC234",
      name: "Persisted",
      public: false,
      host: "user",
      seats: [null, null, null, null],
      game: null,
      voices: [],
      chat: [],
      createdAt: 1,
      updatedAt: 1,
      lastHumanAt: 1,
    };
    s.save(room);
    s.putVoice("voice", "ABC234", "audio/webm", Buffer.from("fixture"));
    s.close();
    s = new Store(file);
    assert.equal(s.load()[0].name, "Persisted");
    assert.equal(Buffer.from(s.getVoice("voice")!.data).toString(), "fixture");
    s.delete("ABC234");
    assert.equal(s.getVoice("voice"), undefined);
    s.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
test("cross-origin sockets and missing sessions are rejected", async () => {
  const service = createApplication({ dbPath: ":memory:" });
  service.http.listen(0, "127.0.0.1");
  await once(service.http, "listening");
  const url = `http://127.0.0.1:${(service.http.address() as { port: number }).port}`;
  const s = io(url, { transports: ["websocket"], reconnection: false });
  try {
    const e = await new Promise<Error>((resolve) =>
      s.once("connect_error", resolve),
    );
    assert.match(e.message, /refresh/);
    const res = await fetch(`${url}/api/session`, {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(res.status, 403);
  } finally {
    s.disconnect();
    await service.close();
  }
});

test("archived seats and tokens survive a full server restart until explicit departure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ludo-rejoin-")),
    dbPath = join(directory, "saved.sqlite");
  let service = createApplication({ dbPath }),
    client: Awaited<ReturnType<typeof openClient>> | undefined;
  try {
    let url = await listening(service);
    client = await openClient(url);
    const created = (await client.socket
      .timeout(2000)
      .emitWithAck("room:create", {
        name: "Saved game",
        playerName: "Alice",
        public: false,
        bots: 1,
      })) as Reply;
    await client.socket.timeout(2000).emitWithAck("room:start", {});
    const room = service.rooms.get(created.room!.code)!;
    room.game!.seats[0]!.tokens = [9, 0, -1, -1];
    room.game!.revision = 42;
    room.game!.dice = 3;
    room.game!.phase = "move";
    const deadline = Date.now() + 40000;
    room.game!.deadline = deadline;
    room.seats = structuredClone(room.game!.seats);
    room.archived = true;
    service.store.save(room);
    const cookie = client.cookie,
      id = client.me;
    client.socket.disconnect();
    await service.close();
    service = createApplication({ dbPath });
    assert.equal(
      service.rooms.size,
      0,
      "archived room should not occupy an active room slot",
    );
    url = await listening(service);
    client = await openClient(url, cookie);
    const restored = service.rooms.get(room.code)!;
    assert(restored);
    assert.equal(client.me, id);
    assert.equal(restored.game!.revision, 42);
    assert.deepEqual(restored.game!.seats[0]!.tokens, [9, 0, -1, -1]);
    assert.equal(restored.game!.phase, "move");
    assert.equal(restored.game!.dice, 3);
    assert.equal(
      restored.game!.deadline,
      deadline,
      "reopening must not renew the saved backend deadline",
    );
    const clock = (await client.socket
      .timeout(2000)
      .emitWithAck("clock:sync", {})) as Reply;
    assert(clock.ok && Math.abs(clock.serverNow! - Date.now()) < 1000);
    const left = (await client.socket
      .timeout(2000)
      .emitWithAck("room:leave", {})) as Reply;
    assert(left.ok);
    assert.equal(service.store.findByPlayer(id), undefined);
  } finally {
    client?.socket.disconnect();
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("human deadlines auto-roll after 15 seconds, then use the first legal token after 30 seconds", async () => {
  const service = createApplication({ dbPath: ":memory:" }),
    clients: Socket[] = [];
  try {
    const url = await listening(service),
      a = await openClient(url),
      b = await openClient(url);
    clients.push(a.socket, b.socket);
    const created = (await a.socket.timeout(2000).emitWithAck("room:create", {
      name: "Timed game",
      playerName: "Alice",
      public: false,
      bots: 0,
    })) as Reply;
    await b.socket.timeout(2000).emitWithAck("room:join", {
      code: created.room!.code,
      playerName: "Bob",
    });
    await a.socket.timeout(2000).emitWithAck("room:start", {});
    let room = service.rooms.get(created.room!.code)!;
    assert(room.game!.deadline - Date.now() > 14000);
    await delay(950);
    room.game!.seats[0]!.tokens[0] = 0;
    room.game!.deadline = Date.now() - 1;
    room.seats = structuredClone(room.game!.seats);
    await delay(250);
    room = service.rooms.get(room.code)!;
    assert.equal(room.game!.phase, "move");
    assert.equal(room.game!.revision, 1);
    assert(
      room.game!.deadline - Date.now() > 29000,
      "moving gets its own fresh 30-second deadline",
    );
    await delay(1150);
    room.game!.dice = 1;
    room.game!.seats[0]!.tokens = [5, 40, -1, -1];
    room.game!.deadline = Date.now() - 1;
    room.seats = structuredClone(room.game!.seats);
    await delay(250);
    room = service.rooms.get(room.code)!;
    assert.equal(
      room.game!.lastMove!.token,
      0,
      "timeout must choose the first legal token rather than the stronger advanced token",
    );
    assert.deepEqual(room.game!.seats[0]!.tokens, [6, 40, -1, -1]);
  } finally {
    clients.forEach((s) => s.disconnect());
    await service.close();
  }
});
