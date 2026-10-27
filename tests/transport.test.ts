import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { io, type Socket } from "socket.io-client";
import { Decoder } from "socket.io-parser";
import {
  BoundedDecoder,
  guardTransport,
  MAX_PACKET_TEXT_BYTES,
} from "../server/transport.js";
import { Budget } from "../server/security.js";
import { createTestApplication as createApplication } from "./application.js";
import { VOICE_MAX_BYTES } from "../shared/voice.js";
import type { Reply } from "../shared/protocol.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const header = (count = "1", event = "voice:send") =>
  `5${count}-["${event}",{"audio":{"_placeholder":true,"num":0},"mime":"audio/webm","duration":1}]`;

test("bounded decoder rejects the original retention path and equivalent attachment counts", () => {
  const old = new Decoder();
  let decoded = 0;
  old.on("decoded", () => decoded++);
  old.add(header("10"));
  for (let i = 0; i < 9; i++) old.add(Buffer.alloc(1024));
  assert.equal(decoded, 0);
  assert.equal(
    (old as unknown as { reconstructor: { buffers: Buffer[] } }).reconstructor
      .buffers.length,
    9,
  );
  old.destroy();
  for (const count of ["2", "02", "+2", "2e0", "10"]) {
    const decoder = new BoundedDecoder();
    assert.throws(() => decoder.add(header(count)), /attachments/);
    assert.equal(
      (decoder as unknown as { reconstructor: unknown }).reconstructor ?? null,
      null,
    );
  }
  for (const count of ["1", "01", "+1", "1e0"]) {
    const decoder = new BoundedDecoder();
    let received = false;
    decoder.on("decoded", (packet) => {
      received = Buffer.isBuffer(packet.data[1].audio);
    });
    decoder.add(header(count));
    decoder.add(Buffer.alloc(16));
    assert(received);
    decoder.destroy();
  }
  assert.throws(
    () => new BoundedDecoder().add(header("2", "unknown:event")),
    /attachments/,
  );
  assert.throws(
    () => new BoundedDecoder().add('62-[{"_placeholder":true,"num":0}]'),
    /attachments/,
  );
});

test("decoder limits UTF-8 bytes and binary views before parsing and clears rejected reconstruction", () => {
  assert.throws(
    () =>
      new BoundedDecoder().add(
        '2["x","' + "é".repeat(MAX_PACKET_TEXT_BYTES) + '"]',
      ),
    /too large/,
  );
  const decoder = new BoundedDecoder();
  decoder.add(header());
  assert.throws(
    () => decoder.add(Buffer.alloc(VOICE_MAX_BYTES + 1)),
    /too large/,
  );
  assert.equal(
    (decoder as unknown as { reconstructor: unknown }).reconstructor,
    null,
  );
  assert.throws(
    () => decoder.add({ base64: true, data: "AA==" }),
    /Unsupported/,
  );
  const backing = Buffer.alloc(VOICE_MAX_BYTES + 100);
  const view = backing.subarray(0, 16);
  const control = new BoundedDecoder();
  let bytes = 0;
  control.on("decoded", (packet) => {
    bytes = packet.data[1].audio.byteLength;
  });
  control.add(header());
  control.add(view);
  assert.equal(bytes, 16);
});

// Mirrors Engine.IO's documented packet-before-data sequence. Wire tests below
// additionally verify the real polling and WebSocket close/discard behavior.
class Engine extends EventEmitter {
  forwarded = 0;
  discarded = false;
  close(discard?: boolean) {
    this.discarded = !!discard;
    this.emit("close");
    this.removeAllListeners("data");
  }
  receive(data: unknown) {
    this.emit("packet", { type: "message", data });
    this.emit("data", data);
  }
}
function guarded(budgets: Budget, ip: string, guest: string, deadline = 30) {
  const engine = new Engine();
  guardTransport(
    engine,
    budgets,
    ip,
    () => guest,
    () => {},
    deadline,
  );
  engine.on("data", () => engine.forwarded++);
  return engine;
}
test("ingress budgets span tabs, reconnects, identities and IPs before decoder delivery", () => {
  const budgets = new Budget(),
    block = Buffer.alloc(VOICE_MAX_BYTES);
  for (let i = 0; i < 6; i++) {
    const tab = guarded(budgets, "ip:" + i, "same-guest");
    tab.receive(block);
    assert.equal(tab.forwarded, 1);
    tab.close(true);
  }
  const reconnect = guarded(budgets, "new-ip", "same-guest");
  reconnect.receive(block);
  assert(reconnect.discarded);
  assert.equal(reconnect.forwarded, 0);
  const shared = new Budget();
  for (let guest = 0; guest < 6; guest++) {
    const tab = guarded(shared, "shared-ip", "guest:" + guest);
    for (let i = 0; i < 4; i++) tab.receive(block);
    assert.equal(tab.forwarded, 4);
    tab.close(true);
  }
  const stranger = guarded(shared, "shared-ip", "another-guest");
  stranger.receive(block);
  assert(stranger.discarded);
  assert.equal(stranger.forwarded, 0);
  const counts = new Budget(),
    tab = guarded(counts, "ip", "guest");
  for (let i = 0; i < 600; i++) tab.receive('2["unknown"]');
  tab.receive('2["unknown"]');
  assert(tab.discarded);
  assert.equal(tab.forwarded, 600);
});
test("absolute attachment deadline expires and completion/close cancel it", async () => {
  const stalled = guarded(new Budget(), "ip", "guest");
  stalled.receive(header());
  await wait(60);
  assert(stalled.discarded);
  const complete = guarded(new Budget(), "ip", "guest");
  complete.receive(header());
  complete.receive(Buffer.alloc(16));
  await wait(60);
  assert(!complete.discarded);
  let rejections = 0;
  const closed = new Engine();
  guardTransport(
    closed,
    new Budget(),
    "ip",
    () => "guest",
    () => rejections++,
    30,
  );
  closed.receive(header());
  closed.close(true);
  await wait(60);
  assert.equal(rejections, 0);
  complete.close(true);
});

for (const { transport, forceBase64 } of [
  { transport: "websocket", forceBase64: false },
  { transport: "polling", forceBase64: false },
  { transport: "websocket", forceBase64: true },
] as const) {
  test(`${transport}${forceBase64 ? " base64" : ""}: full-size voice works, multi-attachment input and stalled uploads disconnect`, async () => {
    const service = createApplication({
      dbPath: ":memory:",
      binaryTimeoutMs: 1000,
    });
    const clients: Socket[] = [];
    service.http.listen(0, "127.0.0.1");
    await once(service.http, "listening");
    const url = `http://127.0.0.1:${(service.http.address() as { port: number }).port}`;
    async function connect() {
      const response = await fetch(url + "/api/session");
      const socket = io(url, {
        autoConnect: false,
        transports: [transport],
        forceBase64,
        reconnection: false,
        extraHeaders: {
          Cookie: response.headers.get("set-cookie")!.split(";")[0],
        },
      });
      clients.push(socket);
      socket.connect();
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return socket;
    }
    const call = (s: Socket, event: string, data: unknown = {}) =>
      s.timeout(3000).emitWithAck(event, data) as Promise<Reply>;
    try {
      const member = await connect();
      assert(
        (
          await call(member, "room:create", {
            name: "Transport control",
            playerName: "Alice",
            public: false,
            bots: 0,
          })
        ).ok,
      );
      assert(
        (
          await call(member, "voice:send", {
            audio: Buffer.concat([
              Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
              Buffer.alloc(VOICE_MAX_BYTES - 4),
            ]),
            mime: "audio/webm",
            duration: 60,
          })
        ).ok,
      );
      await wait(1100);
      assert(member.connected);
      assert((await call(member, "clock:sync")).ok);
      const attacker = await connect();
      const ended = new Promise<void>((resolve) =>
        attacker.once("disconnect", () => resolve()),
      );
      attacker.io.engine.write(header("10"));
      await Promise.race([
        ended,
        wait(2000).then(() => {
          throw new Error("Malformed input did not disconnect");
        }),
      ]);
      assert.equal(attacker.connected, false);
      const stalled = await connect();
      const expired = new Promise<void>((resolve) =>
        stalled.once("disconnect", () => resolve()),
      );
      stalled.io.engine.write(header());
      await Promise.race([
        expired,
        wait(2000).then(() => {
          throw new Error("Incomplete upload did not expire");
        }),
      ]);
      assert.equal(stalled.connected, false);
      assert((await call(member, "clock:sync")).ok);
    } finally {
      clients.forEach((s) => s.disconnect());
      await service.close();
    }
  });
}

test("rate diagnostics distinguish quota and capacity while retaining expiry behaviour", () => {
  const b = new Budget(1);
  assert(b.take("a", 1, 1000, 1, 100));
  assert.equal(b.take("a", 1, 1000, 1, 101), false);
  assert.equal(b.take("b", 1, 1000, 1, 101), false);
  assert.deepEqual(b.snapshot(), {
    keys: 1,
    maxKeys: 1,
    quotaRejected: 1,
    capacityRejected: 1,
  });
  assert(b.take("b", 1, 1000, 1, 1101));
});
