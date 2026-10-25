import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
export function releaseVersion(tag, version) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${version}`)
    throw new Error(
      "Release tag must match package.json exactly, for example v0.1.0",
    );
  return version;
}
export function validateRelease(tag) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")),
    lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const version = releaseVersion(tag, pkg.version);
  if (lock.version !== version || lock.packages[""].version !== version)
    throw new Error("Lockfile version differs from package.json");
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  const commit = git("rev-parse", "HEAD"),
    tagCommit = git("rev-parse", `${tag}^{commit}`);
  if (
    commit !== tagCommit ||
    (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit)
  )
    throw new Error("Release must package the exact tagged commit");
  execFileSync("git", ["merge-base", "--is-ancestor", commit, "origin/main"]);
  readFileSync(`docs/releases/${tag}.md`, "utf8");
  return { tag, version, commit };
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/validate-release.mjs"))
  console.log(JSON.stringify(validateRelease(process.argv[2])));
