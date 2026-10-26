import { readFileSync, appendFileSync } from "node:fs";
function version(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  return match ? match.slice(1).map(BigInt) : null;
}
export function compareReleaseTags(a, b) {
  const left = version(a),
    right = version(b);
  if (!left || !right) throw new Error("Expected stable vX.Y.Z release tags");
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function shouldPromoteRelease(candidate, releases) {
  if (!version(candidate)) throw new Error("Invalid candidate release tag");
  return !releases.some(
    (release) =>
      !release.draft &&
      !release.prerelease &&
      version(release.tag_name) &&
      compareReleaseTags(release.tag_name, candidate) > 0,
  );
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/release-order.mjs")) {
  const releases = JSON.parse(readFileSync(process.argv[3], "utf8")).flat();
  const promote = shouldPromoteRelease(process.argv[2], releases);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `promote_latest=${promote}\n`);
  console.log(JSON.stringify({ tag: process.argv[2], promoteLatest: promote }));
}
