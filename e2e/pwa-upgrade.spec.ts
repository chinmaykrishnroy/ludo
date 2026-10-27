import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { serviceWorkerSource } from "../scripts/service-worker.mjs";
import { newGame, seat } from "../shared/game";

test("a two-version PWA update waits for active games, then reopens offline without losing tokens or deadlines", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const files = new Map<string, Buffer>();
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await walk(next);
      else
        files.set(
          "/" + next.replaceAll("\\", "/").replace(/^dist\//, ""),
          await readFile(next),
        );
    }
  }
  await walk("dist");
  const html = files.get("/index.html")!.toString(),
    main = html.match(/src="(\/assets\/index-[^"]+\.js)"/)![1];
  let version = "old",
    missing = 0;
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://fixture").pathname;
    const assets = [
      "/",
      ...[...files.keys()].filter(
        (p) => p !== "/index.html" && p !== "/sw.js" && p !== main,
      ),
      `/assets/main-${version}.js`,
    ];
    if (path === "/sw.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Cache-Control", "no-cache");
      res.end(serviceWorkerSource(version, assets));
      return;
    }
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        html
          .replace(main, `/assets/main-${version}.js`)
          .replace("<html", '<html data-test-build="' + version + '"'),
      );
      return;
    }
    if (path === `/assets/main-${version}.js`) {
      res.setHeader("Content-Type", "application/javascript");
      res.end(files.get(main));
      return;
    }
    if (path.startsWith("/api/") || path.startsWith("/socket.io/")) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    const data = files.get(path);
    if (!data) {
      missing++;
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Missing");
      return;
    }
    const type = path.endsWith(".js")
      ? "application/javascript"
      : path.endsWith(".css")
        ? "text/css"
        : path.endsWith(".svg")
          ? "image/svg+xml"
          : path.endsWith(".webmanifest")
            ? "application/manifest+json"
            : "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.end(data);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const game = newGame([
    seat("local-you", "Alice", 0),
    seat("bob", "Bob", 1),
    null,
    null,
  ]);
  game.seats[0]!.tokens = [3, 10, -1, -1];
  game.phase = "move";
  game.dice = 2;
  game.revision = 4;
  game.deadline = Date.now() + 120000;
  try {
    await page.goto(origin);
    await page.evaluate(
      (game) =>
        localStorage.setItem("ludo-local-game-v1", JSON.stringify(game)),
      game,
    );
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    expect(await page.locator("html").getAttribute("data-test-build")).toBe(
      "old",
    );
    version = "new";
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())!.update();
    });
    await page.waitForFunction(
      async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
    );
    expect(await page.locator("html").getAttribute("data-test-build")).toBe(
      "old",
    );
    await expect(
      page.getByRole("button", {
        name: "red token 1, space 3, move available",
        exact: true,
      }),
    ).toBeVisible();
    const missingStatus = await page.evaluate(async () => {
      const a = await fetch("/assets/missing.js"),
        b = await fetch("/assets/missing.js");
      return [a.status, b.status, !!(await caches.match("/assets/missing.js"))];
    });
    expect(missingStatus).toEqual([404, 404, false]);
    expect(missing).toBe(2);
    const next = await context.newPage();
    await next.goto(origin);
    expect(await next.locator("html").getAttribute("data-test-build")).toBe(
      "new",
    );
    await page.close();
    await next.close();
    await new Promise((r) => setTimeout(r, 500));
    // With no old document alive, the waiting worker may activate safely.
    const control = await context.newPage();
    await control.goto(origin);
    await control.waitForFunction(
      async () => !(await navigator.serviceWorker.getRegistration())?.waiting,
    );
    await control.close();
    await context.setOffline(true);
    const offline = await context.newPage();
    await offline.goto(origin);
    await expect(
      offline.getByRole("button", {
        name: "red token 1, space 3, move available",
        exact: true,
      }),
    ).toBeVisible();
    const restored = await offline.evaluate(
      () => JSON.parse(localStorage.getItem("ludo-local-game-v1")!).game,
    );
    expect(restored.deadline).toBe(game.deadline);
    expect(restored.seats[0].tokens).toEqual(game.seats[0]!.tokens);
    expect(await offline.locator("html").getAttribute("data-test-build")).toBe(
      "new",
    );
    expect(
      await offline.evaluate(async () => (await fetch("/favicon.svg?v=2")).ok),
    ).toBe(true);
  } finally {
    await context.setOffline(false);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
