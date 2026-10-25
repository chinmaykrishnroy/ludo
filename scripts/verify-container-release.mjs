import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
export function verifyManifest(manifest, amd64, arm64) {
  assert.match(manifest.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    manifest.manifests?.length,
    2,
    "Release must contain exactly two architecture images",
  );
  const platforms = manifest.manifests?.filter(
    (m) =>
      m.platform?.os === "linux" &&
      ["amd64", "arm64"].includes(m.platform.architecture),
  );
  assert.equal(
    platforms?.length,
    2,
    "Release must contain Linux AMD64 and ARM64",
  );
  assert.equal(
    platforms.find((m) => m.platform.architecture === "amd64")?.digest,
    amd64.digest,
  );
  assert.equal(
    platforms.find((m) => m.platform.architecture === "arm64")?.digest,
    arm64.digest,
  );
  return manifest.digest;
}
if (
  process.argv[1]
    ?.replaceAll("\\", "/")
    .endsWith("/verify-container-release.mjs")
) {
  const [image, tag, manifestPath, amd64Path, arm64Path] =
      process.argv.slice(2),
    read = (p) => JSON.parse(readFileSync(p, "utf8"));
  const digest = verifyManifest(
    read(manifestPath),
    read(amd64Path),
    read(arm64Path),
  );
  if (
    !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(image) ||
    !/^v\d+\.\d+\.\d+$/.test(tag)
  )
    throw new Error("Invalid release reference");
  const repository = image.slice("ghcr.io/".length),
    tokenResponse = await fetch(
      `https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull`,
    );
  if (!tokenResponse.ok)
    throw new Error(
      `Anonymous image pull is unavailable. Set the GitHub package visibility to Public, then rerun this failed job: https://github.com/users/${repository.split("/")[0]}/packages/container/package/${repository.split("/")[1]}/settings`,
    );
  const { token } = await tokenResponse.json(),
    response = await fetch(
      `https://ghcr.io/v2/${repository}/manifests/${tag}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept:
            "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
        },
      },
    );
  if (!response.ok)
    throw new Error("Published image is not anonymously pullable");
  const raw = Buffer.from(await response.arrayBuffer());
  assert.equal(
    "sha256:" + createHash("sha256").update(raw).digest("hex"),
    digest,
  );
  assert.equal(response.headers.get("docker-content-digest"), digest);
  writeFileSync(
    "image-metadata.json",
    JSON.stringify(
      {
        image,
        tag,
        digest,
        commit: process.env.GITHUB_SHA,
        platforms: ["linux/amd64", "linux/arm64"],
        pinnedImage: `${image}@${digest}`,
        versionImage: `${image}:${tag}`,
        latestImage: `${image}:latest`,
        anonymousPullVerified: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ image, tag, digest, anonymousPullVerified: true }),
  );
}
