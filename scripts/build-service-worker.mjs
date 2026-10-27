import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { serviceWorkerSource } from "./service-worker.mjs";
async function walk(path) {
  const files = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    const p = join(path, item.name);
    if (item.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}
const files = (await walk("dist")).filter(
  (f) => !f.endsWith("sw.js") && !f.endsWith(".map"),
);
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile(file));
const version = hash.digest("hex").slice(0, 16),
  assets = files
    .map((f) => "/" + f.replaceAll("\\", "/").replace(/^dist\//, ""))
    .filter((f) => f !== "/index.html");
const precache = ["/", ...assets];
await writeFile("dist/sw.js", serviceWorkerSource(version, precache));
console.log("Offline app cache prepared:", precache.length, "assets.");
