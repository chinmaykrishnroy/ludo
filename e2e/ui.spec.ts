import { test, expect } from "@playwright/test";
import { newGame, seat } from "../shared/game";

test("lobby tools match settings and keep equal gaps without narrow-screen overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "PLAY WITH FRIENDS", exact: true })
    .click();
  await page.getByLabel("Computer players to start").selectOption("3");
  await page
    .getByRole("dialog", { name: "PLAY ONLINE" })
    .getByRole("button", { name: /^Create room$/ })
    .last()
    .click();
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const names = ["Mute speakers", "Open room chat", "Settings"];
    const rects = [];
    for (const name of names)
      rects.push(
        (await page.getByRole("button", { name, exact: true }).boundingBox())!,
      );
    expect(rects.map((r) => [r.width, r.height])).toEqual(
      Array(3).fill([46, 46]),
    );
    const gaps = [
      rects[1].x - rects[0].x - rects[0].width,
      rects[2].x - rects[1].x - rects[1].width,
    ];
    expect(Math.abs(gaps[0] - gaps[1])).toBeLessThan(1);
    expect(gaps[0]).toBeGreaterThanOrEqual(8);
    if (width === 390)
      await page.screenshot({
        path: "output/playwright/lobby-phone.png",
        fullPage: true,
      });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const select of await page.locator(".seat-row select").all()) {
      const box = (await select.boundingBox())!;
      const row = (await select
        .locator('xpath=ancestor::*[contains(@class,"seat-row")]')
        .boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width);
    }
  }
});

test("a no-move roll keeps its player colour until the result settles", async ({
  page,
}) => {
  const game = newGame([
    seat("local-you", "Alice", 0),
    seat("bob", "Bob", 1),
    null,
    null,
  ]);
  await page.addInitScript(
    ({ game }) => {
      localStorage.setItem("ludo-local-game-v1", JSON.stringify(game));
      Object.defineProperty(crypto, "getRandomValues", {
        value: (a: Uint32Array) => {
          a.fill(3);
          return a;
        },
      });
    },
    { game },
  );
  await page.goto("/");
  const dice = page.getByRole("button", { name: "Roll dice", exact: true });
  const colour = await dice.evaluate(
    (e) => getComputedStyle(e).backgroundColor,
  );
  await dice.evaluate((element) => {
    const states: { label: string; colour: string; rolling: boolean }[] = [];
    Reflect.set(window, "rollFrames", states);
    const sample = () =>
      states.push({
        label: element.querySelector(".dice")?.getAttribute("aria-label") ?? "",
        colour: getComputedStyle(element).backgroundColor,
        rolling: !!element.querySelector(".rolling"),
      });
    new MutationObserver(sample).observe(element, {
      subtree: true,
      attributes: true,
      childList: true,
    });
    sample();
  });
  await dice.click();
  await expect(dice).toContainText("BOB");
  const frames = await page.evaluate(
    () =>
      Reflect.get(window, "rollFrames") as {
        label: string;
        colour: string;
        rolling: boolean;
      }[],
  );
  const spinning = frames.filter((f) => f.rolling),
    result = frames.filter((f) => f.label === "Dice showing 4");
  expect(spinning.length).toBeGreaterThan(0);
  expect(result.length).toBeGreaterThan(0);
  expect(spinning.every((f) => f.colour === colour)).toBe(true);
  expect(result.every((f) => f.colour === colour)).toBe(true);
  await expect(
    page.getByRole("img", { name: "Dice showing 4", exact: true }),
  ).toHaveCount(0);
});

test("dice responds to the tap while the authoritative result is delayed", async ({
  page,
}) => {
  await page.routeWebSocket("**/socket.io/**", (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (typeof message === "string" && message.includes('"game:roll"'))
        setTimeout(() => server.send(message), 900);
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
    .getByRole("button", { name: /^Create room$/ })
    .last()
    .click();
  await page.getByRole("button", { name: "START GAME", exact: true }).click();
  const button = page.getByRole("button", { name: "Roll dice", exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(
    page.getByRole("img", { name: "Dice rolling", exact: true }),
  ).toBeVisible({ timeout: 250 });
  await expect(button).toBeDisabled();
  await expect(
    page.getByRole("img", { name: "Dice rolling", exact: true }),
  ).toBeVisible();
});

test("safe stars share the exact cell centre at phone and desktop widths", async ({
  page,
}) => {
  const game = newGame([
    seat("local-you", "Alice", 0),
    seat("bob", "Bob", 1),
    null,
    null,
  ]);
  await page.addInitScript(
    (game) => localStorage.setItem("ludo-local-game-v1", JSON.stringify(game)),
    game,
  );
  await page.goto("/");
  for (const width of [320, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const deltas = await page.locator(".board").evaluate((board) => {
      const grid = board.querySelector(".board-grid") as SVGSVGElement,
        matrix = grid.getScreenCTM()!;
      return [...board.querySelectorAll(".safe-star")].map((star, i) => {
        const positions = [
          [2, 6],
          [6, 12],
          [12, 8],
          [8, 2],
        ];
        const [r, c] = positions[i],
          point = new DOMPoint((c + 0.5) * 32, (r + 0.5) * 32).matrixTransform(
            matrix,
          ),
          b = star.getBoundingClientRect();
        return {
          dx: Math.abs(b.x + b.width / 2 - point.x),
          dy: Math.abs(b.y + b.height / 2 - point.y),
        };
      });
    });
    expect(deltas).toHaveLength(4);
    for (const delta of deltas) {
      expect(delta.dx).toBeLessThan(0.5);
      expect(delta.dy).toBeLessThan(0.5);
    }
  }
});

test("disconnect cues stop on reconnect, respect reduced motion, and confirmed quit removes tokens", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "PLAY WITH FRIENDS", exact: true })
    .click();
  await page.getByLabel("Computer players to start").selectOption("1");
  await page
    .getByRole("dialog", { name: "PLAY ONLINE" })
    .getByRole("button", { name: /^Create room$/ })
    .last()
    .click();
  const code = (await page.locator(".invite-strip strong").innerText()).trim();
  const peer = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    let other = await peer.newPage();
    await other.goto("/");
    await other
      .getByRole("button", { name: "PLAY WITH FRIENDS", exact: true })
      .click();
    await other
      .getByRole("button", { name: "Join with code", exact: true })
      .click();
    await other.getByLabel("Six-character room code").fill(code);
    await other
      .getByRole("button", { name: "Join the table", exact: true })
      .click();
    await page.getByRole("button", { name: "START GAME", exact: true }).click();
    await expect(
      other.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeVisible();
    await other.close();
    await expect(page.locator(".disconnected-token")).toHaveCount(4, {
      timeout: 10000,
    });
    expect(
      await page
        .locator(".disconnected-token .round-token")
        .first()
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe("offline-breath");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".disconnected-token .round-token")
        .first()
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe("none");
    other = await peer.newPage();
    await other.goto("/");
    await expect(page.locator(".disconnected-token")).toHaveCount(0);
    await other.getByRole("button", { name: "BACK", exact: true }).click();
    await other.getByRole("button", { name: /^CONFIRM/ }).click();
    await expect(page.locator(".token.yellow")).toHaveCount(0);
  } finally {
    await peer.close();
  }
});
