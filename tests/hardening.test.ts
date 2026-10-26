import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { io, type Socket } from "socket.io-client";
import { createApplication, type ApplicationOptions } from "../server/app.js";
import { hash } from "../server/security.js";
import type { Reply } from "../shared/protocol.js";
import { EventEmitter } from "node:events";
import { AiScheduler, type WorkerPort } from "../server/ai/scheduler.js";
import { chooseBotMove, type AiJob } from "../shared/ai/index.js";
import { roll } from "../shared/game.js";
const delay = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
async function harness(options: ApplicationOptions = {}) {
  const service = createApplication({ dbPath: ":memory:", ...options }),
    clients: Socket[] = [];
  service.http.listen(0, "127.0.0.1");
  await once(service.http, "listening");
  const url = `http://127.0.0.1:${(service.http.address() as { port: number }).port}`;
  async function client(existing?: string) {
    const r = await fetch(`${url}/api/session`, {
        headers: existing ? { Cookie: existing } : {},
      }),
      cookie = r.headers.get("set-cookie")!.split(";")[0];
    const socket = io(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    clients.push(socket);
    socket.connect();
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    await delay();
    return { socket, cookie };
  }
  const call = (s: Socket, event: string, data: unknown = {}) =>
    s.timeout(2000).emitWithAck(event, data) as Promise<Reply>;
  return {
    service,
    url,
    client,
    call,
    close: async () => {
      clients.forEach((s) => s.disconnect());
      await service.close();
    },
  };
}

test("archived reconnect respects room capacity without losing the saved game", async () => {
  const h = await harness({ maxRooms: 1, botDelay: 60000 });
  try {
    const a = await h.client();
    const created = await h.call(a.socket, "room:create", {
      name: "Archived",
      playerName: "Alice",
      public: false,
      bots: 1,
    });
    await h.call(a.socket, "room:start");
    const saved = structuredClone(h.service.rooms.get(created.room!.code)!);
    saved.archived = true;
    h.service.store.save(saved);
    h.service.rooms.delete(saved.code);
    a.socket.disconnect();
    await delay();
    const b = await h.client();
    assert(
      (
        await h.call(b.socket, "room:create", {
          name: "At capacity",
          playerName: "Bob",
          public: false,
          bots: 0,
        })
      ).ok,
    );
    const rejected = await h.client(a.cookie);
    assert.equal(rejected.socket.connected, false);
    assert.equal(h.service.rooms.size, 1);
    const retained = h.service.store.findByPlayer(saved.host)!;
    assert(retained.archived);
    assert.deepEqual(retained.game, saved.game);
    await h.call(b.socket, "room:leave");
    for (let attempt = 0; attempt < 20 && h.service.rooms.size; attempt++)
      await delay();
    assert.equal(h.service.rooms.size, 0);
    const resumed = await h.client(a.cookie);
    assert(resumed.socket.connected);
    assert.equal(
      h.service.rooms.get(saved.code)!.game!.deadline,
      saved.game!.deadline,
    );
  } finally {
    await h.close();
  }
});

test("empty voice data is reported as empty rather than oversized and never stored", async () => {
  const h = await harness();
  try {
    const a = await h.client();
    const room = await h.call(a.socket, "room:create", {
      name: "Voice",
      playerName: "Alice",
      public: false,
      bots: 0,
    });
    const response = await h.call(a.socket, "voice:send", {
      audio: Buffer.alloc(0),
      mime: "audio/webm",
      duration: 1,
    });
    assert.equal(response.ok, false);
    assert.equal(response.code, "EMPTY_RECORDING");
    assert.match(response.error!, /no audio|empty/i);
    assert.equal(h.service.rooms.get(room.room!.code)!.voices.length, 0);
  } finally {
    await h.close();
  }
});
test("leaving evicts every tab of the same guest before private updates", async () => {
  const h = await harness();
  try {
    const a = await h.client(),
      b = await h.client();
    const r = await h.call(a.socket, "room:create", {
        name: "Private",
        playerName: "Alice",
        public: false,
        bots: 0,
      }),
      code = r.room!.code;
    await h.call(b.socket, "room:join", { code, playerName: "Bob" });
    const tab = await h.client(a.cookie);
    await h.call(a.socket, "room:leave");
    assert.equal(
      h.service.io.sockets.sockets.get(tab.socket.id!)!.rooms.has(code),
      false,
    );
    let leaks = 0;
    tab.socket.on("room:state", () => leaks++);
    await h.call(b.socket, "chat:send", { text: "Private after departure" });
    await delay();
    assert.equal(leaks, 0);
  } finally {
    await h.close();
  }
});

test("late rolls and moves are rejected at the handler boundary before the timer tick", async () => {
  const h = await harness({ tickMs: 60000 });
  try {
    const a = await h.client(),
      created = await h.call(a.socket, "room:create", {
        name: "Deadline",
        playerName: "Alice",
        public: false,
        bots: 1,
      });
    await h.call(a.socket, "room:start");
    const code = created.room!.code;
    let r = h.service.rooms.get(code)!;
    r.game!.seats[0]!.tokens = [0, 40, -1, -1];
    r.game!.deadline = Date.now() - 1;
    r.seats = structuredClone(r.game!.seats);
    h.service.store.save(r);
    const reply = await h.call(a.socket, "game:roll", { revision: 0 });
    assert.equal(reply.code, "TURN_EXPIRED");
    r = h.service.rooms.get(code)!;
    assert.equal(r.game!.revision, 1);
    assert.equal(r.game!.phase, "move");
    r.game!.dice = 1;
    r.game!.sixes = 0;
    r.game!.deadline = Date.now() - 1;
    r.seats = structuredClone(r.game!.seats);
    h.service.store.save(r);
    const lateMove = await h.call(a.socket, "game:move", {
      revision: 1,
      token: 1,
    });
    assert.equal(lateMove.code, "TURN_EXPIRED");
    r = h.service.rooms.get(code)!;
    assert.equal(r.game!.lastMove!.token, 0);
    assert.equal(r.game!.seats[0]!.tokens[1], 40);
  } finally {
    await h.close();
  }
});

test("simultaneous actions from two tabs advance a revision only once", async () => {
  const h = await harness({ tickMs: 60000 });
  try {
    const a = await h.client();
    const created = await h.call(a.socket, "room:create", {
      name: "Concurrent tabs",
      playerName: "Alice",
      public: false,
      bots: 1,
    });
    const tab = await h.client(a.cookie);
    await h.call(a.socket, "room:start");
    await delay(950);
    const replies = await Promise.all([
      h.call(a.socket, "game:roll", { revision: 0 }),
      h.call(tab.socket, "game:roll", { revision: 0 }),
    ]);
    assert.equal(replies.filter((r) => r.ok).length, 1);
    assert.equal(replies.filter((r) => !r.ok).length, 1);
    const room = h.service.rooms.get(created.room!.code)!;
    assert.equal(room.game!.revision, 1);
    assert.equal(h.service.store.findByPlayer(created.me!)!.game!.revision, 1);
  } finally {
    await h.close();
  }
});

test("stale worker decisions cannot overwrite a newer room revision", async () => {
  class FakeWorker extends EventEmitter implements WorkerPort {
    jobs: AiJob[] = [];
    postMessage(job: AiJob) {
      this.jobs.push(job);
    }
    async terminate() {
      return 0;
    }
  }
  const worker = new FakeWorker(),
    scheduler = new AiScheduler({ factory: () => worker, timeoutMs: 10000 }),
    h = await harness({ aiScheduler: scheduler, tickMs: 20, botDelay: 0 });
  try {
    const a = await h.client(),
      created = await h.call(a.socket, "room:create", {
        name: "Stale AI",
        playerName: "Alice",
        public: false,
        bots: 1,
      });
    await h.call(a.socket, "room:start");
    const r = h.service.rooms.get(created.room!.code)!;
    r.game!.turn = 1;
    r.game = roll(r.game!, 6);
    r.game.deadline = Date.now() - 1;
    r.seats = structuredClone(r.game.seats);
    h.service.store.save(r);
    for (let i = 0; i < 50 && !worker.jobs.length; i++) await delay(20);
    assert.equal(worker.jobs.length, 1);
    const snapshot = worker.jobs[0],
      updated = structuredClone(h.service.rooms.get(r.code)!);
    updated.game!.revision++;
    updated.game!.deadline = Date.now() + 60000;
    h.service.rooms.set(r.code, updated);
    h.service.store.save(updated);
    worker.emit("message", {
      id: snapshot.id,
      decision: chooseBotMove(snapshot.game, { difficulty: 0 }),
    });
    await delay(10);
    assert.equal(
      h.service.rooms.get(r.code)!.game!.revision,
      updated.game!.revision,
    );
    assert.deepEqual(
      h.service.store.findByPlayer(created.me!)!.game!.seats[1]!.tokens,
      [-1, -1, -1, -1],
    );
  } finally {
    await h.close();
  }
});
test("a temporarily disconnected human uses the simple fallback even at expert room difficulty", async () => {
  const h = await harness({ tickMs: 20, botDelay: 0 });
  try {
    const a = await h.client(),
      created = await h.call(a.socket, "room:create", {
        name: "Timeout policy",
        playerName: "Alice",
        public: false,
        bots: 1,
        botDifficulty: 10,
      });
    await h.call(a.socket, "room:start");
    const r = h.service.rooms.get(created.room!.code)!;
    r.game!.seats[0]!.tokens = [20, 5, -1, -1];
    r.game!.seats[0]!.bot = true;
    r.game!.seats[1]!.tokens = [50, 56, 56, 56];
    r.game = roll(r.game!, 6);
    r.game.deadline = Date.now() - 1;
    r.seats = structuredClone(r.game.seats);
    h.service.store.save(r);
    await delay(45);
    assert.equal(h.service.rooms.get(r.code)!.game!.lastMove!.token, 0);
    assert.equal(h.service.ai.stats.completed, 0);
  } finally {
    await h.close();
  }
});

test("unknown shaped cookies and expired issued sessions cannot authenticate", async () => {
  const h = await harness();
  const clients: Socket[] = [];
  try {
    for (const cookie of ["ludo_session=" + "a".repeat(64)]) {
      const s = io(h.url, {
        transports: ["websocket"],
        autoConnect: false,
        reconnection: false,
        extraHeaders: { Cookie: cookie },
      });
      clients.push(s);
      const rejected = new Promise<Error>((resolve) =>
        s.once("connect_error", resolve),
      );
      s.connect();
      assert.match((await rejected).message, /refresh/);
    }
    const a = await h.client();
    const secret = a.cookie.split("=")[1];
    h.service.store.db
      .prepare("UPDATE sessions SET expiresAt=? WHERE id=?")
      .run(Date.now() - 1, hash(secret));
    assert.equal(
      (await h.call(a.socket, "clock:sync")).code,
      "SESSION_EXPIRED",
    );
    await delay();
    assert.equal(a.socket.connected, false);
    const response = await fetch(h.url + "/api/session", {
      headers: { Cookie: "ludo_session=" + "b".repeat(64) },
    });
    assert.notEqual(
      response.headers.get("set-cookie")!.split(";")[0],
      "ludo_session=" + "b".repeat(64),
    );
  } finally {
    clients.forEach((s) => s.disconnect());
    await h.close();
  }
});

test("guest limits apply across tabs and reconnects", async () => {
  const h = await harness({ maxGuestConnections: 2 });
  let third: Socket | undefined;
  try {
    const a = await h.client();
    await h.client(a.cookie);
    third = io(h.url, {
      transports: ["websocket"],
      autoConnect: false,
      reconnection: false,
      extraHeaders: { Cookie: a.cookie },
    });
    const rejected = new Promise<Error>((resolve) =>
      third!.once("connect_error", resolve),
    );
    third.connect();
    assert.match((await rejected).message, /Too many/);
    const r = await h.call(a.socket, "room:create", {
      name: "Limited",
      playerName: "Alice",
      public: false,
      bots: 0,
    });
    await h.call(a.socket, "room:leave");
    const b = await h.client();
    for (let i = 0; i < 20; i++)
      await h.call(b.socket, "room:join", {
        code: "ZZZZZZ",
        playerName: "Bob",
      });
    b.socket.disconnect();
    const again = await h.client(b.cookie);
    assert.equal(
      (
        await h.call(again.socket, "room:join", {
          code: r.room!.code,
          playerName: "Bob",
        })
      ).code,
      "RATE_LIMITED",
    );
  } finally {
    third?.disconnect();
    await h.close();
  }
});

test("voice insertion failure rolls back blob, metadata, and member snapshot together", async () => {
  const h = await harness();
  try {
    const a = await h.client(),
      created = await h.call(a.socket, "room:create", {
        name: "Atomic voice",
        playerName: "Alice",
        public: false,
        bots: 1,
      }),
      code = created.room!.code,
      before = JSON.stringify(h.service.rooms.get(code));
    h.service.store.db.exec(
      "CREATE TEMP TRIGGER fail_voice BEFORE INSERT ON voices BEGIN SELECT RAISE(ABORT,'injected voice write failure'); END",
    );
    const reply = await h.call(a.socket, "voice:send", {
      audio: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(60).fill(0)]),
      mime: "audio/webm",
      duration: 60,
    });
    assert.equal(reply.ok, false);
    assert.equal(JSON.stringify(h.service.rooms.get(code)), before);
    assert.equal(
      (
        h.service.store.db
          .prepare("SELECT COUNT(*) AS n FROM voices")
          .get() as { n: number }
      ).n,
      0,
    );
    assert.equal(h.service.store.findByPlayer(created.me!)!.voices.length, 0);
    h.service.store.db.exec("DROP TRIGGER fail_voice");
    assert.equal(
      (
        await h.call(a.socket, "voice:send", {
          audio: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(60).fill(0)]),
          mime: "audio/webm",
          duration: 60,
        })
      ).ok,
      true,
    );
  } finally {
    await h.close();
  }
});

test("a storage failure in the background timer is contained and recovers", async () => {
  const h = await harness({ tickMs: 20 });
  const save = h.service.store.save.bind(h.service.store);
  try {
    const a = await h.client(),
      created = await h.call(a.socket, "room:create", {
        name: "Timer fault",
        playerName: "Alice",
        public: false,
        bots: 1,
      });
    await h.call(a.socket, "room:start");
    const r = h.service.rooms.get(created.room!.code)!;
    r.game!.deadline = Date.now() - 1;
    r.game!.seats[0]!.tokens[0] = 0;
    r.seats = structuredClone(r.game!.seats);
    save(r);
    const before = JSON.stringify(r);
    h.service.store.save = () => {
      throw new Error("injected background write failure");
    };
    await delay(60);
    assert.equal(JSON.stringify(h.service.rooms.get(r.code)), before);
    assert.equal((await fetch(h.url + "/livez")).status, 200);
    h.service.store.save = save;
    await delay(70);
    assert.equal(h.service.rooms.get(r.code)!.game!.revision, 1);
  } finally {
    h.service.store.save = save;
    await h.close();
  }
});

test("clock sync is read-only and a mutation saves exactly once", async () => {
  const h = await harness();
  const save = h.service.store.save.bind(h.service.store);
  try {
    const a = await h.client();
    await h.call(a.socket, "room:create", {
      name: "Writes",
      playerName: "Alice",
      public: false,
      bots: 1,
    });
    let writes = 0;
    h.service.store.save = (...args) => {
      writes++;
      return save(...args);
    };
    await h.call(a.socket, "clock:sync");
    assert.equal(writes, 0);
    await h.call(a.socket, "chat:send", { text: "Single commit" });
    assert.equal(writes, 1);
  } finally {
    h.service.store.save = save;
    await h.close();
  }
});

test("legacy hidden voice URLs cannot bypass a block and reports are moderator-only", async () => {
  const token = "test-moderator-token-at-least-32-characters",
    h = await harness({ adminToken: token, publicRoomsEnabled: true });
  try {
    const a = await h.client(),
      b = await h.client(),
      created = await h.call(a.socket, "room:create", {
        name: "Moderation",
        playerName: "Alice",
        public: true,
        bots: 0,
      }),
      joined = await h.call(b.socket, "room:join", {
        code: created.room!.code,
        playerName: "Bob",
      }),
      r = h.service.rooms.get(created.room!.code)!,
      voice = {
        id: "legacy-voice",
        name: "Bob",
        color: "green" as const,
        mime: "audio/webm",
        duration: 1,
        at: Date.now(),
      };
    r.voices.push(voice);
    h.service.store.save(r, {
      id: voice.id,
      mime: voice.mime,
      data: Buffer.alloc(40),
      at: voice.at,
    });
    const request = () =>
      fetch(h.url + "/api/voice/" + voice.id, {
        headers: { Cookie: a.cookie },
      });
    assert.equal((await request()).status, 200);
    assert(
      (
        await h.call(a.socket, "moderation:report", {
          player: joined.me!,
          reason: "Synthetic test report",
        })
      ).ok,
    );
    assert.equal((await fetch(h.url + "/api/admin/reports")).status, 404);
    const reports = await fetch(h.url + "/api/admin/reports", {
      headers: { Authorization: "Bearer " + token },
    });
    assert.equal(((await reports.json()) as unknown[]).length, 1);
    assert(
      (await h.call(a.socket, "moderation:block", { player: joined.me! })).ok,
    );
    assert.equal((await request()).status, 404);
    const banned = await fetch(h.url + "/api/admin/bans", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        player: joined.me!,
        minutes: 1,
        reason: "Synthetic test ban",
      }),
    });
    assert.equal(banned.status, 200);
    await delay();
    assert.equal(b.socket.connected, false);
  } finally {
    await h.close();
  }
});
test("failed writes leave canonical memory and persisted state unchanged", async () => {
  const h = await harness();
  const save = h.service.store.save.bind(h.service.store);
  try {
    const a = await h.client(),
      r = await h.call(a.socket, "room:create", {
        name: "Rollback",
        playerName: "Alice",
        public: false,
        bots: 1,
      }),
      code = r.room!.code,
      before = JSON.stringify(h.service.rooms.get(code));
    h.service.store.save = () => {
      throw new Error("SQLITE_FULL simulated");
    };
    const reply = await h.call(a.socket, "chat:send", {
      text: "Must roll back",
    });
    assert.equal(reply.ok, false);
    assert.equal(JSON.stringify(h.service.rooms.get(code)), before);
    assert.equal(JSON.stringify(h.service.store.findByPlayer(r.me!)), before);
  } finally {
    h.service.store.save = save;
    await h.close();
  }
});
