import { DatabaseSync } from "node:sqlite";
import { roomSchema } from "./validation.js";
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
