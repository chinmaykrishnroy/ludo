import { test, expect } from "@playwright/test";
import { newGame, seat } from "../shared/game";
import { createApplication } from "../server/app";
import { AdmissionController } from "../server/admission";
import express from "express";
import { once } from "node:events";
import { resolve } from "node:path";
import { io } from "socket.io-client";

for (const value of [1, 2, 3, 4, 5, 6])
  test(`the physical die lands with face ${value} toward the player`, async ({
    page,
  }) => {
    const game = newGame([
      seat("local-you", "Alice", 0),
      seat("bob", "Bob", 1),
      null,
      null,
    ]);
    game.seats[0]!.tokens = [0, 14, -1, -1];
    await page.addInitScript(
      ({ game, value }) => {
        game.deadline = Date.now() + 15000;
        localStorage.setItem("ludo-local-game-v1", JSON.stringify(game));
        Object.defineProperty(crypto, "getRandomValues", {
          value: (a: Uint32Array) => {
            a.fill(value - 1);
            return a;
          },
        });
      },
      { game, value },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Roll dice", exact: true }).click();
    await expect(
      page.getByRole("img", { name: `Dice showing ${value}`, exact: true }),
    ).toBeVisible();
    const normal = await page
      .locator(`.dice-face[data-face="${value}"]`)
      .evaluate((face) => {
        const parent = new DOMMatrixReadOnly(
          getComputedStyle(face.parentElement!).transform,
        );
        const local = new DOMMatrixReadOnly(getComputedStyle(face).transform);
        const n = parent.transformPoint(
          local.transformPoint(new DOMPoint(0, 0, 1, 0)),
        );
        return n.z / Math.hypot(n.x, n.y, n.z);
      });
    expect(
      normal,
      "The announced result must be the actual face pointing at the viewer",
    ).toBeGreaterThan(0.999);
    await expect(page.locator(".dice")).toHaveAttribute(
      "data-phase",
      "settled",
    );
    if (value === 4)
      await page
        .locator(".dice")
        .screenshot({ path: "output/playwright/v0110-dice-four.png" });
  });

test("reduced motion reveals the same result without a tumbling animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const game = newGame([
    seat("local-you", "Alice", 0),
    seat("bob", "Bob", 1),
    null,
    null,
  ]);
  game.seats[0]!.tokens = [0, 14, -1, -1];
  await page.addInitScript((game) => {
    game.deadline = Date.now() + 15000;
    localStorage.setItem("ludo-local-game-v1", JSON.stringify(game));
    Object.defineProperty(crypto, "getRandomValues", {
      value: (a: Uint32Array) => {
        a.fill(3);
        return a;
      },
    });
  }, game);
  await page.goto("/");
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Dice showing 4", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".dice")
      .evaluate((e) => e.getAnimations({ subtree: true }).length),
  ).toBe(0);
});

test("opening a saved position does not replay its historical last move", async ({
  page,
}) => {
  const game = newGame([
    seat("local-you", "Alice", 0),
    seat("bob", "Bob", 1),
    null,
    null,
  ]);
  game.seats[0]!.tokens = [4, 14, -1, -1];
  game.turn = 1;
  game.revision = 2;
  game.dice = 4;
  game.lastMove = { color: "red", token: 0, from: 0, to: 4, captured: 0 };
  await page.addInitScript((game) => {
    game.deadline = Date.now() + 15000;
    localStorage.setItem("ludo-local-game-v1", JSON.stringify(game));
    Reflect.set(window, "restoredFrames", []);
    const observer = new MutationObserver(() => {
      const token = document.querySelector(".token.red");
      if (!token) return;
      observer.disconnect();
      const start = performance.now();
      const sample = () => {
        Reflect.get(window, "restoredFrames").push({
          t: performance.now() - start,
          x: token.getBoundingClientRect().x,
        });
        if (performance.now() - start < 1100) requestAnimationFrame(sample);
      };
      sample();
    });
    observer.observe(document, { childList: true, subtree: true });
  }, game);
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "restoredFrames").at(-1)?.t),
    )
    .toBeGreaterThan(1000);
  const positions = await page.evaluate(
    () =>
      Reflect.get(window, "restoredFrames").map(
        (s: { x: number }) => s.x,
      ) as number[],
  );
  expect(
    Math.max(...positions) - Math.min(...positions),
    "Restored token should stay on its saved square",
  ).toBeLessThan(3);
});

test("dice uses fixed face graphics and lands on the authoritative four without repainting pips", async ({
  page,
}) => {
  const game = newGame([
    seat("local-you", "Alice", 0),
    seat("bob", "Bob", 1),
    null,
    null,
  ]);
  game.seats[0]!.tokens = [0, 14, -1, -1];
  await page.addInitScript((game) => {
    game.deadline = Date.now() + 15000;
    localStorage.setItem("ludo-local-game-v1", JSON.stringify(game));
    Object.defineProperty(crypto, "getRandomValues", {
      value: (a: Uint32Array) => {
        a.fill(3);
        return a;
      },
    });
  }, game);
  await page.goto("/");
  const die = page.locator(".dice");
  await die.evaluate((element) => {
    Reflect.set(window, "pipRepaints", 0);
    new MutationObserver((entries) => {
      for (const entry of entries)
        if ((entry.target as Element).matches(".dice-pips i"))
          Reflect.set(
            window,
            "pipRepaints",
            Reflect.get(window, "pipRepaints") + 1,
          );
    }).observe(element, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Dice showing 4", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "pipRepaints")),
    "The visible face must turn into view, rather than changing the pip pattern at reveal",
  ).toBe(0);
});

test("a moved token never snaps back and replays when the UI unlocks", async ({
  page,
}) => {
  const game = newGame([
    seat("local-you", "Alice", 0),
    seat("bob", "Bob", 1),
    null,
    null,
  ]);
  game.seats[0]!.tokens = [0, 14, -1, -1];
  game.revision = 0;
  await page.addInitScript((game) => {
    game.deadline = Date.now() + 30000;
    Object.defineProperty(crypto, "getRandomValues", {
      value: (a: Uint32Array) => {
        a.fill(3);
        return a;
      },
    });
    localStorage.setItem("ludo-local-game-v1", JSON.stringify(game));
  }, game);
  await page.goto("/");
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  const token = page.locator(".token.red").first();
  await expect(token).toBeEnabled();
  await token.evaluate((element) => {
    const samples: { t: number; x: number }[] = [];
    Reflect.set(window, "tokenFrames", samples);
    element.addEventListener(
      "click",
      () => {
        const start = performance.now();
        const sample = () => {
          samples.push({
            t: performance.now() - start,
            x: element.getBoundingClientRect().x,
          });
          if (performance.now() - start < 3500) requestAnimationFrame(sample);
        };
        sample();
      },
      { once: true },
    );
  });
  await token.click();
  const nextRoll = page.getByRole("button", { name: "Roll dice", exact: true });
  await expect(nextRoll).toBeEnabled();
  await nextRoll.click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "tokenFrames").at(-1)?.t),
    )
    .toBeGreaterThan(3400);
  const frames = await page.evaluate(
    () => Reflect.get(window, "tokenFrames") as { t: number; x: number }[],
  );
  const reversals = frames.slice(1).filter((f, i) => f.x < frames[i].x - 3);
  expect(frames.at(-1)!.x - frames[0].x).toBeGreaterThan(40);
  expect(
    reversals,
    "Token must travel to its destination once, without returning toward its origin",
  ).toEqual([]);
});

test("dice keeps tumbling while waiting for authority instead of freezing and swapping pips", async ({
  page,
}) => {
  await page.routeWebSocket("**/socket.io/**", (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (typeof message === "string" && message.includes('"game:roll"'))
        setTimeout(() => server.send(message), 1600);
      else server.send(message);
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "PLAY WITH FRIENDS", exact: true })
    .click();
  await page.getByLabel("Computer players to start").selectOption("1");
  await page
    .getByRole("dialog", { name: "PLAY ONLINE" })
    .getByRole("button", { name: "Create room", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "START GAME", exact: true }).click();
  const roll = page.getByRole("button", { name: "Roll dice", exact: true });
  await expect(roll).toBeEnabled();
  await roll.evaluate((button) => {
    const samples: { t: number; transform: string; rolling: boolean }[] = [];
    Reflect.set(window, "diceFrames", samples);
    button.addEventListener(
      "click",
      () => {
        const start = performance.now();
        const sample = () => {
          const die = button.querySelector(".dice")!;
          const moving = die.querySelector(".dice-cube") ?? die;
          samples.push({
            t: performance.now() - start,
            transform: getComputedStyle(moving).transform,
            rolling: die.classList.contains("rolling"),
          });
          if (performance.now() - start < 1250) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      { once: true },
    );
  });
  await roll.click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "diceFrames").at(-1)?.t),
    )
    .toBeGreaterThan(1150);
  const frames = await page.evaluate(
    () =>
      Reflect.get(window, "diceFrames") as {
        t: number;
        transform: string;
        rolling: boolean;
      }[],
  );
  const waiting = frames.filter((f) => f.t > 800 && f.t < 1150);
  expect(waiting.every((f) => f.rolling)).toBe(true);
  expect(
    new Set(waiting.map((f) => f.transform)).size,
    "The die must keep physically moving until the authoritative result can land",
  ).toBeGreaterThan(4);
});

test("online snapshots and the following roll cannot replay a completed move", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const service = createApplication({
    dbPath: ":memory:",
    tickMs: 60000,
    admission: new AdmissionController(),
  });
  service.app.use(express.static(resolve("dist")));
  service.http.listen(0, "127.0.0.1");
  await once(service.http, "listening");
  const origin = `http://127.0.0.1:${(service.http.address() as { port: number }).port}`;
  const session = await fetch(origin + "/api/session");
  const peer = io(origin, {
    transports: ["websocket"],
    extraHeaders: { Cookie: session.headers.get("set-cookie")!.split(";")[0] },
    autoConnect: false,
    reconnection: false,
  });
  try {
    await page.goto(origin);
    await page
      .getByRole("button", { name: "PLAY WITH FRIENDS", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "PLAY ONLINE" })
      .getByRole("button", { name: "Create room", exact: true })
      .last()
      .click();
    const code = await page.locator(".invite-strip strong").innerText();
    await new Promise<void>((resolve, reject) => {
      peer.once("connect", resolve);
      peer.once("connect_error", reject);
      peer.connect();
    });
    await peer
      .timeout(3000)
      .emitWithAck("room:join", { code, playerName: "Bob" });
    const room = structuredClone(service.rooms.get(code)!);
    room.game = newGame(room.seats);
    room.game.seats[0]!.tokens = [0, 14, -1, -1];
    room.game.phase = "move";
    room.game.dice = 4;
    room.game.revision = 1;
    room.game.deadline = Date.now() + 30000;
    room.seats = structuredClone(room.game.seats);
    service.rooms.set(code, room);
    service.store.save(room);
    service.io.to(code).emit("room:state", room);
    const token = page.locator(".token.red").first();
    await expect(token).toBeEnabled();
    await token.evaluate((element) => {
      Reflect.set(window, "onlineFrames", []);

      element.addEventListener(
        "click",
        () => {
          const start = performance.now();
          const sample = () => {
            Reflect.get(window, "onlineFrames").push({
              t: performance.now() - start,
              x: element.getBoundingClientRect().x,
            });
            if (performance.now() - start < 3600) requestAnimationFrame(sample);
          };
          sample();
        },
        { once: true },
      );
    });
    await token.click();
    await expect(token).toHaveAttribute("aria-label", /space 4/);
    await peer
      .timeout(3000)
      .emitWithAck("chat:send", { text: "Snapshot while the move settles" });
    await expect
      .poll(
        () => Date.now() - (service.rooms.get(code)!.game!.deadline - 15000),
      )
      .toBeGreaterThan(1200);
    const before = service.rooms.get(code)!.game!;
    await peer
      .timeout(3000)
      .emitWithAck("game:roll", { revision: before.revision });
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "onlineFrames").at(-1)?.t),
      )
      .toBeGreaterThan(3500);
    const frames = await page.evaluate(
      () => Reflect.get(window, "onlineFrames") as { t: number; x: number }[],
    );
    expect(frames.at(-1)!.x - frames[0].x).toBeGreaterThan(40);
    expect(frames.slice(1).filter((f, i) => f.x < frames[i].x - 3)).toEqual([]);
  } finally {
    peer.disconnect();
    await service.close();
  }
});
