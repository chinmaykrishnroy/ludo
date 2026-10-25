import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
test("release source must match package version, lockfile, tag and validated commit", () => {
  const root = mkdtempSync(join(tmpdir(), "ludo-release-test-")),
    git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    mkdirSync(join(root, "docs/releases"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "0.1.0" }),
    );
    writeFileSync(
      join(root, "package-lock.json"),
      JSON.stringify({
        version: "0.1.0",
        packages: { "": { version: "0.1.0" } },
      }),
    );
    writeFileSync(join(root, "docs/releases/v0.1.0.md"), "Notes");
    git("init", "-b", "main");
    git("add", "package.json", "package-lock.json", "docs");
    git(
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release-test@example.invalid",
      "commit",
      "-m",
      "Fixture",
    );
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("tag", "v0.1.0");
    const env = { ...process.env, GITHUB_SHA: git("rev-parse", "HEAD") },
      script = resolve("scripts/validate-release.mjs");
    assert.equal(
      spawnSync(process.execPath, [script, "v0.1.0"], { cwd: root, env })
        .status,
      0,
    );
    const bad = spawnSync(process.execPath, [script, "v0.2.0"], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /tag must match/);
    writeFileSync(join(root, "README.md"), "changed source");
    git("add", "README.md");
    git(
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release-test@example.invalid",
      "commit",
      "-m",
      "New commit",
    );
    const stale = spawnSync(process.execPath, [script, "v0.1.0"], {
      cwd: root,
      env: { ...env, GITHUB_SHA: git("rev-parse", "HEAD") },
      encoding: "utf8",
    });
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /exact tagged commit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("release manifests must contain both exact smoke-tested architecture digests", () => {
  const moduleUrl = pathToFileURL(
    resolve("scripts/verify-container-release.mjs"),
  ).href;
  const script = `import assert from 'node:assert/strict';const {verifyManifest}=await import(${JSON.stringify(moduleUrl)});const a={digest:'sha256:'+'a'.repeat(64)},b={digest:'sha256:'+'b'.repeat(64)},m={digest:'sha256:'+'c'.repeat(64),manifests:[{digest:a.digest,platform:{os:'linux',architecture:'amd64'}},{digest:b.digest,platform:{os:'linux',architecture:'arm64'}}]};assert.equal(verifyManifest(m,a,b),m.digest);assert.throws(()=>verifyManifest(m,a,a));assert.throws(()=>verifyManifest({...m,manifests:[m.manifests[0]]},a,b));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
});
