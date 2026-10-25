import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { Server } from "socket.io";
import { z } from "zod";
import { Store, type VoiceWrite } from "./store.js";
import { Monitor } from "./monitor.js";
import { roomSchema } from "./validation.js";
import {
  Budget,
  COOKIE,
  SESSION_MS,
  hash,
  newSecret,
  secretFromCookie,
  trustedClient,
  adminAuthorized,
  PublicError,
} from "./security.js";
import { seat, newGame, roll, move, legalMoves } from "../shared/game.js";
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from "../shared/voice.js";
import type { Room, Reply } from "../shared/protocol.js";
import { DEFAULT_BOT_DIFFICULTY, validDifficulty } from "../shared/bot.js";
import { AiScheduler } from "./ai/scheduler.js";
import { difficultyPolicy } from "../shared/ai/policy.js";
import { publicRoomPage, PUBLIC_ROOM_PAGE_SIZE } from "./public-rooms.js";
const label = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[\p{L}\p{N} ._'’-]+$/u);
const roomCode = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z2-9]{6}$/),
  revision = z.object({ revision: z.number().int().nonnegative() });
const guestChannel = (id: string) => `guest:${id}`;
const memberIds = (r: Room) =>
  r.seats.flatMap((s) => (s && !s.id.startsWith("bot:") ? [s.id] : []));
export type ApplicationOptions = {
  aiScheduler?: AiScheduler;
  botDifficulty?: number;
  dbPath?: string;
  allowedOrigins?: string[];
  botDelay?: number;
  maxRooms?: number;
  maxConnections?: number;
  maxGuestConnections?: number;
  maxIpConnections?: number;
  publicRoomsEnabled?: boolean;
  adminToken?: string;
  trustProxy?: string[];
  voiceRetentionMs?: number;
  maxVoiceBytes?: number;
  tickMs?: number;
  maintenanceMs?: number;
  minimumFreeBytes?: number;
};
export function createApplication(options: ApplicationOptions = {}) {
  const aiBudget = {
    iterations: Number(process.env.AI_SEARCH_ITERATIONS ?? 96),
    maxDepth: Number(process.env.AI_SEARCH_DEPTH ?? 24),
    maxTimeMs: Number(process.env.AI_SEARCH_MS ?? 120),
  };
  difficultyPolicy(10, aiBudget);
  const app = express(),
    http = createServer(app),
    store = new Store(options.dbPath ?? "data/ludo.sqlite", options),
    monitor = new Monitor(),
    budgets = new Budget();
  const rooms = new Map(store.load().map((r) => [r.code, r])),
    playerRooms = new Map<string, string>(),
    transitions = new Map<string, number>(),
    offlineSince = new Map<string, number>();
  const guestSockets = new Map<string, Set<string>>(),
    ipSockets = new Map<string, Set<string>>();
  const proxy = trustedClient(options.trustProxy ?? ["loopback"]),
    defaultBotDifficulty =
      options.botDifficulty ??
      Number(process.env.BOT_DIFFICULTY ?? DEFAULT_BOT_DIFFICULTY),
    adminToken = options.adminToken ?? process.env.ADMIN_TOKEN,
    publicEnabled =
      options.publicRoomsEnabled ?? process.env.PUBLIC_ROOMS_ENABLED === "true";
  if (!validDifficulty(defaultBotDifficulty)) {
    store.close();
    monitor.close();
    throw new Error("BOT_DIFFICULTY must be an integer from 0 to 10");
  }
  if (publicEnabled && !adminToken) {
    store.close();
    monitor.close();
    throw new Error(
      "Public rooms require ADMIN_TOKEN and moderation to be configured",
    );
  }
  if (adminToken && adminToken.length < 32) {
    store.close();
    monitor.close();
    throw new Error("ADMIN_TOKEN must contain at least 32 characters");
  }
  const ai =
    options.aiScheduler ??
    new AiScheduler({
      searchBudget: aiBudget,
    });
  const aiJobs = new Map<string, string>();
  let closing = false,
    storageRetryAt = 0,
    lastMaintenance = 0,
    lastLease = 0;
  try {
    for (const r of rooms.values()) {
      let changed = false;
      for (const s of r.seats)
        if (s && !s.id.startsWith("bot:")) {
          changed ||= s.connected;
          s.connected = false;
          offlineSince.set(s.id, Date.now());
          playerRooms.set(s.id, r.code);
        }
      if (r.game) r.game.seats = structuredClone(r.seats);
      if (changed) store.save(r);
    }
  } catch (error) {
    monitor.close();
    store.close();
    throw error;
  }
  const originAllowed = (
    origin: string | undefined,
    host: string | undefined,
  ) =>
    !origin ||
    !!options.allowedOrigins?.includes(origin) ||
    (() => {
      try {
        const u = new URL(origin);
        return (
          (u.protocol === "https:" || u.protocol === "http:") && u.host === host
        );
      } catch {
        return false;
      }
    })();
  const limited = (key: string, limit: number, window = 60000, cost = 1) => {
    if (!budgets.take(key, limit, window, cost)) {
      monitor.rejected++;
      throw new PublicError(
        "Too many requests. Please try again shortly.",
        "RATE_LIMITED",
      );
    }
  };
  const failure = (context: string, error: unknown) => {
    monitor.failure(context, error);
    if (
      /SQLITE_(FULL|BUSY|IOERR|READONLY|CANTOPEN)|database.*lease/i.test(
        String(error),
      )
    )
      storageRetryAt = Date.now() + 2000;
  };
  const activeRoom = (id: string) => {
    const code = playerRooms.get(id);
    return code ? rooms.get(code) : undefined;
  };
  function indexRoom(r: Room) {
    const old = rooms.get(r.code);
    if (old)
      for (const id of memberIds(old))
        if (playerRooms.get(id) === r.code) playerRooms.delete(id);
    rooms.set(r.code, r);
    for (const id of memberIds(r)) playerRooms.set(id, r.code);
  }
  function eraseRoom(code: string) {
    ai.cancel(code);
    const old = rooms.get(code);
    if (old)
      for (const id of memberIds(old))
        if (playerRooms.get(id) === code) playerRooms.delete(id);
    rooms.delete(code);
    transitions.delete(code);
  }
  const engineIps = new Map<string, Set<string>>();
  const io = new Server(http, {
    serveClient: false,
    maxHttpBufferSize: VOICE_MAX_BYTES + 65536,
    allowRequest: (req, done) => {
      try {
        if (
          closing ||
          io.engine.clientsCount >= (options.maxConnections ?? 1000)
        )
          throw new PublicError("Server is busy");
        if (!originAllowed(req.headers.origin, req.headers.host))
          throw new PublicError("Origin denied");
        limited(`handshake:${proxy.address(req)}`, 120);
        if (
          (engineIps.get(proxy.address(req))?.size ?? 0) >=
          (options.maxIpConnections ?? 80)
        )
          throw new PublicError("Too many connections");
        done(null, true);
      } catch {
        done("Connection unavailable", false);
      }
    },
  });
  io.engine.on("connection", (connection) => {
    const ip = proxy.address(connection.request),
      set = engineIps.get(ip) ?? new Set<string>();
    set.add(connection.id);
    engineIps.set(ip, set);
    const timer = setTimeout(() => {
      if (
        !(connection as typeof connection & { ludoAuthenticated?: boolean })
          .ludoAuthenticated
      )
        connection.close();
    }, 10000);
    timer.unref();
    connection.once("close", () => {
      clearTimeout(timer);
      set.delete(connection.id);
      if (!set.size) engineIps.delete(ip);
    });
  });
  function view(
    r: Room,
    id: string,
    blocked = new Set(store.blockedSubjects(id)),
  ) {
    return {
      ...r,
      voices: r.voices.filter((v) =>
        v.senderId ? !blocked.has(v.senderId) : blocked.size === 0,
      ),
      chat: r.chat.filter((v) =>
        v.senderId ? !blocked.has(v.senderId) : blocked.size === 0,
      ),
    };
  }
  function emitRoom(r: Room) {
    const deliveries = memberIds(r).map((id) => ({ id, room: view(r, id) }));
    for (const delivery of deliveries)
      io.to(guestChannel(delivery.id)).emit("room:state", delivery.room);
  }
  function commit(
    input: Room,
    config: {
      activity?: boolean;
      delay?: number;
      voice?: VoiceWrite;
      archive?: boolean;
    } = {},
  ) {
    let draft = structuredClone(input);
    if (draft.game) draft.seats = structuredClone(draft.game.seats);
    draft.updatedAt = Date.now();
    if (config.activity !== false) draft.lastHumanAt = Date.now();
    draft.voices = draft.voices
      .filter((v) => v.at >= Date.now() - store.voiceRetentionMs)
      .slice(-20);
    draft = roomSchema.parse(draft);
    if (Date.now() < storageRetryAt)
      throw new Error("Storage temporarily unavailable");
    const old = rooms.get(draft.code),
      oldIds = old ? memberIds(old) : [],
      newIds = memberIds(draft);
    const deliveries = newIds.map((id) => ({ id, room: view(draft, id) }));
    store.save(draft, config.voice);
    if (
      old?.game?.revision !== draft.game?.revision ||
      old?.game?.seats[old.game.turn]?.id !==
        draft.game?.seats[draft.game.turn]?.id
    )
      ai.cancel(draft.code);
    monitor.success();
    indexRoom(structuredClone(draft));
    if (config.delay !== undefined)
      transitions.set(draft.code, Date.now() + config.delay);
    // Revocation precedes delivery. Guest channels include all tabs, not just the caller.
    for (const id of oldIds)
      if (!newIds.includes(id)) {
        io.in(guestChannel(id)).socketsLeave(draft.code);
        io.to(guestChannel(id)).emit("room:left", { code: draft.code });
      }
    for (const id of newIds) io.in(guestChannel(id)).socketsJoin(draft.code);
    for (const delivery of deliveries)
      io.to(guestChannel(delivery.id)).emit("room:state", delivery.room);
    if (config.archive) eraseRoom(draft.code);
    return draft;
  }
  function transfer(r: Room) {
    if (!r.seats.some((s) => s?.id === r.host && !s.bot && s.connected)) {
      const host = r.seats.find((s) => s && !s.bot && s.connected);
      if (host) r.host = host.id;
    }
  }
  function automaticallyAdvance(r: Room, now: number) {
    const g = r.game!;
    r.game =
      g.phase === "roll"
        ? roll(g, randomInt(1, 7), now)
        : move(g, legalMoves(g)[0], now);
    return commit(r, { activity: false, delay: 1100 });
  }
  function scheduleBot(r: Room) {
    const snapshot = structuredClone(r.game!),
      actor = snapshot.seats[snapshot.turn]!;
    if (aiJobs.has(r.code)) return;
    const identity = `${snapshot.revision}:${actor.id}`;
    aiJobs.set(r.code, identity);
    void ai
      .request(
        r.code,
        snapshot,
        actor.botDifficulty ??
          r.botDifficulty ??
          snapshot.botDifficulty ??
          defaultBotDifficulty,
      )
      .then((decision) => {
        const current = rooms.get(r.code),
          game = current?.game;
        if (
          closing ||
          !current ||
          current.archived ||
          !game ||
          game.revision !== snapshot.revision ||
          game.phase !== "move" ||
          game.turn !== snapshot.turn ||
          game.seats[game.turn]?.id !== actor.id ||
          !game.seats[game.turn]?.id.startsWith("bot:") ||
          !legalMoves(game).includes(decision.token) ||
          !memberIds(current).some((id) => guestSockets.has(id))
        )
          return;
        const draft = structuredClone(current);
        draft.game = move(game, decision.token, Date.now());
        commit(draft, { activity: false, delay: 1100 });
      })
      .catch((error) => {
        if (error.name !== "AbortError" && !closing)
          failure("bot_commit", error);
      })
      .finally(() => {
        if (aiJobs.get(r.code) === identity) aiJobs.delete(r.code);
      });
  }
  function sessionFor(cookie: string | undefined, ip: string) {
    const secret = secretFromCookie(cookie),
      id = secret ? hash(secret) : null;
    if (!id || !store.session(id))
      throw new PublicError(
        "Please refresh to establish a session.",
        "SESSION_EXPIRED",
      );
    if (store.banned(`user:${id}`) || store.banned(`ip:${hash(ip)}`))
      throw new PublicError(
        "This guest session is blocked.",
        "SESSION_BLOCKED",
      );
    store.touchSession(id);
    return id;
  }
  function release(socketId: string, id: string, ip: string) {
    guestSockets.get(id)?.delete(socketId);
    if (!guestSockets.get(id)?.size) guestSockets.delete(id);
    ipSockets.get(ip)?.delete(socketId);
    if (!ipSockets.get(ip)?.size) ipSockets.delete(ip);
  }
  io.use((socket, next) => {
    try {
      const ip = proxy.address(socket.request);
      limited(`connect-ip:${ip}`, 120);
      const id = sessionFor(socket.request.headers.cookie, ip);
      limited(`connect-user:${id}`, 20);
      if (
        (guestSockets.get(id)?.size ?? 0) >=
          (options.maxGuestConnections ?? 4) ||
        (ipSockets.get(ip)?.size ?? 0) >= (options.maxIpConnections ?? 80)
      )
        throw new PublicError("Too many open game tabs.", "CONNECTION_LIMIT");
      socket.data.user = id;
      (
        socket.conn as typeof socket.conn & { ludoAuthenticated?: boolean }
      ).ludoAuthenticated = true;
      socket.data.ip = ip;
      const guests = guestSockets.get(id) ?? new Set<string>(),
        ips = ipSockets.get(ip) ?? new Set<string>();
      guests.add(socket.id);
      ips.add(socket.id);
      guestSockets.set(id, guests);
      ipSockets.set(ip, ips);
      socket.conn.once("close", () => release(socket.id, id, ip));
      next();
    } catch (error) {
      const e = new Error(
        error instanceof PublicError
          ? error.message
          : "Storage is temporarily unavailable.",
      ) as Error & { data?: unknown };
      e.data = {
        code: error instanceof PublicError ? error.code : "STORAGE_UNAVAILABLE",
      };
      if (!(error instanceof PublicError)) failure("socket_auth", error);
      next(e);
    }
  });
  app.disable("x-powered-by");
  app.set("trust proxy", proxy.trust);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            ...(process.env.NODE_ENV === "production"
              ? []
              : ["'unsafe-inline'"]),
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: [
            "'self'",
            ...(process.env.NODE_ENV === "production" ? [] : ["ws:", "wss:"]),
          ],
          fontSrc: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: (req) => proxy.address(req),
    }),
  );
  app.get("/api/config", (_req, res) =>
    res.json({
      publicRoomsEnabled: publicEnabled,
      defaultBotDifficulty,
      voiceMaxSeconds: VOICE_MAX_SECONDS,
      voiceRetentionHours: store.voiceRetentionMs / 3600000,
      unfinishedRoomRetentionDays: 30,
    }),
  );
  app.get("/api/stats", (_req, res) =>
    res
      .set("Cache-Control", "public, max-age=15")
      .json({ ...store.stats(), activePlayers: guestSockets.size }),
  );
  function health() {
    const database = store.health(),
      disk =
        store.path === ":memory:"
          ? { freeBytes: Number.MAX_SAFE_INTEGER, totalBytes: 0 }
          : monitor.disk(store.path);
    return {
      ok:
        !closing &&
        monitor.storageHealthy &&
        disk.freeBytes >= (options.minimumFreeBytes ?? 128 * 1024 * 1024) &&
        database.quarantined === 0,
      rooms: rooms.size,
      database,
      disk,
      ...monitor.snapshot(),
      connections: io.engine.clientsCount,
      ai: { ...ai.stats, pending: ai.pending },
    };
  }
  app.get("/livez", (_req, res) => res.json({ ok: true }));
  app.get(["/api/health", "/readyz"], (_req, res) => {
    try {
      const h = health();
      res.status(h.ok ? 200 : 503).json({ ok: h.ok, rooms: h.rooms });
    } catch (error) {
      failure("health", error);
      res.status(503).json({ ok: false });
    }
  });
  function admin(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    if (!adminAuthorized(req.headers.authorization, adminToken)) {
      res.sendStatus(404);
      return;
    }
    next();
  }
  app.get("/api/admin/health", admin, (_req, res) => res.json(health()));
  app.get("/metrics", admin, (_req, res) => {
    const h = health();
    res
      .type("text/plain")
      .send(
        `ludo_ready ${h.ok ? 1 : 0}\nludo_rooms ${rooms.size}\nludo_connections ${io.engine.clientsCount}\nludo_storage_errors_total ${monitor.storageErrors}\nludo_rejected_total ${monitor.rejected}\nludo_actions_total ${monitor.actions}\nludo_memory_rss_bytes ${h.memory.rss}\nludo_event_loop_p95_ms ${h.eventLoopP95Ms}\nludo_disk_free_bytes ${h.disk.freeBytes}\nludo_voice_bytes ${h.database.voiceBytes}\n`,
      );
  });
  app.get("/api/session", (req, res) => {
    const ip = proxy.address(req);
    if (!originAllowed(req.headers.origin, req.headers.host))
      throw new PublicError("Origin denied", "FORBIDDEN");
    if (store.banned(`ip:${hash(ip)}`))
      throw new PublicError("Access blocked", "FORBIDDEN");
    let secret = secretFromCookie(req.headers.cookie),
      id = secret ? hash(secret) : null;
    if (id && store.banned(`user:${id}`))
      throw new PublicError("Access blocked", "FORBIDDEN");
    if (!id || !store.session(id)) {
      limited(`session-issue:${ip}`, 100);
      secret = newSecret();
      id = hash(secret);
      store.issueSession(id);
    } else store.touchSession(id);
    res.cookie(COOKIE, secret, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
      maxAge: SESSION_MS,
      path: "/",
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true });
  });
  app.get("/api/voice/:id", (req, res) => {
    const ip = proxy.address(req);
    let id: string;
    try {
      id = sessionFor(req.headers.cookie, ip);
    } catch (error) {
      if (error instanceof PublicError) {
        res.sendStatus(404);
        return;
      }
      throw error;
    }
    limited(`voice-download:${id}`, 120);
    const blob = store.getVoice(String(req.params.id)),
      room = blob && activeRoom(id),
      metadata = room?.voices.find((v) => v.id === req.params.id);
    if (
      !blob ||
      !room ||
      room.code !== blob.room ||
      !metadata ||
      (metadata.senderId
        ? store.blocked(id, metadata.senderId)
        : store.blockedSubjects(id).length > 0)
    ) {
      res.sendStatus(404);
      return;
    }
    res
      .set({
        "Content-Type": blob.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(Buffer.from(blob.data));
  });
  app.use("/api/admin", admin, express.json({ limit: "8kb" }));
  app.get("/api/admin/reports", (_req, res) => res.json(store.reports()));
  app.post("/api/admin/bans", (req, res) => {
    const input = z
      .object({
        player: z.string().regex(/^[a-f0-9]{64}$/),
        minutes: z.number().int().min(1).max(43200),
        reason: z.string().trim().min(1).max(500),
      })
      .parse(req.body);
    store.setBan(
      `user:${input.player}`,
      Date.now() + input.minutes * 60000,
      input.reason,
    );
    io.to(guestChannel(input.player)).emit("session:blocked");
    io.in(guestChannel(input.player)).disconnectSockets(true);
    res.json({ ok: true });
  });
  io.on("connection", (socket) => {
    const id = socket.data.user as string,
      ip = socket.data.ip as string;
    socket.join(guestChannel(id));
    socket.emit("session", { me: id, serverNow: Date.now() });
    try {
      const saved = activeRoom(id) ?? store.findByPlayer(id);
      if (saved) {
        const r = structuredClone(saved);
        r.archived = false;
        for (const other of r.seats)
          if (other && !other.id.startsWith("bot:"))
            other.connected = guestSockets.has(other.id);
        const p = r.seats.find((s) => s?.id === id)!;
        p.connected = true;
        p.bot = false;
        if (r.game) {
          r.game.seats = structuredClone(r.seats);
        }
        transfer(r);
        commit(r);
        offlineSince.delete(id);
      }
    } catch (error) {
      failure("restore_room", error);
      socket.emit("server:unavailable", {
        message: "Saved game could not be restored. Please retry shortly.",
      });
      socket.disconnect(true);
      return;
    }
    function handle(event: string, fn: (data: unknown) => Reply | void) {
      socket.on(event, (data: unknown, ack?: (r: Reply) => void) => {
        try {
          if (closing)
            throw new PublicError(
              "Server is restarting. Please reconnect.",
              "SERVER_CLOSING",
            );
          sessionFor(socket.request.headers.cookie, ip);
          limited(`actions-user:${id}`, 60, 10000);
          limited(`actions-ip:${ip}`, 600, 10000);
          const categories: Record<string, [number, number, number]> = {
            "room:create": [3, 20, 600000],
            "room:join": [20, 100, 60000],
            "chat:send": [20, 100, 60000],
            "voice:send": [6, 30, 60000],
            "moderation:report": [5, 30, 3600000],
            "moderation:block": [20, 100, 3600000],
          };
          const budget = categories[event];
          if (budget) {
            limited(`${event}:user:${id}`, budget[0], budget[2]);
            limited(`${event}:ip:${ip}`, budget[1], budget[2]);
          }
          const result = fn(data);
          monitor.actions++;
          if (typeof ack === "function") ack(result ?? { ok: true });
        } catch (error) {
          monitor.rejected++;
          if (!(error instanceof PublicError) && !(error instanceof z.ZodError))
            failure(`action:${event}`, error);
          if (typeof ack === "function")
            ack({
              ok: false,
              code:
                error instanceof PublicError
                  ? error.code
                  : error instanceof z.ZodError
                    ? "INVALID_INPUT"
                    : "STORAGE_UNAVAILABLE",
              error:
                error instanceof PublicError
                  ? error.message
                  : error instanceof z.ZodError
                    ? "Please check the entered values."
                    : "Storage is temporarily unavailable. Nothing was changed; please retry.",
            });
          if (
            error instanceof PublicError &&
            error.code === "SESSION_EXPIRED"
          ) {
            io.to(guestChannel(id)).emit("session:expired");
            io.in(guestChannel(id)).disconnectSockets(true);
          }
        }
      });
    }
    const requireRoom = () => {
      const r = activeRoom(id);
      if (!r) throw new PublicError("Join a room first.");
      return structuredClone(r);
    };
    const requireHost = (r: Room) => {
      if (r.host !== id)
        throw new PublicError("Only the room organiser can do that.");
    };
    handle("clock:sync", () => ({ ok: true, serverNow: Date.now() }));
    handle("rooms:list", (data) => {
      const input = z
        .object({
          page: z.number().int().min(1).max(5000).default(1),
          pageSize: z
            .number()
            .int()
            .min(1)
            .max(20)
            .default(PUBLIC_ROOM_PAGE_SIZE),
        })
        .parse(data ?? {});
      return {
        ok: true,
        ...publicRoomPage(
          publicEnabled ? rooms.values() : [],
          input.page,
          input.pageSize,
          (other) => store.blocked(id, other),
        ),
      };
    });
    handle("room:create", (data) => {
      const input = z
        .object({
          name: label,
          playerName: label,
          public: z.boolean(),
          bots: z.number().int().min(0).max(3),
          botDifficulty: z.number().int().min(0).max(10).optional(),
        })
        .parse(data);
      if (activeRoom(id))
        throw new PublicError("Leave your current room first.");
      if (input.public && !publicEnabled)
        throw new PublicError(
          "Public rooms are not open yet. Private rooms are available.",
        );
      if (rooms.size >= (options.maxRooms ?? 500))
        throw new PublicError("All tables are busy. Please try again later.");
      let code: string;
      do {
        code = Array.from(
          { length: 6 },
          () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)],
        ).join("");
      } while (store.hasRoom(code));
      const r: Room = {
        botDifficulty: input.botDifficulty ?? defaultBotDifficulty,
        code,
        name: input.name,
        public: input.public,
        host: id,
        seats: [seat(id, input.playerName, 0), null, null, null],
        game: null,
        voices: [],
        chat: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastHumanAt: Date.now(),
      };
      for (let i = 1; i <= input.bots; i++)
        r.seats[i] = seat(
          `bot:${randomUUID()}`,
          ["", "Milo", "Sunny", "Coco"][i],
          i,
          true,
          input.botDifficulty ?? defaultBotDifficulty,
        );
      const blocks = new Set(store.blockedSubjects(id)),
        committed = commit(r);
      return { ok: true, room: view(committed, id, blocks), me: id };
    });
    handle("room:join", (data) => {
      const input = z.object({ code: roomCode, playerName: label }).parse(data);
      if (activeRoom(id))
        throw new PublicError("Leave your current room first.");
      const saved = rooms.get(input.code);
      if (!saved)
        throw new PublicError(
          "That room was not found. Check the six-character code.",
        );
      const r = structuredClone(saved);
      if (r.game) throw new PublicError("This game has already started.");
      if (memberIds(r).some((other) => store.blocked(id, other)))
        throw new PublicError("This table is unavailable.");
      let index = r.seats.findIndex((s) => !s);
      if (index < 0) index = r.seats.findIndex((s) => s?.bot);
      if (index < 0) throw new PublicError("This table is full.");
      r.seats[index] = seat(id, input.playerName, index);
      transfer(r);
      const blocks = new Set(store.blockedSubjects(id)),
        committed = commit(r);
      return { ok: true, room: view(committed, id, blocks), me: id };
    });
    handle("room:difficulty", (data) => {
      const input = z
          .object({
            difficulty: z.number().int().min(0).max(10),
            seat: z.number().int().min(0).max(3).optional(),
          })
          .parse(data),
        r = requireRoom();
      requireHost(r);
      if (r.game && r.game.phase !== "finished")
        throw new PublicError("Change bot difficulty between games.");
      if (input.seat === undefined) r.botDifficulty = input.difficulty;
      else {
        const player = r.seats[input.seat];
        if (!player?.id.startsWith("bot:"))
          throw new PublicError("Choose a bot seat.");
        player.botDifficulty = input.difficulty;
        if (r.game) r.game.seats = structuredClone(r.seats);
      }
      commit(r);
    });
    handle("room:configure", (data) => {
      const input = z
          .object({ seat: z.number().int().min(0).max(3), bot: z.boolean() })
          .parse(data),
        r = requireRoom();
      requireHost(r);
      if (r.game && r.game.phase !== "finished")
        throw new PublicError("Change seats between games.");
      if (r.seats[input.seat] && !r.seats[input.seat]!.id.startsWith("bot:"))
        throw new PublicError("That seat belongs to a player.");
      if (r.game) {
        r.game = null;
        r.seats = r.seats.map((s) =>
          s ? { ...s, tokens: [-1, -1, -1, -1] } : null,
        );
      }
      r.seats[input.seat] = input.bot
        ? seat(
            `bot:${randomUUID()}`,
            ["Ruby", "Milo", "Sunny", "Coco"][input.seat],
            input.seat,
            true,
            r.botDifficulty ?? defaultBotDifficulty,
          )
        : null;
      commit(r);
    });
    handle("room:start", () => {
      const r = requireRoom();
      requireHost(r);
      if (r.game && r.game.phase !== "finished")
        throw new PublicError("A game is already in progress.");
      if (r.seats.some((s) => s && !s.bot && !s.connected))
        throw new PublicError(
          "Wait for disconnected players to return or leave.",
        );
      if (r.seats.filter(Boolean).length < 2)
        throw new PublicError("At least two players are needed.");
      r.game = newGame(
        r.seats.map((s) => (s ? { ...s, tokens: [-1, -1, -1, -1] } : null)),
        Date.now(),
        r.botDifficulty ?? defaultBotDifficulty,
      );
      commit(r, { delay: 900 });
    });
    function requireTurn(data: unknown) {
      const input = revision.parse(data),
        r = requireRoom(),
        g = r.game;
      if (!g) throw new PublicError("The organiser has not started the game.");
      if (g.seats[g.turn]?.id !== id || g.seats[g.turn]?.bot)
        throw new PublicError("It is not your turn.");
      if (g.phase === "finished")
        throw new PublicError("The game has finished.");
      if (g.revision !== input.revision)
        throw new PublicError(
          "The board changed. Try again.",
          "STALE_REVISION",
        );
      const now = Date.now();
      if (now >= g.deadline) {
        automaticallyAdvance(r, now);
        throw new PublicError(
          "The turn deadline passed. The automatic action was applied.",
          "TURN_EXPIRED",
        );
      }
      if (now < (transitions.get(r.code) ?? 0))
        throw new PublicError("Wait for the move to finish.");
      return r;
    }
    handle("game:roll", (data) => {
      const r = requireTurn(data);
      if (r.game!.phase !== "roll")
        throw new PublicError("Choose a token before rolling again.");
      r.game = roll(r.game!, randomInt(1, 7));
      commit(r, { delay: 850 });
    });
    handle("game:move", (data) => {
      const input = revision
          .extend({ token: z.number().int().min(0).max(3) })
          .parse(data),
        r = requireTurn(data);
      if (!legalMoves(r.game!).includes(input.token))
        throw new PublicError("That token cannot move.");
      r.game = move(r.game!, input.token);
      commit(r, { delay: 1100 });
    });
    handle("chat:send", (data) => {
      const input = z
          .object({ text: z.string().trim().min(1).max(180) })
          .parse(data),
        r = requireRoom(),
        p = r.seats.find((s) => s?.id === id)!;
      r.chat.push({
        id: randomUUID(),
        senderId: id,
        name: p.name,
        color: p.color,
        text: input.text,
        at: Date.now(),
      });
      r.chat = r.chat.slice(-50);
      commit(r);
    });
    handle("voice:send", (data) => {
      const input = z
          .object({
            audio: z.instanceof(Buffer),
            mime: z.enum(["audio/webm", "audio/ogg", "audio/mp4"]),
            duration: z
              .number()
              .min(0.2)
              .max(VOICE_MAX_SECONDS + 0.5),
          })
          .parse(data),
        r = requireRoom();
      if (input.audio.length < 16 || input.audio.length > VOICE_MAX_BYTES)
        throw new PublicError("The voice message exceeds the size limit.");
      limited(
        `voice-bytes:user:${id}`,
        4 * VOICE_MAX_BYTES,
        60000,
        input.audio.length,
      );
      limited(
        `voice-bytes:ip:${ip}`,
        16 * VOICE_MAX_BYTES,
        60000,
        input.audio.length,
      );
      const b = input.audio,
        valid =
          input.mime === "audio/webm"
            ? b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
            : input.mime === "audio/ogg"
              ? b.subarray(0, 4).toString() === "OggS"
              : b.subarray(4, 8).toString() === "ftyp";
      if (!valid) throw new PublicError("This audio format could not be read.");
      const p = r.seats.find((s) => s?.id === id)!,
        voice = {
          id: randomUUID(),
          senderId: id,
          name: p.name,
          color: p.color,
          mime: input.mime,
          duration: input.duration,
          at: Date.now(),
        };
      r.voices.push(voice);
      r.voices = r.voices.slice(-20);
      commit(r, {
        voice: {
          id: voice.id,
          mime: voice.mime,
          data: input.audio,
          at: voice.at,
        },
      });
    });
    handle("room:leave", () => {
      const r = requireRoom(),
        index = r.seats.findIndex((s) => s?.id === id);
      if (r.game && r.game.phase !== "finished") {
        const p = r.game.seats[index]!;
        p.id = `bot:${randomUUID()}`;
        p.bot = true;
        p.botDifficulty = r.botDifficulty ?? defaultBotDifficulty;
        p.connected = true;
        p.name = `${p.name.slice(0, 24)} (Bot)`;
        r.seats = structuredClone(r.game.seats);
      } else {
        r.seats[index] = null;
        r.game = null;
      }
      transfer(r);
      commit(r);
      offlineSince.delete(id);
    });
    const target = (data: unknown) => {
      const input = z
          .object({
            player: z.string().regex(/^[a-f0-9]{64}$/),
            reason: z.string().trim().min(1).max(500).optional(),
          })
          .parse(data),
        r = requireRoom();
      if (input.player === id || !memberIds(r).includes(input.player))
        throw new PublicError("Choose another person at this table.");
      return { input, r };
    };
    handle("moderation:report", (data) => {
      const { input, r } = target(data);
      if (!input.reason) throw new PublicError("Please describe the report.");
      store.report(id, r.code, input.player, input.reason);
    });
    handle("moderation:block", (data) => {
      const { input, r } = target(data);
      store.block(id, input.player);
      emitRoom(r);
    });
    socket.once("disconnect", () => {
      release(socket.id, id, ip);
      if (closing || guestSockets.has(id)) return;
      try {
        const saved = activeRoom(id);
        if (!saved) return;
        const r = structuredClone(saved),
          p = r.seats.find((s) => s?.id === id)!;
        p.connected = false;
        if (r.game) r.game.seats = structuredClone(r.seats);
        transfer(r);
        commit(r, { activity: false });
        offlineSince.set(id, Date.now());
      } catch (error) {
        failure("disconnect_room", error);
      }
    });
  });
  const tick = setInterval(() => {
    if (closing) return;
    const now = Date.now();
    if (now - lastLease > 5000) {
      lastLease = now;
      try {
        store.renewLease();
      } catch (error) {
        failure("lease_renewal", error);
        return;
      }
    }
    if (now < storageRetryAt) return;
    for (const saved of rooms.values())
      try {
        let r = structuredClone(saved),
          changed = false;
        if (!memberIds(r).length) {
          store.delete(r.code);
          eraseRoom(r.code);
          monitor.success();
          continue;
        }
        const attended = memberIds(r).some((id) => guestSockets.has(id));
        if (!attended && now - r.lastHumanAt > 15 * 60000) {
          r.archived = true;
          commit(r, { activity: false, archive: true });
          continue;
        }
        for (const p of r.seats)
          if (p && !p.id.startsWith("bot:")) {
            const connected = guestSockets.has(p.id);
            if (p.connected !== connected) {
              p.connected = connected;
              changed = true;
              if (!connected) offlineSince.set(p.id, now);
            }
            if (
              !connected &&
              !p.bot &&
              r.game &&
              now - (offlineSince.get(p.id) ?? now) > 90000
            ) {
              p.bot = true;
              changed = true;
            }
          }
        if (r.game) r.game.seats = structuredClone(r.seats);
        if (changed) {
          transfer(r);
          r = commit(r, { activity: false });
        }
        const g = r.game;
        if (!attended || !g || g.phase === "finished") {
          ai.cancel(r.code);
          continue;
        }
        const p = g.seats[g.turn]!,
          due = transitions.get(r.code) ?? 0;
        if (
          now >= g.deadline ||
          (p.bot && now >= due + (options.botDelay ?? 650))
        )
          if (g.phase === "move" && p.id.startsWith("bot:")) scheduleBot(r);
          else automaticallyAdvance(r, now);
      } catch (error) {
        failure("room_tick", error);
      }
    if (now - lastMaintenance > (options.maintenanceMs ?? 60000)) {
      lastMaintenance = now;
      try {
        const result = store.maintenance(now);
        for (const room of result.updated)
          if (rooms.has(room.code)) {
            indexRoom(room);
            emitRoom(room);
          }
        for (const code of result.deleted) {
          const r = rooms.get(code);
          if (r)
            for (const id of memberIds(r)) {
              io.in(guestChannel(id)).socketsLeave(code);
              io.to(guestChannel(id)).emit("room:closed");
            }
          eraseRoom(code);
        }
        budgets.sweep();
        for (const [id] of guestSockets)
          if (!store.session(id)) {
            io.to(guestChannel(id)).emit("session:expired");
            io.in(guestChannel(id)).disconnectSockets(true);
          }
        monitor.success();
      } catch (error) {
        failure("maintenance", error);
      }
    }
  }, options.tickMs ?? 150);
  tick.unref();
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof PublicError) {
        res
          .status(error.code === "RATE_LIMITED" ? 429 : 403)
          .json({ ok: false, error: error.message, code: error.code });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({ ok: false, error: "Invalid input" });
        return;
      }
      failure("http", error);
      res
        .status(503)
        .json({ ok: false, error: "Storage temporarily unavailable" });
    },
  );
  let closePromise: Promise<void> | undefined;
  return {
    app,
    http,
    io,
    rooms,
    store,
    monitor,
    ai,
    playerRooms,
    beginShutdown: () => {
      closing = true;
      monitor.closing = true;
      void ai.close();
    },
    close: () =>
      (closePromise ??= (async () => {
        closing = true;
        monitor.closing = true;
        clearInterval(tick);
        await ai.close();
        await new Promise<void>((resolve) => io.close(() => resolve()));
        try {
          for (const saved of rooms.values()) {
            const r = structuredClone(saved);
            let changed = false;
            for (const s of r.seats)
              if (s && !s.id.startsWith("bot:") && s.connected) {
                s.connected = false;
                changed = true;
              }
            if (changed) {
              if (r.game) r.game.seats = structuredClone(r.seats);
              store.save(r);
            }
          }
        } catch (error) {
          failure("shutdown_snapshot", error);
        } finally {
          monitor.close();
          store.close();
        }
      })()),
  };
}
