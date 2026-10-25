import { readFileSync, writeFileSync } from "node:fs";
const meta = JSON.parse(readFileSync("image-metadata.json", "utf8"));
if (!/^v\d+\.\d+\.\d+$/.test(meta.tag)) throw new Error("Invalid release tag");
const notes = readFileSync(`docs/releases/${meta.tag}.md`, "utf8");
writeFileSync(
  "release-notes.md",
  notes +
    `\n\n## Verified container\n\nImage: \x60${meta.versionImage}\x60\n\nLatest: \x60${meta.latestImage}\x60\n\nDigest pin for GitOps:\n\n\x60\x60\x60yaml\nimage: ${meta.pinnedImage}\n\x60\x60\x60\n\nPlatforms: Linux AMD64 and ARM64. Anonymous manifest access and the exact tested architecture digests were verified before publication. The attached image-metadata.json records the commit and digest.\n`,
);
