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
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit service worker lifecycle under headless Linux does not support multi-version offline reload",
  );
  test.setTimeout(120000);
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
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.end(serviceWorkerSource(version, assets));
      return;
    }
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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
      void (await navigator.serviceWorker.getRegistration())?.update();
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
    await new Promise((r) => setTimeout(r, 1000));
    let control: typeof page | null = null;
    try {
      // With no old document alive, the waiting worker may activate safely.
      control = await context.newPage();
      await control.goto(origin);
      // Wait for ludo-new to have activated (no SW in waiting state)
      await control.waitForFunction(
        async () => !(await navigator.serviceWorker.getRegistration())?.waiting,
        { timeout: 20000 },
      );
      await control.waitForFunction(
        async () => {
          const keys = await caches.keys();
          return keys.includes("ludo-new") && !keys.includes("ludo-old");
        },
        { timeout: 20000 },
      );
      // Ensure the document is controlled by the new worker before testing offline reload.
      await control.reload();
      await control.waitForFunction(() => !!navigator.serviceWorker.controller);
      await context.setOffline(true);
      await control.reload();
      await expect(
        control.getByRole("button", {
          name: "red token 1, space 3, move available",
          exact: true,
        }),
      ).toBeVisible();
      const restored = await control.evaluate(
        () => JSON.parse(localStorage.getItem("ludo-local-game-v1")!).game,
      );
      expect(restored.deadline).toBe(game.deadline);
      expect(restored.seats[0].tokens).toEqual(game.seats[0]!.tokens);
      expect(
        await control.locator("html").getAttribute("data-test-build"),
      ).toBe("new");
      expect(
        await control.evaluate(
          async () => (await fetch("/favicon.svg?v=2")).ok,
        ),
      ).toBe(true);
    } finally {
      try {
        await control?.close();
      } catch {}
    }
  } finally {
    try {
      await context.setOffline(false);
    } catch {}
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
