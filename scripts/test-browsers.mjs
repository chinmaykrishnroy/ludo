import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
// Each CI browser job already has a fresh server. Match that isolation locally:
// sharing one server across all engines can exhaust real per-IP room quotas.
const explicit = args.some(
  (arg) =>
    arg === "--project" ||
    arg.startsWith("--project=") ||
    ["--list", "--help", "--ui", "--debug"].includes(arg),
);
const runs = explicit
  ? [args]
  : ["chromium", "firefox", "webkit"].map((project) => [
      ...args,
      `--project=${project}`,
    ]);
for (const run of runs) {
  const result = spawnSync(
    process.execPath,
    [resolve("node_modules/@playwright/test/cli.js"), "test", ...run],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
