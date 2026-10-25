import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
test("installed shell and assets load with network unavailable; private APIs are never cached", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ludo-pwa-"));
  try {
    mkdirSync(join(directory, "dist/assets"), { recursive: true });
    writeFileSync(
      join(directory, "dist/index.html"),
      "<html>Offline Ludo</html>",
    );
    writeFileSync(join(directory, "dist/assets/game.js"), "offline engine");
    const generated = spawnSync(
      process.execPath,
      [resolve("scripts/build-service-worker.mjs")],
      { cwd: directory, encoding: "utf8" },
    );
    assert.equal(generated.status, 0, generated.stderr);
    const cachesData = new Map<string, Map<string, Response>>(),
      listeners: Record<string, (e: any) => void> = {};
    let online = true;
    const caches = {
      open: async (name: string) => {
        if (!cachesData.has(name)) cachesData.set(name, new Map());
        const data = cachesData.get(name)!;
        return {
          addAll: async (urls: string[]) => {
            for (const url of urls)
              data.set(
                url,
                new Response(
                  url === "/" ? "<html>Offline Ludo</html>" : "offline engine",
                ),
              );
          },
          put: async (request: any, response: Response) => {
            data.set(
              typeof request === "string"
                ? request
                : new URL(request.url).pathname,
              response,
            );
          },
        };
      },
      keys: async () => [...cachesData.keys()],
      delete: async (name: string) => cachesData.delete(name),
      match: async (request: any) => {
        const key =
          typeof request === "string" ? request : new URL(request.url).pathname;
        for (const data of cachesData.values()) {
          const response = data.get(key);
          if (response) return response.clone();
        }
        return undefined;
      },
    };
    const self = {
      location: { origin: "https://ludo.test" },
      clients: { claim: async () => {} },
      addEventListener: (type: string, fn: (e: any) => void) => {
        listeners[type] = fn;
      },
    };
    runInNewContext(readFileSync(join(directory, "dist/sw.js"), "utf8"), {
      self,
      caches,
      URL,
      fetch: async () => {
        if (!online) throw new Error("Offline");
        return new Response("network");
      },
    });
    let pending: Promise<unknown> | undefined;
    listeners.install({
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
    online = false;
    const request = async (path: string, mode: string) => {
      let result: Promise<Response> | undefined;
      listeners.fetch({
        request: { url: `https://ludo.test${path}`, method: "GET", mode },
        respondWith: (p: Promise<Response>) => {
          result = p;
        },
      });
      return result ? await result : undefined;
    };
    assert.match(
      await (await request("/", "navigate"))!.text(),
      /Offline Ludo/,
    );
    assert.equal(
      await (await request("/assets/game.js", "cors"))!.text(),
      "offline engine",
    );
    assert.equal(await request("/api/session", "cors"), undefined);
    assert.equal(await request("/api/voice/private", "cors"), undefined);
    assert.equal(await request("/socket.io/", "cors"), undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
