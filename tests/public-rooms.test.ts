import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { io, type Socket } from "socket.io-client";
import { createApplication } from "../server/app.js";
import type { Reply } from "../shared/protocol.js";
const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms));
test("public rooms list/join correctly, hide private/started games, preserve per-bot difficulty and enforce blocks/host authority", async () => {
  const app = createApplication({
    dbPath: ":memory:",
    publicRoomsEnabled: true,
    adminToken: "public-test-admin-at-least-32-characters",
    botDifficulty: 10,
    tickMs: 60000,
  });
  app.http.listen(0, "127.0.0.1");
  await once(app.http, "listening");
  const url = `http://127.0.0.1:${(app.http.address() as { port: number }).port}`,
    clients: Socket[] = [];
  const call = (s: Socket, e: string, d: unknown = {}) =>
    s.timeout(2500).emitWithAck(e, d) as Promise<Reply>;
  async function client() {
    const response = await fetch(url + "/api/session"),
      cookie = response.headers.get("set-cookie")!.split(";")[0],
      socket = io(url, {
        autoConnect: false,
        transports: ["websocket"],
        extraHeaders: { Cookie: cookie },
      });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
      socket.connect();
    });
    await pause();
    return socket;
  }
  try {
    const host = await client(),
      visitor = await client(),
      other = await client();
    const config = await (await fetch(url + "/api/config")).json();
    assert.equal(config.publicRoomsEnabled, true);
    assert.equal(config.defaultBotDifficulty, 10);
    const publicRoom = await call(host, "room:create", {
        name: "Public match",
        playerName: "Host",
        public: true,
        bots: 3,
      }),
      code = publicRoom.room!.code;
    assert.equal(publicRoom.room!.seats[1]!.botDifficulty, 10);
    await call(other, "room:create", {
      name: "Private match",
      playerName: "Private",
      public: false,
      bots: 0,
    });
    const listed = await call(visitor, "rooms:list", { page: 50, pageSize: 8 });
    assert.deepEqual(
      listed.rooms!.map((r) => r.code),
      [code],
    );
    assert.deepEqual(listed.roomPage, {
      page: 1,
      pageSize: 8,
      total: 1,
      pages: 1,
    });
    for (const invalid of [{ page: 0 }, { page: 1.5 }, { pageSize: 21 }]) {
      assert.equal((await call(visitor, "rooms:list", invalid)).ok, false);
    }
    assert(
      (await call(host, "room:difficulty", { difficulty: 0, seat: 2 })).ok,
    );
    assert.equal(app.rooms.get(code)!.seats[2]!.botDifficulty, 0);
    const joined = await call(visitor, "room:join", {
      code,
      playerName: "Visitor",
    });
    assert(joined.ok);
    assert.equal(
      joined.room!.seats.filter((s) => s?.id.startsWith("bot:")).length,
      2,
    );
    assert.equal(
      (await call(visitor, "room:difficulty", { difficulty: 1, seat: 2 })).ok,
      false,
    );
    assert.equal(
      (await call(host, "room:difficulty", { difficulty: 11, seat: 2 })).ok,
      false,
    );
    assert.equal(
      (await call(host, "room:difficulty", { difficulty: 2, seat: 0 })).ok,
      false,
    );
    assert(
      (await call(visitor, "moderation:block", { player: publicRoom.me })).ok,
    );
    assert((await call(visitor, "room:leave")).ok);
    assert.equal((await call(visitor, "rooms:list")).rooms!.length, 0);
    assert.equal(
      (await call(visitor, "room:join", { code, playerName: "Visitor" })).ok,
      false,
    );
    assert((await call(host, "room:start")).ok);
    assert.equal((await call(other, "rooms:list")).rooms!.length, 0);
    assert.equal(
      (await call(host, "room:difficulty", { difficulty: 3, seat: 2 })).ok,
      false,
    );
    assert.equal(
      app.store.findByPlayer(publicRoom.me!)!.game!.seats[2]!.botDifficulty,
      0,
    );
  } finally {
    clients.forEach((s) => s.disconnect());
    await app.close();
  }
});
test("public-room switch still protects deployments where moderation is not enabled", async () => {
  const app = createApplication({ dbPath: ":memory:" });
  app.http.listen(0, "127.0.0.1");
  await once(app.http, "listening");
  const url = `http://127.0.0.1:${(app.http.address() as { port: number }).port}`;
  try {
    assert.equal(
      (await (await fetch(url + "/api/config")).json()).publicRoomsEnabled,
      false,
    );
  } finally {
    await app.close();
  }
});
