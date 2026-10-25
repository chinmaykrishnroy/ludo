import { restoreBackup } from "../build/server/backups.js";
const args = process.argv.slice(2),
  from = args[args.indexOf("--from") + 1],
  to = args[args.indexOf("--to") + 1];
if (!args.includes("--from") || !args.includes("--to") || !from || !to)
  throw new Error(
    "Usage: node scripts/restore.mjs --from <backup.sqlite> --to <new-database.sqlite>",
  );
console.log(JSON.stringify(await restoreBackup(from, to)));
