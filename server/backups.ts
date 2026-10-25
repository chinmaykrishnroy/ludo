import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
  copyFile,
  link,
} from "node:fs/promises";
import { basename, dirname, resolve, sep, join } from "node:path";
import { roomSchema } from "./validation.js";
import type { Store } from "./store.js";
export async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export function verifyDatabase(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      (
        db.prepare("PRAGMA integrity_check").get() as {
          integrity_check: string;
        }
      ).integrity_check !== "ok"
    )
      throw new Error("SQLite integrity check failed");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("SQLite foreign-key check failed");
    let rooms = 0;
    for (const row of db
      .prepare(
        "SELECT body FROM rooms WHERE code NOT IN (SELECT code FROM quarantine)",
      )
      .iterate()) {
      roomSchema.parse(JSON.parse(String(row.body)));
      rooms++;
    }
    return { rooms };
  } finally {
    db.close();
  }
}
export async function createVerifiedBackup(store: Store, directory: string) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const name = `ludo-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomUUID().slice(0, 8)}.sqlite`,
    destination = join(root, name),
    partial = destination + ".partial";
  await store.backup(partial);
  const counts = verifyDatabase(partial),
    sha256 = await fileHash(partial);
  await rename(partial, destination);
  await writeFile(
    destination + ".json",
    JSON.stringify(
      {
        version: 1,
        file: name,
        sha256,
        createdAt: new Date().toISOString(),
        ...counts,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  return { path: destination, sha256, ...counts };
}
export async function pruneBackups(directory: string, now = Date.now()) {
  const root = resolve(directory);
  const files = await readdir(root);
  const candidates = await Promise.all(
    files
      .filter((n) => /^ludo-\d{8}T\d{6}-[a-f0-9]{8}\.sqlite$/.test(n))
      .map(async (name) => ({
        name,
        at: (await stat(join(root, name))).mtimeMs,
      })),
  );
  candidates.sort((a, b) => b.at - a.at);
  for (let i = 2; i < candidates.length; i++)
    if (i >= 28 || now - candidates[i].at > 7 * 86400000) {
      const path = resolve(root, candidates[i].name);
      if (!path.startsWith(root + sep))
        throw new Error("Backup path escaped retention directory");
      await unlink(path);
      await unlink(path + ".json").catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
}
export async function restoreBackup(source: string, destination: string) {
  const from = resolve(source),
    to = resolve(destination);
  const manifest = JSON.parse(await readFile(from + ".json", "utf8")) as {
    sha256: string;
    file: string;
  };
  if (
    manifest.file !== basename(from) ||
    (await fileHash(from)) !== manifest.sha256
  )
    throw new Error("Backup checksum does not match manifest");
  verifyDatabase(from);
  await mkdir(dirname(to), { recursive: true, mode: 0o700 });
  try {
    await stat(to);
    throw new Error(
      "Restore destination exists; choose a new path. Live databases are never overwritten.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const staging = join(dirname(to), `.restore-${randomUUID()}.sqlite`);
  try {
    await copyFile(from, staging);
    const db = new DatabaseSync(staging);
    try {
      db.exec(
        "DELETE FROM server_lock; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;",
      );
    } finally {
      db.close();
    }
    verifyDatabase(staging);
    await link(staging, to);
  } finally {
    await unlink(staging).catch(() => {});
  }
  return { path: to, ...verifyDatabase(to) };
}
