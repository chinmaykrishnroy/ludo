import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  stat,
  unlink,
  copyFile,
  link,
} from "node:fs/promises";
import { basename, dirname, resolve, sep, join } from "node:path";
import { verifyDatabase } from "./backup-validation.js";
export { verifyDatabase } from "./backup-validation.js";
import type { Store } from "./store.js";
import { verifyBackupAsync } from "./backup-verifier.js";
export async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
type BackupFiles = { writeFile: typeof writeFile; link: typeof link };
export async function createVerifiedBackup(
  store: Store,
  directory: string,
  files: BackupFiles = { writeFile, link },
  observe?: (
    stage: "backupCopy" | "backupVerify" | "backupHash",
    elapsedMs: number,
  ) => void,
) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const name = `ludo-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomUUID().slice(0, 8)}.sqlite`;
  const destination = join(root, name),
    staging = join(root, `.backup-${randomUUID()}`);
  if (!staging.startsWith(root + sep))
    throw new Error("Backup staging escaped its directory");
  await mkdir(staging, { mode: 0o700 });
  const database = join(staging, "database.sqlite"),
    manifest = join(staging, "manifest.json");
  let publishedManifest = false,
    publishedDatabase = false;
  try {
    let started = performance.now();
    await store.backup(database);
    observe?.("backupCopy", performance.now() - started);
    started = performance.now();
    const counts = await verifyBackupAsync(database);
    observe?.("backupVerify", performance.now() - started);
    started = performance.now();
    const sha256 = await fileHash(database);
    observe?.("backupHash", performance.now() - started);
    await files.writeFile(
      manifest,
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
      { flag: "wx", mode: 0o600, flush: true },
    );
    // Exclusive links cannot overwrite an existing recovery copy. Publishing
    // metadata first means any visible database already has its verified manifest.
    await files.link(manifest, destination + ".json");
    publishedManifest = true;
    await files.link(database, destination);
    publishedDatabase = true;
    return { path: destination, sha256, ...counts };
  } catch (error) {
    if (publishedManifest && !publishedDatabase)
      await unlink(destination + ".json").catch(() => {});
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(
      (error: NodeJS.ErrnoException) => {
        process.stderr.write(
          JSON.stringify({
            event: "backup_temp_cleanup_failed",
            code: error.code ?? "ERROR",
          }) + "\n",
        );
      },
    );
  }
}
export async function pruneBackups(directory: string, now = Date.now()) {
  const root = resolve(directory),
    entries = await readdir(root, { withFileTypes: true });
  const candidates: { name: string; at: number }[] = [],
    invalid: string[] = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (!path.startsWith(root + sep))
      throw new Error("Backup path escaped retention directory");
    if (
      entry.isFile() &&
      /^ludo-\d{8}T\d{6}-[a-f0-9]{8}\.sqlite\.partial$/.test(entry.name)
    ) {
      if (now - (await stat(path)).mtimeMs > 3600000) await unlink(path);
      continue;
    }
    if (
      entry.isDirectory() &&
      /^\.backup-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(entry.name)
    ) {
      if (now - (await stat(path)).mtimeMs > 3600000)
        await rm(path, { recursive: true, force: true });
      continue;
    }
    if (
      !entry.isFile() ||
      !/^ludo-\d{8}T\d{6}-[a-f0-9]{8}\.sqlite$/.test(entry.name)
    )
      continue;
    try {
      const manifest = JSON.parse(await readFile(path + ".json", "utf8"));
      if (
        manifest.version !== 1 ||
        manifest.file !== entry.name ||
        !/^[a-f0-9]{64}$/.test(manifest.sha256)
      )
        throw new Error("Invalid manifest");
      candidates.push({ name: entry.name, at: (await stat(path)).mtimeMs });
    } catch {
      invalid.push(entry.name);
    }
  }
  candidates.sort((a, b) => b.at - a.at);
  let removed = 0;
  for (let i = 2; i < candidates.length; i++)
    if (i >= 28 || now - candidates[i].at > 7 * 86400000) {
      const path = resolve(root, candidates[i].name);
      if (!path.startsWith(root + sep))
        throw new Error("Backup path escaped retention directory");
      await unlink(path);
      await unlink(path + ".json").catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      removed++;
    }
  return { removed, invalid };
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
