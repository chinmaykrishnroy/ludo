import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { io, type Socket } from "socket.io-client";
import { createTestApplication } from "./application.js";
import {
  LIVE_VOICE_PROTOCOL,
  LIVE_VOICE_PATH,
  livePacket,
} from "../shared/liveVoice.js";
import type { Reply } from "../shared/protocol.js";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(
  options: Parameters<typeof createTestApplication>[0] = {},
) {
  const service = createTestApplication({ dbPath: ":memory:", ...options });
  service.http.listen(0, "127.0.0.1");
  await once(service.http, "listening");
  const url = `http://127.0.0.1:${(service.http.address() as { port: number }).port}`;
  const games: Socket[] = [],
    audio: WebSocket[] = [];
  async function guest(cookie?: string) {
    cookie ??= (await fetch(`${url}/api/session`)).headers
      .get("set-cookie")!
      .split(";")[0];
    const s = io(url, {
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie },
      autoConnect: false,
      reconnection: false,
    });
    games.push(s);
    const connected = new Promise<void>((resolve, reject) => {
      s.once("connect", resolve);
      s.once("connect_error", reject);
    });
    s.connect();
    await connected;
    const call = (event: string, data: unknown = {}) =>
      s.timeout(2000).emitWithAck(event, data) as Promise<Reply>;
    async function voice() {
      const ws = new WebSocket(
        url.replace("http", "ws") + LIVE_VOICE_PATH,
        LIVE_VOICE_PROTOCOL,
        { headers: { Cookie: cookie! } },
      );
      audio.push(ws);
      const messages: any[] = [],
        frames: Buffer[] = [];
      ws.on("message", (data, binary) =>
        binary
          ? frames.push(data as Buffer)
          : messages.push(JSON.parse(data.toString())),
      );
      await once(ws, "open");
      const send = (m: unknown) => ws.send(JSON.stringify(m));
      send({ type: "listen", ready: true, muted: false });
      await delay(15);
      return {
        ws,
        messages,
        frames,
        send,
        wait: async (type: string) => {
          for (let i = 0; i < 150; i++) {
            const index = messages.findIndex((m) => m.type === type);
            if (index >= 0) return messages.splice(index, 1)[0];
            await delay(10);
          }
          throw Error(`Missing ${type}: ${JSON.stringify(messages)}`);
        },
      };
    }
    return { s, cookie, call, voice };
  }
  const a = await guest(),
    b = await guest();
  const r = await a.call("room:create", {
    playerName: "Alice",
    name: "Live table",
    public: false,
    bots: 0,
  });
  assert(r.ok && r.room);
  assert(
    (await b.call("room:join", { code: r.room.code, playerName: "Bob" })).ok,
  );
  return {
    service,
    url,
    a,
    b,
    guest,
    room: r.room,
    close: async () => {
      for (const ws of audio) ws.terminate();
      for (const s of games) s.disconnect();
      await service.close();
    },
  };
}
test("live Opus streams over a separate socket, scoped to one room, with no state writes or retained audio", async () => {
  // Isolate media writes from independently scheduled room maintenance. The
  // latter can commit at the first tick while a fast CI runner is asserting.
  const f = await fixture({ tickMs: 60000 });
  try {
    const a = await f.a.voice(),
      b = await f.b.voice();
    let writes = 0;
    f.service.store.observeTransaction = () => {
      writes++;
    };
    a.send({ type: "start", request: 1 });
    const grant = await a.wait("grant");
    assert(grant.ok);
    const start = await b.wait("start");
    assert.equal(start.speaker.name, "Alice");
    assert.equal(start.stream, grant.stream);
    const packet = livePacket(grant.stream, 0, new Uint8Array([248, 255, 254]));
    a.ws.send(packet);
    await delay(30);
    assert.equal(b.frames.length, 1);
    assert.deepEqual(b.frames[0], Buffer.from(packet));
    a.send({ type: "end", request: 1 });
    const end = await b.wait("end");
    assert.equal(end.frames, 1);
    b.send({ type: "delivered", stream: grant.stream });
    assert.equal((await a.wait("finished")).ok, true);
    assert.equal(writes, 0);
    assert.equal(f.service.rooms.get(f.room.code)!.voices.length, 0);
    assert.equal(f.service.liveVoice.snapshot().speakers, 0);
    assert.equal(f.service.liveVoice.stats.completed, 1);
    assert(
      (await f.a.call("chat:send", { text: "Write observer control" })).ok,
    );
    assert(
      writes > 0,
      "the observer must still detect ordinary durable writes",
    );
  } finally {
    await f.close();
  }
});
test("missing listener capability and a locked playback context fall back before streaming; only one speaker gets the floor", async () => {
  const f = await fixture();
  try {
    const a = await f.a.voice();
    a.send({ type: "start", request: 1 });
    assert.equal((await a.wait("grant")).ok, false);
    const b = await f.b.voice();
    b.send({ type: "listen", ready: false, muted: false });
    await delay(20);
    a.send({ type: "start", request: 2 });
    assert.equal((await a.wait("grant")).ok, false);
    b.send({ type: "listen", ready: true, muted: false });
    await delay(20);
    a.send({ type: "start", request: 3 });
    assert.equal((await a.wait("grant")).ok, true);
    b.send({ type: "start", request: 1 });
    assert.equal((await b.wait("grant")).reason, "speaking");
    a.send({ type: "cancel", request: 3 });
    assert.equal((await a.wait("finished")).ok, false);
  } finally {
    await f.close();
  }
});
test("explicit leave revokes all audio tabs immediately without leaking private frames", async () => {
  const f = await fixture();
  try {
    const extra = await f.guest(f.b.cookie);
    const a = await f.a.voice(),
      b = await f.b.voice(),
      tab = await extra.voice();
    a.send({ type: "start", request: 1 });
    const grant = await a.wait("grant");
    assert(grant.ok);
    assert((await f.b.call("room:leave")).ok);
    await delay(30);
    assert.equal(b.ws.readyState, WebSocket.CLOSED);
    assert.equal(tab.ws.readyState, WebSocket.CLOSED);
    assert.equal((await a.wait("finished")).ok, false);
    assert.equal(f.service.liveVoice.snapshot().speakers, 0);
    assert.equal(b.frames.length, 0);
    assert.equal(tab.frames.length, 0);
  } finally {
    await f.close();
  }
});
test("loss of listener connection cancels live delivery, preserves game transport and supports a fresh audio connection", async () => {
  const f = await fixture();
  try {
    const a = await f.a.voice(),
      b = await f.b.voice();
    a.send({ type: "start", request: 1 });
    assert((await a.wait("grant")).ok);
    b.ws.terminate();
    assert.equal((await a.wait("finished")).ok, false);
    assert((await f.a.call("clock:sync")).ok);
    await f.b.voice();
    a.send({ type: "start", request: 2 });
    assert((await a.wait("grant")).ok);
  } finally {
    await f.close();
  }
});
test("muted listeners receive speaker notices but no audio, and unmute resumes from the current frame", async () => {
  const f = await fixture();
  try {
    const a = await f.a.voice(),
      b = await f.b.voice();
    b.send({ type: "listen", ready: false, muted: true });
    await delay(20);
    a.send({ type: "start", request: 1 });
    const grant = await a.wait("grant");
    assert(grant.ok);
    assert.equal((await b.wait("start")).speaker.name, "Alice");
    a.ws.send(livePacket(grant.stream, 0, new Uint8Array([248, 255, 254])));
    await delay(25);
    assert.equal(b.frames.length, 0);
    b.send({ type: "listen", ready: true, muted: false });
    assert.equal((await b.wait("start")).sequence, 1);
    a.ws.send(livePacket(grant.stream, 1, new Uint8Array([248, 255, 254])));
    await delay(25);
    assert.equal(b.frames.length, 1);
  } finally {
    await f.close();
  }
});
test("invalid audio, flood and oversized frames cannot affect game actions or crash the server", async () => {
  const f = await fixture();
  try {
    const a = await f.a.voice();
    await f.b.voice();
    a.send({ type: "start", request: 1 });
    const grant = await a.wait("grant");
    assert(grant.ok);
    a.ws.send(livePacket(grant.stream, 5, new Uint8Array([1])));
    await delay(25);
    assert.equal(a.ws.readyState, WebSocket.CLOSED);
    assert((await f.a.call("clock:sync")).ok);
    const reconnect = await f.a.voice();
    reconnect.ws.send(Buffer.alloc(600));
    await delay(30);
    assert.equal(reconnect.ws.readyState, WebSocket.CLOSED);
    assert.equal((await fetch(`${f.url}/livez`)).status, 200);
    assert.equal(f.service.liveVoice.snapshot().speakers, 0);
  } finally {
    await f.close();
  }
});
test("unacknowledged playback cannot silently discard the recorded fallback", async () => {
  const f = await fixture();
  try {
    const a = await f.a.voice();
    await f.b.voice();
    a.send({ type: "start", request: 1 });
    const grant = await a.wait("grant");
    a.ws.send(livePacket(grant.stream, 0, new Uint8Array([248, 255, 254])));
    a.send({ type: "end", request: 1 });
    await delay(2300);
    assert.equal((await a.wait("finished")).ok, false);
  } finally {
    await f.close();
  }
});
test("the operator kill switch refuses live upgrades without affecting gameplay", async () => {
  const f = await fixture({ liveVoiceEnabled: false });
  try {
    const ws = new WebSocket(
      f.url.replace("http", "ws") + LIVE_VOICE_PATH,
      LIVE_VOICE_PROTOCOL,
      { headers: { Cookie: f.a.cookie } },
    );
    await assert.rejects(once(ws, "open"), /403/);
    assert((await f.a.call("clock:sync")).ok);
  } finally {
    await f.close();
  }
});
test("audio authentication rejects anonymous and foreign-origin sockets; block policy is bidirectional", async () => {
  const f = await fixture();
  try {
    for (const headers of [
      {},
      { Cookie: f.a.cookie, Origin: "https://foreign.invalid" },
    ]) {
      const ws = new WebSocket(
        f.url.replace("http", "ws") + LIVE_VOICE_PATH,
        LIVE_VOICE_PROTOCOL,
        { headers },
      );
      await assert.rejects(once(ws, "open"), /403/);
    }
    const a = await f.a.voice(),
      b = await f.b.voice();
    a.send({ type: "start", request: 1 });
    assert((await a.wait("grant")).ok);
    assert((await f.b.call("moderation:block", { player: f.room.host })).ok);
    assert.equal((await a.wait("finished")).ok, false);
    a.send({ type: "start", request: 2 });
    assert.equal((await a.wait("grant")).ok, false);
    b.send({ type: "start", request: 1 });
    assert.equal((await b.wait("grant")).ok, false);
    assert.equal(b.frames.length, 0);
  } finally {
    await f.close();
  }
});
test("unrelated rooms never receive live speaker metadata or packets", async () => {
  const f = await fixture();
  try {
    const stranger = await f.guest();
    assert(
      (
        await stranger.call("room:create", {
          playerName: "Eve",
          name: "Other table",
          public: false,
          bots: 0,
        })
      ).ok,
    );
    const outsider = await stranger.voice();
    const a = await f.a.voice();
    await f.b.voice();
    a.send({ type: "start", request: 1 });
    const grant = await a.wait("grant");
    assert(grant.ok);
    a.ws.send(livePacket(grant.stream, 0, new Uint8Array([248, 255, 254])));
    await delay(30);
    assert.equal(outsider.frames.length, 0);
    assert.equal(outsider.messages.filter((m) => m.type === "start").length, 0);
  } finally {
    await f.close();
  }
});
test("fragment and ping floods are bounded independently of gameplay", async () => {
  const f = await fixture();
  try {
    const fragmented = await f.a.voice();
    for (let i = 0; i < 10; i++) fragmented.ws.send("", { fin: false });
    await delay(40);
    assert.equal(fragmented.ws.readyState, WebSocket.CLOSED);
    const pings = await f.a.voice();
    for (let i = 0; i < 15; i++) pings.ws.ping("test");
    await delay(40);
    assert.equal(pings.ws.readyState, WebSocket.CLOSED);
    assert((await f.a.call("clock:sync")).ok);
  } finally {
    await f.close();
  }
});

test("release image probe exercises authenticated live forwarding and delivery acknowledgement", async () => {
  const f = await fixture();
  try {
    const moduleUrl = new URL(
      "../scripts/probe-live-voice.mjs",
      import.meta.url,
    ).href;
    const { probeLiveVoice } = await import(moduleUrl);
    assert.deepEqual(await probeLiveVoice(f.url, f.a.cookie, f.b.cookie), {
      upgrade: true,
      roomScopedFrame: true,
      deliveryAcknowledged: true,
    });
  } finally {
    await f.close();
  }
});
