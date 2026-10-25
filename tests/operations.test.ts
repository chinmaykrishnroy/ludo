import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { createVerifiedBackup, restoreBackup } from "../server/backups.js";
import { seat, newGame } from "../shared/game.js";
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
    r.game!.seats[0]!.tokens = [12, 0, -1, -1];
    r.game!.revision = 9;
    r.seats = structuredClone(r.game!.seats);
    s.save(r);
    const backup = await createVerifiedBackup(s, join(root, "backups")),
      target = join(root, "restored.sqlite");
    await restoreBackup(backup.path, target);
    restored = new Store(target);
    assert.deepEqual(restored.findByPlayer("owner"), r);
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
