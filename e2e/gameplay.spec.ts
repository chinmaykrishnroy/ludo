import { test, expect } from "@playwright/test";
import { newGame, seat, roll } from "../shared/game";
const key = "ludo-local-game-v1";

test("a sole legal offline token moves automatically without another tap", async ({
  page,
}) => {
  const initial = newGame([
    seat("local-you", "Alice", 0),
    seat("bob", "Bob", 1),
    null,
    null,
  ]);
  initial.seats[0]!.tokens = [2, 56, 56, 56];
  const game = roll(initial, 3);
  await page.addInitScript(
    ({ key, game }) => localStorage.setItem(key, JSON.stringify(game)),
    { key, game },
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "red token 1, space 5", exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(saved.game?.seats?.[0]?.tokens ?? saved.seats?.[0]?.tokens).toEqual([
    5, 56, 56, 56,
  ]);
});

test("new captures vibrate once, refresh is quiet, and the vibration preference is remembered", async ({
  page,
}) => {
  const initial = newGame([
    seat("local-you", "Alice", 0),
    seat("bob", "Bob", 1),
    null,
    null,
  ]);
  initial.seats[0]!.tokens = [0, 10, -1, -1];
  initial.seats[1]!.tokens = [42, -1, -1, -1];
  const game = roll(initial, 3);
  await page.addInitScript(
    ({ key, game }) => {
      localStorage.setItem(key, JSON.stringify(game));
      Object.defineProperty(navigator, "vibrate", {
        value: (pattern: number[]) => {
          const calls = Reflect.get(window, "capturePulses") ?? [];
          calls.push(pattern);
          Reflect.set(window, "capturePulses", calls);
          return true;
        },
      });
    },
    { key, game },
  );
  await page.goto("/");
  await page
    .getByRole("button", {
      name: /^red token 1, space 0(?:, move available)?$/,
    })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "capturePulses")?.length ?? 0),
    )
    .toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: /^red token 1, space 0(?:, move available)?$/,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => Reflect.get(window, "capturePulses")?.length ?? 0,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
  await page
    .getByRole("switch", { name: "Capture vibration", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Capture vibration", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", {
      name: /^red token 1, space 0(?:, move available)?$/,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "green token 1, in yard", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => Reflect.get(window, "capturePulses")?.length ?? 0,
    ),
  ).toBe(0);
});

test("rapid dice taps send one online action and do not show a misleading turn error", async ({
  page,
}) => {
  let rolls = 0;
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      if (typeof payload === "string" && payload.includes('"game:roll"'))
        rolls++;
    }),
  );
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
  await button.evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
    element.click();
  });
  await expect.poll(() => rolls).toBe(1);
  await page.waitForTimeout(300);
  expect(rolls).toBe(1);
  await expect(
    page.getByText("It is not your turn.", { exact: true }),
  ).toHaveCount(0);
});
