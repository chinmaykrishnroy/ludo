import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, statSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Room } from "../shared/protocol.js";
import { roomSchema } from "./validation.js";
import { SESSION_MS, PublicError } from "./security.js";
export type VoiceWrite = { id: string; mime: string; data: Buffer; at: number };
export class Store {
  db: DatabaseSync;
  readonly path: string;
  private owner = randomUUID();
  private closed = false;
  readonly voiceRetentionMs: number;
  readonly maxVoiceBytes: number;
  constructor(
    path: string,
    options: { voiceRetentionMs?: number; maxVoiceBytes?: number } = {},
  ) {
    this.path = path;
    this.voiceRetentionMs = options.voiceRetentionMs ?? 86400000;
    this.maxVoiceBytes = options.maxVoiceBytes ?? 256 * 1024 * 1024;
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:" && process.platform !== "win32")
      chmodSync(path, 0o600);
    try {
      this.db.exec(
        "PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS server_lock(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expiresAt INTEGER NOT NULL);",
      );
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const lease = this.db
          .prepare("SELECT owner,expiresAt FROM server_lock WHERE id=1")
          .get() as { owner: string; expiresAt: number } | undefined;
        if (lease && lease.expiresAt > Date.now())
          throw new Error(
            "Database already has an active game server. Refusing a second process.",
          );
        this.db
          .prepare(
            "INSERT INTO server_lock VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expiresAt=excluded.expiresAt",
          )
          .run(this.owner, Date.now() + 30000);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY,body TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS voices(id TEXT PRIMARY KEY,room TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,mime TEXT NOT NULL,data BLOB NOT NULL,createdAt INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS room_members(player TEXT PRIMARY KEY,room TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,createdAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS quarantine(code TEXT PRIMARY KEY,reason TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS server_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bans(subject TEXT PRIMARY KEY,untilAt INTEGER NOT NULL,reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,reporter TEXT NOT NULL,room TEXT NOT NULL,subject TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS blocks(player TEXT NOT NULL,subject TEXT NOT NULL,PRIMARY KEY(player,subject));
    CREATE TABLE IF NOT EXISTS stats(key TEXT PRIMARY KEY,value INTEGER NOT NULL);`);
      if (
        !(
          this.db.prepare("PRAGMA table_info(rooms)").all() as {
            name: string;
          }[]
        ).some((c) => c.name === "archived")
      )
        this.db.exec(
          "ALTER TABLE rooms ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
        );
      if (
        !(
          this.db.prepare("PRAGMA table_info(voices)").all() as {
            name: string;
          }[]
        ).some((c) => c.name === "createdAt")
      )
        this.db.exec(
          "ALTER TABLE voices ADD COLUMN createdAt INTEGER NOT NULL DEFAULT 0",
        );
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS rooms_archive ON rooms(archived); CREATE INDEX IF NOT EXISTS voices_age ON voices(createdAt); CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expiresAt);",
      );
      const pageSize = (
        this.db.prepare("PRAGMA page_size").get() as { page_size: number }
      ).page_size;
      this.db.exec(
        `PRAGMA max_page_count=${Math.max(256, Math.floor(Number(process.env.MAX_DATABASE_BYTES ?? 1073741824) / pageSize))}`,
      );
      if (
        !this.db
          .prepare("SELECT 1 FROM server_meta WHERE key='schema_v2'")
          .get()
      )
        this.transaction(() => {
          for (const row of this.db
            .prepare("SELECT code,body FROM rooms")
            .all() as { code: string; body: string }[]) {
            try {
              const room = this.decode(row.body);
              this.writeRoom(room);
              for (const voice of room.voices)
                this.db
                  .prepare(
                    "UPDATE voices SET createdAt=? WHERE id=? AND createdAt=0",
                  )
                  .run(voice.at, voice.id);
            } catch (error) {
              this.db
                .prepare("INSERT OR REPLACE INTO quarantine VALUES(?,?,?)")
                .run(row.code, "Saved room failed validation", Date.now());
            }
          }
          for (const row of this.db
            .prepare("SELECT player FROM room_members")
            .all() as { player: string }[])
            if (/^[a-f0-9]{64}$/.test(row.player))
              this.db
                .prepare("INSERT OR IGNORE INTO sessions VALUES(?,?,?)")
                .run(row.player, Date.now(), Date.now() + SESSION_MS);
          this.db
            .prepare("INSERT INTO server_meta VALUES('schema_v2','1')")
            .run();
        });
    } catch (error) {
      try {
        this.db
          .prepare("DELETE FROM server_lock WHERE owner=?")
          .run(this.owner);
      } catch {}
      this.db.close();
      throw error;
    }
  }
  private decode(body: string): Room {
    return roomSchema.parse(JSON.parse(body));
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const lease = this.db
        .prepare("SELECT owner,expiresAt FROM server_lock WHERE id=1")
        .get() as { owner: string; expiresAt: number } | undefined;
      if (!lease || lease.owner !== this.owner || lease.expiresAt <= Date.now())
        throw new Error("Game server database lease lost");
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }
  renewLease() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare("UPDATE server_lock SET expiresAt=? WHERE id=1 AND owner=?")
        .run(Date.now() + 30000, this.owner);
      if (!result.changes) throw new Error("Game server database lease lost");
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }
  private writeRoom(room: Room) {
    this.db
      .prepare(
        "INSERT INTO rooms(code,body,archived) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET body=excluded.body,archived=excluded.archived",
      )
      .run(room.code, JSON.stringify(room), room.archived ? 1 : 0);
    this.db.prepare("DELETE FROM room_members WHERE room=?").run(room.code);
    for (const s of room.seats)
      if (s && !s.id.startsWith("bot:"))
        this.db
          .prepare(
            "INSERT INTO room_members(player,room) VALUES(?,?) ON CONFLICT(player) DO UPDATE SET room=excluded.room",
          )
          .run(s.id, room.code);
  }
  load(): Room[] {
    const result: Room[] = [];
    for (const row of this.db
      .prepare(
        "SELECT code,body FROM rooms WHERE archived=0 AND code NOT IN (SELECT code FROM quarantine)",
      )
      .all() as { code: string; body: string }[]) {
      try {
        result.push(this.decode(row.body));
      } catch {
        this.transaction(() =>
          this.db
            .prepare("INSERT OR REPLACE INTO quarantine VALUES(?,?,?)")
            .run(row.code, "Saved room failed validation", Date.now()),
        );
      }
    }
    return result;
  }
  save(room: Room, voice?: VoiceWrite) {
    const valid = roomSchema.parse(room);
    this.transaction(() => {
      const previous = this.db
        .prepare("SELECT body FROM rooms WHERE code=?")
        .get(valid.code) as { body: string } | undefined;
      const old = previous ? this.decode(previous.body) : undefined;
      this.writeRoom(valid);
      const keep = valid.voices.map((v) => v.id);
      for (const row of this.db
        .prepare("SELECT id FROM voices WHERE room=?")
        .all(valid.code) as { id: string }[])
        if (!keep.includes(row.id))
          this.db.prepare("DELETE FROM voices WHERE id=?").run(row.id);
      if (voice) {
        const bytes = (
          this.db
            .prepare("SELECT COALESCE(SUM(length(data)),0) AS size FROM voices")
            .get() as { size: number }
        ).size;
        if (bytes + voice.data.length > this.maxVoiceBytes)
          throw new PublicError(
            "Voice storage is full. Please try again later.",
            "VOICE_CAPACITY",
          );
        this.db
          .prepare("INSERT INTO voices VALUES(?,?,?,?,?)")
          .run(voice.id, valid.code, voice.mime, voice.data, voice.at);
      }
      const count = (key: string) =>
        this.db
          .prepare(
            "INSERT INTO stats VALUES(?,1) ON CONFLICT(key) DO UPDATE SET value=value+1",
          )
          .run(key);
      if (!old) count("rooms_created");
      if (
        valid.game &&
        (!old?.game ||
          (old.game.phase === "finished" && valid.game.revision === 0))
      )
        count("games_started");
      if (valid.game?.phase === "finished" && old?.game?.phase !== "finished")
        count("games_finished");
      if (
        valid.game &&
        old?.game &&
        valid.game.revision > old.game.revision &&
        !valid.game.lastMove
      )
        count("dice_rolls");
    });
  }
  findByPlayer(player: string): Room | undefined {
    const row = this.db
      .prepare(
        "SELECT r.body,q.code AS quarantined FROM rooms r JOIN room_members m ON m.room=r.code LEFT JOIN quarantine q ON q.code=r.code WHERE m.player=?",
      )
      .get(player) as { body: string; quarantined: string | null } | undefined;
    if (row?.quarantined)
      throw new Error("Saved game requires operator recovery");
    return row ? this.decode(row.body) : undefined;
  }
  hasRoom(code: string) {
    return !!this.db.prepare("SELECT 1 FROM rooms WHERE code=?").get(code);
  }
  delete(code: string) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM rooms WHERE code=?").run(code);
      this.db.prepare("DELETE FROM quarantine WHERE code=?").run(code);
    });
  }
  putVoice(id: string, room: string, mime: string, data: Buffer) {
    this.transaction(() =>
      this.db
        .prepare("INSERT INTO voices VALUES(?,?,?,?,?)")
        .run(id, room, mime, data, Date.now()),
    );
  }
  getVoice(id: string) {
    return this.db
      .prepare(
        "SELECT room,mime,data,createdAt FROM voices WHERE id=? AND createdAt>=?",
      )
      .get(id, Date.now() - this.voiceRetentionMs) as
      | { room: string; mime: string; data: Uint8Array; createdAt: number }
      | undefined;
  }
  session(id: string, now = Date.now()) {
    return this.db
      .prepare(
        "SELECT id,createdAt,expiresAt FROM sessions WHERE id=? AND expiresAt>?",
      )
      .get(id, now) as
      { id: string; createdAt: number; expiresAt: number } | undefined;
  }
  issueSession(id: string, now = Date.now()) {
    this.transaction(() => {
      const count = (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM sessions WHERE expiresAt>?")
          .get(now) as { n: number }
      ).n;
      if (count >= 50000) throw new Error("Session capacity reached");
      this.db
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .run(id, now, now + SESSION_MS);
    });
  }
  touchSession(id: string, now = Date.now()) {
    const s = this.session(id, now);
    if (s && s.expiresAt < now + SESSION_MS - 3600000)
      this.transaction(() =>
        this.db
          .prepare("UPDATE sessions SET expiresAt=? WHERE id=?")
          .run(Math.min(now + SESSION_MS, s.createdAt + 365 * 86400000), id),
      );
  }
  banned(subject: string, now = Date.now()) {
    return !!this.db
      .prepare("SELECT 1 FROM bans WHERE subject=? AND untilAt>?")
      .get(subject, now);
  }
  setBan(subject: string, untilAt: number, reason: string) {
    this.transaction(() =>
      this.db
        .prepare(
          "INSERT INTO bans VALUES(?,?,?) ON CONFLICT(subject) DO UPDATE SET untilAt=excluded.untilAt,reason=excluded.reason",
        )
        .run(subject, untilAt, reason),
    );
  }
  block(player: string, subject: string) {
    if (
      (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM blocks WHERE player=?")
          .get(player) as { n: number }
      ).n >= 100 &&
      !this.blocked(player, subject)
    )
      throw new Error("Block list capacity reached");
    this.transaction(() =>
      this.db
        .prepare("INSERT OR IGNORE INTO blocks VALUES(?,?)")
        .run(player, subject),
    );
  }
  blocked(a: string, b: string) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM blocks WHERE (player=? AND subject=?) OR (player=? AND subject=?)",
      )
      .get(a, b, b, a);
  }
  blockedSubjects(player: string) {
    return (
      this.db
        .prepare(
          "SELECT CASE WHEN player=? THEN subject ELSE player END AS subject FROM blocks WHERE player=? OR subject=?",
        )
        .all(player, player, player) as { subject: string }[]
    ).map((r) => r.subject);
  }
  report(reporter: string, room: string, subject: string, reason: string) {
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO reports VALUES(?,?,?,?,?,?)")
        .run(randomUUID(), reporter, room, subject, reason, Date.now());
      this.db
        .prepare(
          "DELETE FROM reports WHERE id NOT IN (SELECT id FROM reports ORDER BY at DESC LIMIT 10000)",
        )
        .run();
    });
  }
  reports() {
    return this.db
      .prepare("SELECT * FROM reports ORDER BY at DESC LIMIT 100")
      .all();
  }
  maintenance(now = Date.now()) {
    return this.transaction(() => {
      const updated: Room[] = [],
        deleted: string[] = [];
      const cutoff = now - this.voiceRetentionMs;
      for (const row of this.db
        .prepare(
          "SELECT code,body FROM rooms WHERE code NOT IN (SELECT code FROM quarantine)",
        )
        .all() as { code: string; body: string }[]) {
        let room: Room;
        try {
          room = this.decode(row.body);
        } catch {
          this.db
            .prepare("INSERT OR REPLACE INTO quarantine VALUES(?,?,?)")
            .run(row.code, "Saved room failed validation", now);
          continue;
        }
        const expiry = room.game
          ? (room.game.phase === "finished" ? 7 : 30) * 86400000
          : 86400000;
        if (room.archived && now - room.lastHumanAt > expiry) {
          this.db.prepare("DELETE FROM rooms WHERE code=?").run(room.code);
          deleted.push(room.code);
          continue;
        }
        const voices = room.voices.filter((v) => v.at >= cutoff);
        if (voices.length !== room.voices.length) {
          room.voices = voices;
          this.writeRoom(room);
          updated.push(room);
        }
      }
      this.db.prepare("DELETE FROM voices WHERE createdAt<?").run(cutoff);
      this.db.prepare("DELETE FROM sessions WHERE expiresAt<=?").run(now);
      this.db.prepare("DELETE FROM bans WHERE untilAt<=?").run(now);
      this.db
        .prepare("DELETE FROM reports WHERE at<?")
        .run(now - 30 * 86400000);
      this.db
        .prepare(
          "DELETE FROM blocks WHERE player NOT IN (SELECT id FROM sessions)",
        )
        .run();
      return { updated, deleted };
    });
  }
  health() {
    this.db.prepare("SELECT 1").get();
    return {
      rooms: (
        this.db.prepare("SELECT COUNT(*) AS n FROM rooms").get() as {
          n: number;
        }
      ).n,
      archived: (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM rooms WHERE archived=1")
          .get() as { n: number }
      ).n,
      voiceBytes: (
        this.db
          .prepare("SELECT COALESCE(SUM(length(data)),0) AS n FROM voices")
          .get() as { n: number }
      ).n,
      quarantined: (
        this.db.prepare("SELECT COUNT(*) AS n FROM quarantine").get() as {
          n: number;
        }
      ).n,
      databaseBytes: this.path === ":memory:" ? 0 : statSync(this.path).size,
    };
  }
  stats() {
    const counters = Object.fromEntries(
      (
        this.db.prepare("SELECT key,value FROM stats").all() as {
          key: string;
          value: number;
        }[]
      ).map((r) => [r.key, r.value]),
    );
    return {
      gamesStarted: counters.games_started ?? 0,
      gamesFinished: counters.games_finished ?? 0,
      diceRolls: counters.dice_rolls ?? 0,
    };
  }
  async backup(destination: string) {
    mkdirSync(dirname(resolve(destination)), { recursive: true });
    await backup(this.db, destination);
    if (process.platform !== "win32") chmodSync(destination, 0o600);
    const check = new DatabaseSync(destination, { readOnly: true });
    try {
      if (
        (
          check.prepare("PRAGMA integrity_check").get() as {
            integrity_check: string;
          }
        ).integrity_check !== "ok" ||
        check.prepare("PRAGMA foreign_key_check").all().length
      )
        throw new Error("Backup integrity verification failed");
      for (const row of check
        .prepare(
          "SELECT body FROM rooms WHERE code NOT IN (SELECT code FROM quarantine)",
        )
        .all() as { body: string }[])
        this.decode(row.body);
    } finally {
      check.close();
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.prepare("DELETE FROM server_lock WHERE owner=?").run(this.owner);
    } finally {
      this.db.close();
    }
  }
}
