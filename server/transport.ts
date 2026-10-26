import * as parser from "socket.io-parser";
import { VOICE_MAX_BYTES } from "../shared/voice.js";
import { Budget } from "./security.js";

export const MAX_PACKET_TEXT_BYTES = 16 * 1024;
// Polling encodes binary as base64 before Engine.IO decodes it. The decoded
// limit below remains one MiB, including for WebSocket/base64 representations.
export const MAX_TRANSPORT_BYTES =
  4 * Math.ceil(VOICE_MAX_BYTES / 3) + MAX_PACKET_TEXT_BYTES;
export const BINARY_DEADLINE_MS = 30000;

export function packetBytes(data: unknown) {
  if (typeof data === "string") return Buffer.byteLength(data);
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
    return data.byteLength;
  throw new Error("Unsupported transport payload");
}

export class BoundedDecoder extends parser.Decoder {
  constructor() {
    // Voice requires one attachment. Reject multi-attachment events/acks before
    // BinaryReconstructor can retain their first buffer, regardless of event name.
    super({ maxAttachments: 1 });
  }
  override add(data: unknown) {
    try {
      const limit =
        typeof data === "string" ? MAX_PACKET_TEXT_BYTES : VOICE_MAX_BYTES;
      if (packetBytes(data) > limit)
        throw new Error("Transport payload too large");
      super.add(data);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
}
export const boundedParser = { ...parser, Decoder: BoundedDecoder };

type Connection = {
  on(
    event: "packet",
    listener: (packet: { type: string; data?: unknown }) => void,
  ): unknown;
  once(event: "close", listener: () => void): unknown;
  close(discard?: boolean): unknown;
};

export function guardTransport(
  connection: Connection,
  budgets: Budget,
  ip: string,
  guest: () => string | undefined,
  rejected: () => void,
  deadlineMs = BINARY_DEADLINE_MS,
) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0)
    throw new Error("Invalid binary attachment deadline");
  let pending: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const clearPending = () => {
    if (pending) clearTimeout(pending);
    pending = undefined;
  };
  const reject = () => {
    if (closed) return;
    closed = true;
    clearPending();
    rejected();
    // Discard synchronously closes polling as well as WebSocket. Engine.IO's
    // packet hook runs before its data emission; close removes Socket.IO's data
    // listener before rejected input can reach its decoder.
    connection.close(true);
  };
  connection.on("packet", (packet) => {
    if (closed || packet.type !== "message") return;
    try {
      const data = packet.data,
        bytes = packetBytes(data),
        id = guest();
      const text = typeof data === "string";
      if (
        bytes > (text ? MAX_PACKET_TEXT_BYTES : VOICE_MAX_BYTES) ||
        (pending && text) ||
        !budgets.take(`ingress-ip-count:${ip}`, 3000, 60000) ||
        !budgets.take(
          `ingress-ip-bytes:${ip}`,
          24 * VOICE_MAX_BYTES,
          60000,
          bytes,
        ) ||
        (id &&
          (!budgets.take(`ingress-user-count:${id}`, 600, 60000) ||
            !budgets.take(
              `ingress-user-bytes:${id}`,
              6 * VOICE_MAX_BYTES,
              60000,
              bytes,
            )))
      ) {
        reject();
        return;
      }
      if (text && (data[0] === "5" || data[0] === "6")) {
        pending = setTimeout(reject, deadlineMs);
        pending.unref();
      } else if (!text) clearPending();
    } catch {
      reject();
    }
  });
  connection.once("close", () => {
    closed = true;
    clearPending();
  });
}
