import assert from "node:assert/strict";
import { WebSocket } from "ws";

/** Wire-level probe shared by image and deployed-release checks. No mic or saved media. */
export async function probeLiveVoice(origin, senderCookie, listenerCookie) {
  const peers = [];
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function connect(cookie) {
    const url = new URL("/live-voice", origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, "ludo-voice-v1", {
      headers: { Cookie: cookie, Origin: origin },
    });
    const peer = { ws, messages: [], frames: [], error: undefined };
    peers.push(peer);
    ws.on("message", (data, binary) => {
      if (binary) peer.frames.push(Buffer.from(data));
      else peer.messages.push(JSON.parse(data.toString()));
    });
    ws.on("error", (error) => {
      peer.error = error;
    });
    const until = Date.now() + 8000;
    while (ws.readyState !== WebSocket.OPEN) {
      if (
        peer.error ||
        ws.readyState === WebSocket.CLOSED ||
        Date.now() > until
      )
        throw new Error("Live voice upgrade failed", { cause: peer.error });
      await pause(10);
    }
    peer.send = (message) => ws.send(JSON.stringify(message));
    peer.wait = async (type) => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const index = peer.messages.findIndex(
          (message) => message.type === type,
        );
        if (index >= 0) return peer.messages.splice(index, 1)[0];
        if (peer.error || ws.readyState !== WebSocket.OPEN)
          throw new Error("Live voice closed before " + type);
        await pause(10);
      }
      throw new Error("Live voice timed out waiting for " + type);
    };
    peer.send({ type: "listen", ready: true, muted: false });
    return peer;
  }
  try {
    const sender = await connect(senderCookie),
      listener = await connect(listenerCookie);
    await pause(50);
    sender.send({ type: "start", request: 1 });
    const grant = await sender.wait("grant");
    assert.equal(grant.ok, true, "Live floor was not granted");
    const started = await listener.wait("start");
    assert.equal(started.stream, grant.stream);
    const packet = Buffer.alloc(15);
    packet.writeUInt32BE(grant.stream, 0);
    packet.set([0xf8, 0xff, 0xfe], 12); // A small valid Opus silence packet.
    sender.ws.send(packet);
    const deadline = Date.now() + 8000;
    while (!listener.frames.length && Date.now() < deadline) await pause(10);
    assert.deepEqual(listener.frames, [packet]);
    assert.equal(sender.frames.length, 0);
    sender.send({ type: "end", request: 1 });
    const ended = await listener.wait("end");
    assert.equal(ended.frames, 1);
    listener.send({ type: "delivered", stream: grant.stream });
    assert.equal((await sender.wait("finished")).ok, true);
    return { upgrade: true, roomScopedFrame: true, deliveryAcknowledged: true };
  } finally {
    for (const peer of peers) peer.ws.terminate();
  }
}
