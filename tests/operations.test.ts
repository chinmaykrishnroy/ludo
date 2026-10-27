import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import {
  createVerifiedBackup,
  restoreBackup,
  pruneBackups,
  verifyDatabase,
} from "../server/backups.js";
import { readdir, writeFile, link, mkdir, utimes } from "node:fs/promises";
import { verifyBackupAsync } from "../server/backup-verifier.js";
import { seat, newGame, roll } from "../shared/game.js";
import type { Room } from "../shared/protocol.js";
const fixture = (): Room => {
  const seats = [
      seat("owner", "Owner", 0),
      seat("bot:computer", "Computer", 1, true),
      null,
      null,
    ],
    game = newGame(seats);
  return {
    code: "ABC234",
    name: "Recovery",
    public: false,
    host: "owner",
    seats: structuredClone(game.seats),
    game,
    voices: [],
    chat: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastHumanAt: Date.now(),
  };
};
test("a second server is refused and a lost lease cannot keep writing", () => {
  const root = mkdtempSync(join(tmpdir(), "ludo-lease-")),
    path = join(root, "game.sqlite"),
    a = new Store(path);
  let b: Store | undefined;
  try {
    assert.throws(() => new Store(path), /active game server/);
    a.db.prepare("UPDATE server_lock SET expiresAt=0").run();
    b = new Store(path);
    assert.throws(() => a.save(fixture()), /lease lost/);
    b.save(fixture());
    assert.equal(b.load().length, 1);
  } finally {
    a.close();
    b?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("verified backup restores unfinished tokens and deadline without overwriting a live database", async () => {
  const root = mkdtempSync(join(tmpdir(), "ludo-backup-")),
    s = new Store(join(root, "game.sqlite"));
  let restored: Store | undefined;
  try {
    const r = fixture();
    r.botDifficulty = 10;
    r.game!.seats[1]!.botDifficulty = 3;
    r.game!.seats[0]!.tokens = [12, 0, -1, -1];
    r.game!.revision = 9;
    r.seats = structuredClone(r.game!.seats);
    s.save(r);
    const backup = await createVerifiedBackup(s, join(root, "backups")),
      target = join(root, "restored.sqlite");
    await restoreBackup(backup.path, target);
    restored = new Store(target);
    assert.deepEqual(restored.findByPlayer("owner"), r);
    assert.equal(
      restored.findByPlayer("owner")!.game!.seats[1]!.botDifficulty,
      3,
    );
    await assert.rejects(() => restoreBackup(backup.path, target), /exists/);
    const manifest = readFileSync(backup.path + ".json", "utf8");
    writeFileSync(
      backup.path + ".json",
      manifest.replace(backup.sha256, "0".repeat(64)),
    );
    await assert.rejects(
      () => restoreBackup(backup.path, join(root, "bad.sqlite")),
      /checksum/,
    );
  } finally {
    restored?.close();
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("voice quota is atomic, replacement frees its slot, and retention removes expired blobs", () => {
  const s = new Store(":memory:", {
    maxVoiceBytes: 100,
    voiceRetentionMs: 1000,
  });
  try {
    const r = fixture(),
      voice = (id: string) => ({
        id,
        senderId: "owner",
        name: "Owner",
        color: "red" as const,
        mime: "audio/webm",
        duration: 60,
        at: Date.now(),
      });
    r.voices = [voice("first")];
    s.save(r, {
      id: "first",
      mime: "audio/webm",
      data: Buffer.alloc(60),
      at: Date.now(),
    });
    const next = structuredClone(r);
    next.voices.push(voice("second"));
    assert.throws(
      () =>
        s.save(next, {
          id: "second",
          mime: "audio/webm",
          data: Buffer.alloc(60),
          at: Date.now(),
        }),
      /storage is full/,
    );
    assert.equal(s.findByPlayer("owner")!.voices.length, 1);
    assert.equal(s.getVoice("second"), undefined);
    next.voices = [voice("second")];
    s.save(next, {
      id: "second",
      mime: "audio/webm",
      data: Buffer.alloc(60),
      at: Date.now(),
    });
    assert.equal(s.getVoice("first"), undefined);
    assert(s.getVoice("second"));
    s.maintenance(Date.now() + 1001);
    assert.equal(s.getVoice("second"), undefined);
    assert.equal(s.findByPlayer("owner")!.voices.length, 0);
  } finally {
    s.close();
  }
});

test("interrupted copies and disk-full manifest/publication failures keep previous backups and remove staging", async () => {
  const root = mkdtempSync(join(tmpdir(), "ludo-backup-faults-")),
    s = new Store(join(root, "source.sqlite")),
    directory = join(root, "backups");
  try {
    s.save(fixture());
    const good = await createVerifiedBackup(s, directory),
      before = (await readdir(directory)).sort();
    const original = s.backup.bind(s);
    s.backup = async (path: string) => {
      await writeFile(path, "unfinished copy");
      throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
    };
    await assert.rejects(createVerifiedBackup(s, directory), /Disk full/);
    s.backup = original;
    await assert.rejects(
      createVerifiedBackup(s, directory, {
        writeFile: async () => {
          throw Object.assign(new Error("Manifest disk full"), {
            code: "ENOSPC",
          });
        },
        link,
      }),
      /Manifest disk full/,
    );
    await assert.rejects(
      createVerifiedBackup(s, directory, {
        writeFile,
        link: async (from, to) => {
          if (String(to).endsWith(".sqlite"))
            throw new Error("Publication failed");
          await link(from, to);
        },
      }),
      /Publication failed/,
    );
    assert.deepEqual((await readdir(directory)).sort(), before);
    assert.equal(verifyDatabase(good.path).rooms, 1);
    await restoreBackup(good.path, join(root, "restored.sqlite"));
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("backup verification runs in a bounded worker and rejects corruption and timeout", async () => {
  const root = mkdtempSync(join(tmpdir(), "ludo-backup-worker-")),
    path = join(root, "source.sqlite"),
    s = new Store(path);
  try {
    s.save(fixture());
    const backup = await createVerifiedBackup(s, join(root, "backups"));
    assert.equal((await verifyBackupAsync(backup.path)).rooms, 1);
    const bad = join(root, "bad.sqlite");
    await writeFile(bad, "not a database");
    await assert.rejects(verifyBackupAsync(bad));
    await assert.rejects(verifyBackupAsync(backup.path, 1), /timed out/);
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("retention keeps two manifested copies, flags unverified data and cleans only stale owned staging", async () => {
  const root = mkdtempSync(join(tmpdir(), "ludo-retention-")),
    s = new Store(join(root, "source.sqlite")),
    directory = join(root, "backups");
  try {
    s.save(fixture());
    const now = Date.now(),
      backups = [];
    for (let i = 0; i < 3; i++) {
      const backup = await createVerifiedBackup(s, directory);
      await utimes(
        backup.path,
        new Date(now - (10 + i) * 86400000),
        new Date(now - (10 + i) * 86400000),
      );
      backups.push(backup);
    }
    const orphan = "ludo-20260101T000000-abcdef01.sqlite";
    await writeFile(
      join(directory, orphan),
      "source preserved for operator review",
    );
    const stale = join(
        directory,
        ".backup-00000000-0000-4000-8000-000000000001",
      ),
      recent = join(directory, ".backup-00000000-0000-4000-8000-000000000002");
    await mkdir(stale);
    await mkdir(recent);
    await writeFile(join(stale, "database.sqlite"), "partial");
    await utimes(stale, new Date(now - 7200000), new Date(now - 7200000));
    const legacy = join(
      directory,
      "ludo-20260101T000000-abcdef02.sqlite.partial",
    );
    await writeFile(legacy, "partial");
    await utimes(legacy, new Date(now - 7200000), new Date(now - 7200000));
    const result = await pruneBackups(directory, now);
    assert.equal(result.removed, 1);
    assert.deepEqual(result.invalid, [orphan]);
    const names = await readdir(directory);
    assert(names.includes(orphan));
    assert(names.includes(recent.split(/[\\/]/).at(-1)!));
    assert(!names.includes(stale.split(/[\\/]/).at(-1)!));
    assert(!names.includes(legacy.split(/[\\/]/).at(-1)!));
    assert(names.includes(backups[0].path.split(/[\\/]/).at(-1)!));
    assert(names.includes(backups[1].path.split(/[\\/]/).at(-1)!));
    assert(!names.includes(backups[2].path.split(/[\\/]/).at(-1)!));
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("expired archived rooms are deleted while recent saved games remain", () => {
  const s = new Store(":memory:");
  try {
    const old = fixture();
    old.archived = true;
    old.lastHumanAt = Date.now() - 31 * 86400000;
    s.save(old);
    const recent = fixture();
    recent.code = "DEF234";
    recent.host = "other";
    recent.game!.seats[0]!.id = "other";
    recent.seats = structuredClone(recent.game!.seats);
    recent.archived = true;
    s.save(recent);
    s.maintenance();
    assert.equal(s.hasRoom(old.code), false);
    assert(s.findByPlayer("other"));
  } finally {
    s.close();
  }
});
test("corrupt saved rooms are quarantined without discarding their source data", () => {
  const root = mkdtempSync(join(tmpdir(), "ludo-corrupt-")),
    path = join(root, "game.sqlite");
  let s = new Store(path);
  try {
    s.save(fixture());
    s.db
      .prepare("UPDATE rooms SET body=? WHERE code=?")
      .run("damaged source", "ABC234");
    s.close();
    s = new Store(path);
    assert.deepEqual(s.load(), []);
    assert.equal(s.health().quarantined, 1);
    assert.throws(() => s.findByPlayer("owner"), /recovery/);
    assert.equal(
      (s.db.prepare("SELECT body FROM rooms").get() as { body: string }).body,
      "damaged source",
    );
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("unchanged membership avoids index writes and diagnostics cannot invalidate a committed save", () => {
  const store = new Store(":memory:");
  try {
    store.db.exec(
      "CREATE TABLE member_changes(n INTEGER); CREATE TRIGGER count_member_insert AFTER INSERT ON room_members BEGIN INSERT INTO member_changes VALUES(1); END; CREATE TRIGGER count_member_delete AFTER DELETE ON room_members BEGIN INSERT INTO member_changes VALUES(1); END;",
    );
    let room = fixture();
    store.save(room);
    for (let i = 0; i < 10; i++) {
      room = structuredClone(room);
      room.game = roll(room.game!, 1);
      room.seats = structuredClone(room.game.seats);
      store.save(room);
    }
    assert.equal(
      (
        store.db.prepare("SELECT COUNT(*) AS n FROM member_changes").get() as {
          n: number;
        }
      ).n,
      1,
    );
    assert.equal(store.stats().diceRolls, 10);
    store.observeTransaction = () => {
      throw new Error("Diagnostic failure");
    };
    room = structuredClone(room);
    room.name = "Committed even if observer fails";
    store.save(room);
    assert.equal(store.findByPlayer("owner")!.name, room.name);
  } finally {
    store.close();
  }
});
