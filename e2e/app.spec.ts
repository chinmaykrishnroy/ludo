import { test, expect } from "@playwright/test";
import { newGame, seat } from "../shared/game";
const key = "ludo-local-game-v1";

for (const failure of ["getter", "writes"] as const) {
  test(`storage ${failure} failures leave offline play usable`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((mode) => {
      if (mode === "getter")
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new Error("Denied storage");
          },
        });
      else
        Storage.prototype.setItem = () => {
          throw new Error("Quota exceeded");
        };
    }, failure);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByText(/Browser storage is unavailable/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Dismiss storage notice" }).click();
    await page
      .getByRole("button", { name: "PLAY OFFLINE", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "PLAY OFFLINE" });
    await dialog.getByLabel("Offline game").selectOption("pass");
    await dialog
      .getByRole("button", { name: "PLAY OFFLINE", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Roll dice", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
test("impossible saves are ignored without removing the source", async ({
  page,
}) => {
  const game = {
    ...newGame([
      seat("local-you", "Alice", 0),
      seat("b", "Bob", 1),
      null,
      null,
    ]),
    phase: "move",
    dice: 1,
  };
  await page.addInitScript(
    ({ key, game }) => localStorage.setItem(key, JSON.stringify(game)),
    { key, game },
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).phase,
      key,
    ),
  ).toBe("move");
});
test("legacy tokens and deadline survive refresh and an offline shell restart", async ({
  page,
  context,
}) => {
  const game = newGame([
    seat("local-you", "Alice", 0),
    seat("b", "Bob", 1),
    null,
    null,
  ]);
  game.seats[0]!.tokens = [3, 0, -1, -1];
  game.phase = "move";
  game.dice = 2;
  game.revision = 4;
  await page.goto("/");
  await page.evaluate(
    ({ key, game }) => localStorage.setItem(key, JSON.stringify(game)),
    { key, game },
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Roll dice", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).version,
        key,
      ),
    )
    .toBe(2);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Open the next document under the now-active worker before going offline.
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Roll dice", exact: true }),
  ).toBeVisible();
  const restored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).game,
    key,
  );
  expect(restored.deadline).toBe(game.deadline);
  expect(restored.seats[0].tokens).toEqual([3, 0, -1, -1]);
  await context.setOffline(false);
});
test("voice preference survives menu replacement and refresh; microphone is requested only on use", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(window, "testMicCalls", { get: () => calls });
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          calls++;
          throw new Error("Microphone access denied for test");
        },
      },
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
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page
    .getByRole("button", { name: "Disable automatic voice playback" })
    .click();
  await page.getByRole("button", { name: "KEEP PLAYING", exact: true }).click();
  await page.getByRole("button", { name: "Open game menu" }).click();
  await expect(
    page.getByRole("button", { name: "Enable automatic voice playback" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await page.getByRole("button", { name: "Open game menu" }).click();
  await expect(
    page.getByRole("button", { name: "Enable automatic voice playback" }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => Reflect.get(window, "testMicCalls"))).toBe(
    0,
  );
  const mic = page.getByRole("button", {
    name: "Hold to record a voice message",
  });
  await mic.click();
  await expect(
    page.getByText("Microphone access denied for test"),
  ).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "testMicCalls"))).toBe(
    1,
  );
});
test("missing hashed assets return 404 instead of the application HTML", async ({
  request,
}) => {
  const response = await request.get("/assets/removed-build-chunk.js");
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain('<div id="root">');
});

test("real codec audio sends on release, replays, and Escape cancels the next recording", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let audioContext: AudioContext | undefined;
    const prime = () => {
      audioContext ??= new AudioContext();
      void audioContext.resume();
    };
    window.addEventListener("pointerdown", prime, { capture: true });
    window.addEventListener("keydown", prime, { capture: true });
    const query = navigator.permissions?.query.bind(navigator.permissions);
    if (navigator.permissions)
      navigator.permissions.query = async (descriptor) =>
        descriptor.name === "microphone"
          ? ({ state: "granted" } as PermissionStatus)
          : query!(descriptor);
    // A real browser encoder records a generated stream, never the host mic.
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          const context = audioContext ?? new AudioContext();
          const destination = context.createMediaStreamDestination(),
            oscillator = context.createOscillator();
          oscillator.frequency.value = 220;
          oscillator.connect(destination);
          oscillator.start();
          return destination.stream;
        },
      },
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
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page
    .getByRole("button", { name: "Disable automatic voice playback" })
    .click();
  const mic = page.getByRole("button", {
    name: "Hold to record a voice message",
  });
  const box = await mic.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect(page.locator(".record-button")).toHaveClass(/is-recording/);
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(
    page.getByText("Voice message sent to the table."),
  ).toBeVisible();
  await expect(page.locator(".voice-message")).toHaveCount(1);
  await page.getByRole("button", { name: /^Play voice message from/ }).click();
  await expect(
    page.getByRole("button", { name: /^Pause voice message from/ }),
  ).toBeVisible();
  const nextBox = await mic.boundingBox();
  expect(nextBox).not.toBeNull();
  await page.mouse.move(
    nextBox!.x + nextBox!.width / 2,
    nextBox!.y + nextBox!.height / 2,
  );
  await page.mouse.down();
  await expect(page.locator(".record-button")).toHaveClass(/is-recording/);
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".record-button")).not.toHaveClass(/is-recording/);
  await expect(page.locator(".voice-message")).toHaveCount(1);
});
