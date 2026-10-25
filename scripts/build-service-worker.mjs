import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
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
await writeFile(
  "dist/sw.js",
  `const CACHE='ludo-${version}';const ASSETS=${JSON.stringify(precache)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ludo-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/socket.io/'))return;
 if(request.mode==='navigate'){const fallback=async()=>await caches.match(url.pathname)||await caches.match('/');event.respondWith(fetch(request).then(response=>response.ok?response:fallback()).catch(fallback));return;}
 if(ASSETS.includes(url.pathname)||url.pathname.startsWith('/assets/'))event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(response=>{if(response.ok){const copy=response.clone();void caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;})));
});
`,
);
console.log("Offline app cache prepared:", precache.length, "assets.");
