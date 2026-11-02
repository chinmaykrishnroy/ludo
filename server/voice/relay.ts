import { randomInt } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { Budget } from "../security.js";
import {
  LIVE_VOICE_PATH,
  LIVE_VOICE_PROTOCOL,
  LIVE_HEADER_BYTES,
  LIVE_MAX_PACKET_BYTES,
  LIVE_BUFFER_BYTES,
  LIVE_MAX_SECONDS,
  LIVE_FRAME_MS,
} from "../../shared/liveVoice.js";
import type { LiveSpeaker } from "../../shared/liveVoice.js";

type Identity = { id: string; room: string };
type Peer = Identity & {
  ws: WebSocket;
  request: IncomingMessage;
  ip: string;
  ready: boolean;
  muted: boolean;
  alive: boolean;
};
type Floor = {
  stream: number;
  sender: Peer;
  listeners: Set<Peer>;
  started: number;
  lastFrame: number;
  sequence: number;
  request: number;
  ending?: number;
  delivered: Set<Peer>;
};
type Options = {
  enabled: boolean;
  maxConnections: number;
  maxPerGuest: number;
  maxPerIp: number;
  authenticate: (req: IncomingMessage) => Identity;
  address: (req: IncomingMessage) => string;
  member: (id: string, room: string) => LiveSpeaker | undefined;
  members: (room: string) => string[];
  blocked: (listener: string, sender: string) => boolean;
  capacity: () => boolean;
  failure: (error: unknown) => void;
};

/** One room floor, zero media persistence/transcoding, bounded fan-out and queues. */
export class LiveVoiceRelay {
  private server = new WebSocketServer({
    noServer: true,
    maxPayload: LIVE_MAX_PACKET_BYTES,
    maxFragments: 8,
    maxBufferedChunks: 32,
    autoPong: false,
    perMessageDeflate: false,
    handleProtocols: (protocols) =>
      protocols.has(LIVE_VOICE_PROTOCOL) ? LIVE_VOICE_PROTOCOL : false,
  });
  private peers = new Set<Peer>();
  private byRoom = new Map<string, Set<Peer>>();
  private floors = new Map<string, Floor>();
  private budgets = new Budget(10000);
  private timer: ReturnType<typeof setInterval>;
  private heartbeat = 0;
  private stopped = false;
  readonly stats = {
    frames: 0,
    bytesIn: 0,
    bytesOut: 0,
    rejected: 0,
    fallbacks: 0,
    completed: 0,
  };
  constructor(
    private http: Server,
    private options: Options,
  ) {
    http.on("upgrade", this.upgrade);
    this.timer = setInterval(() => this.sweep(), 1000);
    this.timer.unref();
  }
  snapshot() {
    return {
      enabled: this.options.enabled,
      connections: this.peers.size,
      speakers: this.floors.size,
      ...this.stats,
    };
  }
  private upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.split("?")[0] !== LIVE_VOICE_PATH) return;
    socket.once("error", () => socket.destroy());
    // No bearer tokens in URLs or unauthenticated waiting sockets.
    try {
      const ip = this.options.address(req);
      if (
        this.stopped ||
        !this.options.enabled ||
        this.peers.size >= this.options.maxConnections ||
        !this.budgets.take(`connect:${ip}`, 120, 60000)
      )
        throw Error("Unavailable");
      const identity = this.options.authenticate(req);
      if (
        [...this.peers].filter((p) => p.id === identity.id).length >=
          this.options.maxPerGuest ||
        [...this.peers].filter((p) => p.ip === ip).length >=
          this.options.maxPerIp
      )
        throw Error("Connection limit");
      if (req.headers["sec-websocket-protocol"] !== LIVE_VOICE_PROTOCOL)
        throw Error("Protocol");
      this.server.handleUpgrade(req, socket, head, (ws) =>
        this.connect({
          ...identity,
          ws,
          request: req,
          ip,
          ready: false,
          muted: false,
          alive: true,
        }),
      );
    } catch (error) {
      this.stats.rejected++;
      if (/SQLITE|database/i.test(String(error))) this.options.failure(error);
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        () => socket.destroy(),
      );
    }
  };
  private connect(p: Peer) {
    this.peers.add(p);
    const room = this.byRoom.get(p.room) ?? new Set<Peer>();
    room.add(p);
    this.byRoom.set(p.room, room);
    p.ws.on("error", () => this.drop(p));
    p.ws.on("close", () => this.drop(p));
    p.ws.on("pong", () => {
      p.alive = true;
    });
    p.ws.on("ping", (data) => {
      if (
        p.ws.bufferedAmount > LIVE_BUFFER_BYTES ||
        !this.budgets.take(`ping:${p.id}`, 12, 10000)
      ) {
        this.stats.rejected++;
        this.drop(p);
        return;
      }
      p.ws.pong(data);
    });
    p.ws.on("message", (data, binary) => {
      try {
        if (!this.options.member(p.id, p.room)) {
          this.drop(p);
          return;
        }
        if (binary) this.frame(p, data);
        else this.control(p, JSON.parse(data.toString()));
      } catch (error) {
        this.stats.rejected++;
        this.drop(p);
        // Unexpected programming/storage failures are observable without exposing them to peers.
        if (!(error instanceof SyntaxError) && !(error instanceof RangeError))
          this.options.failure(error);
      }
    });
    this.send(p, { type: "hello", version: 1 });
  }
  private send(p: Peer, message: unknown) {
    if (
      p.ws.readyState !== WebSocket.OPEN ||
      p.ws.bufferedAmount > LIVE_BUFFER_BYTES
    )
      return false;
    p.ws.send(JSON.stringify(message), (error) => {
      if (error) this.drop(p);
    });
    return true;
  }
  private control(p: Peer, input: unknown) {
    if (
      !this.budgets.take(`controls:${p.id}`, 60, 10000) ||
      !this.budgets.take(`controls-ip:${p.ip}`, 600, 10000)
    ) {
      this.drop(p);
      return;
    }
    const m = input as {
      type?: string;
      ready?: boolean;
      muted?: boolean;
      request?: number;
      stream?: number;
    };
    if (!m || typeof m !== "object") {
      this.drop(p);
      return;
    }
    if (m.type === "delivered") {
      const floor = this.floors.get(p.room);
      if (
        floor?.ending &&
        floor.stream === m.stream &&
        floor.listeners.has(p)
      ) {
        floor.delivered.add(p);
        if (floor.delivered.size === floor.listeners.size)
          this.finish(p.room, true);
      }
      return;
    }
    if (
      m.type === "listen" &&
      typeof m.ready === "boolean" &&
      typeof m.muted === "boolean"
    ) {
      const wasMuted = p.muted;
      p.ready = m.ready;
      p.muted = m.muted;
      const floor = this.floors.get(p.room);
      if (floor?.listeners.has(p) && !p.ready && !p.muted) {
        floor.listeners.delete(p);
        if (!floor.listeners.size) this.finish(p.room, false);
      } else if (floor?.listeners.has(p) && wasMuted && !p.muted)
        this.send(p, {
          type: "start",
          stream: floor.stream,
          sequence: floor.sequence,
          speaker: this.options.member(floor.sender.id, p.room),
        });
      return;
    }
    if (!Number.isSafeInteger(m.request) || m.request! < 1) {
      this.drop(p);
      return;
    }
    if (m.type === "start") {
      if (
        !this.budgets.take(`starts:${p.id}`, 30, 60000) ||
        !this.options.capacity()
      ) {
        this.send(p, {
          type: "grant",
          request: m.request,
          ok: false,
          reason: "busy",
        });
        return;
      }
      if (this.floors.has(p.room)) {
        this.send(p, {
          type: "grant",
          request: m.request,
          ok: false,
          reason: "speaking",
        });
        return;
      }
      const otherMembers = this.options
        .members(p.room)
        .filter((id) => id !== p.id);
      const listeners = new Set<Peer>();
      let unreadyCount = 0;
      for (const id of otherMembers) {
        if (this.options.blocked(id, p.id)) continue;
        const peer = [...(this.byRoom.get(p.room) ?? [])].find(
          (x) =>
            x.id === id &&
            (x.ready || x.muted) &&
            x.ws.readyState === WebSocket.OPEN,
        );
        if (peer) {
          listeners.add(peer);
        } else {
          unreadyCount++;
        }
      }
      if (!listeners.size) {
        this.send(p, {
          type: "grant",
          request: m.request,
          ok: false,
          reason: "voice-note",
        });
        return;
      }
      const floor: Floor = {
        stream: randomInt(1, 0xffffffff),
        sender: p,
        listeners,
        started: performance.now(),
        lastFrame: performance.now(),
        sequence: 0,
        request: m.request!,
        delivered: new Set(),
      };
      this.floors.set(p.room, floor);
      const speaker = this.options.member(p.id, p.room)!;
      for (const listener of [...listeners])
        if (
          !this.send(listener, { type: "start", stream: floor.stream, speaker })
        ) {
          listeners.delete(listener);
          this.drop(listener);
        }
      this.send(p, {
        type: "grant",
        request: m.request,
        ok: true,
        stream: floor.stream,
        hasUnready: unreadyCount > 0,
      });
    } else if (m.type === "end" || m.type === "cancel") {
      const floor = this.floors.get(p.room);
      if (floor?.sender === p && floor.request === m.request) {
        if (m.type === "cancel" || !floor.sequence) this.finish(p.room, false);
        else if (!floor.ending) {
          floor.ending = performance.now();
          if (!floor.listeners.size) {
            this.finish(p.room, true);
          } else {
            for (const listener of [...floor.listeners])
              if (
                !this.send(listener, {
                  type: "end",
                  stream: floor.stream,
                  frames: floor.sequence,
                })
              ) {
                floor.listeners.delete(listener);
                this.drop(listener);
              }
            if (!floor.listeners.size) {
              this.finish(p.room, true);
            }
          }
        }
      }
    } else {
      this.drop(p);
    }
  }
  private frame(p: Peer, raw: RawData) {
    const f = this.floors.get(p.room);
    const data = raw as Buffer;
    const now = performance.now();
    if (
      !f ||
      f.ending ||
      f.sender !== p ||
      !Buffer.isBuffer(data) ||
      data.length <= LIVE_HEADER_BYTES ||
      data.length > LIVE_MAX_PACKET_BYTES ||
      data.readUInt32BE(0) !== f.stream ||
      data.readUInt32BE(4) !== f.sequence ||
      data.readUInt32BE(8) !== f.sequence * LIVE_FRAME_MS ||
      f.sequence >= LIVE_MAX_SECONDS * (1000 / LIVE_FRAME_MS) + 1 ||
      f.sequence * LIVE_FRAME_MS > now - f.started + 2000 ||
      now - f.started > LIVE_MAX_SECONDS * 1000 + 1000 ||
      !this.budgets.take(`frames:${p.id}`, 75, 1000) ||
      !this.budgets.take(`frames-ip:${p.ip}`, 1500, 1000)
    ) {
      this.stats.rejected++;
      this.drop(p);
      return;
    }
    f.sequence++;
    f.lastFrame = now;
    this.stats.frames++;
    this.stats.bytesIn += data.length;
    for (const listener of [...f.listeners]) {
      if (
        !this.options.member(listener.id, p.room) ||
        this.options.blocked(listener.id, p.id)
      ) {
        f.listeners.delete(listener);
        this.drop(listener);
        continue;
      }
      if (listener.muted) continue;
      if (
        !listener.ready ||
        listener.ws.readyState !== WebSocket.OPEN ||
        listener.ws.bufferedAmount > LIVE_BUFFER_BYTES
      ) {
        f.listeners.delete(listener);
        this.drop(listener);
        continue;
      }
      listener.ws.send(data, { binary: true }, (error) => {
        if (error) {
          f.listeners.delete(listener);
          this.drop(listener);
        }
      });
      this.stats.bytesOut += data.length;
    }
  }
  private finish(room: string, ok: boolean) {
    const floor = this.floors.get(room);
    if (!floor) return;
    this.floors.delete(room);
    if (ok) this.stats.completed++;
    else this.stats.fallbacks++;
    this.send(floor.sender, { type: "finished", request: floor.request, ok });
    if (!ok)
      for (const p of this.byRoom.get(room) ?? [])
        if (p !== floor.sender)
          this.send(p, { type: "abort", stream: floor.stream });
  }
  private drop(p: Peer) {
    if (!this.peers.delete(p)) return;
    this.byRoom.get(p.room)?.delete(p);
    if (!this.byRoom.get(p.room)?.size) this.byRoom.delete(p.room);
    const floor = this.floors.get(p.room);
    if (floor) {
      if (floor.sender === p) {
        this.finish(p.room, false);
      } else if (floor.listeners.has(p)) {
        floor.listeners.delete(p);
        if (!floor.listeners.size) {
          this.finish(p.room, false);
        }
      }
    }
    p.ws.terminate();
  }
  // Called synchronously after persisted membership/policy changes, before further media delivery.
  reconcile(code?: string) {
    for (const p of code ? (this.byRoom.get(code) ?? []) : this.peers)
      if (!this.options.member(p.id, p.room)) this.drop(p);
    const floors: Iterable<[string, Floor]> = code
      ? this.floors.has(code)
        ? [[code, this.floors.get(code)!]]
        : []
      : this.floors;
    for (const [room, f] of floors) {
      if (
        [...f.listeners].some((p) => this.options.blocked(p.id, f.sender.id))
      ) {
        this.finish(room, false);
        continue;
      }
      if (
        this.options
          .members(room)
          .some(
            (id) =>
              id !== f.sender.id &&
              !this.options.blocked(id, f.sender.id) &&
              ![...f.listeners].some((p) => p.id === id),
          )
      )
        this.finish(room, false);
    }
  }
  private sweep() {
    try {
      this.reconcile();
      const now = performance.now();
      for (const [room, f] of this.floors)
        if (f.ending && now - f.ending > 3000) {
          this.finish(room, f.delivered.size > 0 || !f.listeners.size);
        } else if (
          now - f.lastFrame > 2500 ||
          now - f.started > LIVE_MAX_SECONDS * 1000 + 2000
        ) {
          this.finish(room, false);
        }
      if (++this.heartbeat % 15 === 0) {
        for (const p of this.peers) {
          try {
            if (
              !p.alive ||
              this.options.authenticate(p.request).room !== p.room
            ) {
              this.drop(p);
              continue;
            }
            p.alive = false;
            p.ws.ping();
          } catch {
            this.drop(p);
          }
        }
        this.budgets.sweep();
      }
    } catch (error) {
      this.options.failure(error);
      for (const p of this.peers) this.drop(p);
    }
  }
  close() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    this.http.off("upgrade", this.upgrade);
    for (const p of this.peers) this.drop(p);
    this.server.close();
  }
}
