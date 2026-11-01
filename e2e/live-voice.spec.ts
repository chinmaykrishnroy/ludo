import { test, expect, type Page } from "@playwright/test";

async function microphone(page: Page) {
  await page.addInitScript(() => {
    const NativeSocket = WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(url, location.href).pathname === "/live-voice")
          Reflect.set(window, "testLiveSocket", this);
      }
    };
    let context: AudioContext | undefined;
    let calls = 0,
      played = 0,
      energy = 0;
    Object.defineProperty(window, "liveTest", {
      get: () => ({ calls, played, energy }),
    });
    if (typeof AudioContext !== "undefined") {
      context = new AudioContext();
      // Windows WebKit can expose the node through its factory without a global constructor.
      const sourcePrototype = Object.getPrototypeOf(
        context.createBufferSource(),
      ) as AudioBufferSourceNode;
      const start = sourcePrototype.start;
      sourcePrototype.start = function (...args: Parameters<typeof start>) {
        if (this.buffer?.length && this.buffer.sampleRate === 48000) {
          played++;
          for (const value of this.buffer.getChannelData(0))
            energy += value * value;
        }
        return start.apply(this, args);
      };
    }
    const prime = () => {
      if (typeof AudioContext === "undefined") return;
      context ??= new AudioContext();
      void context.resume();
    };
    window.addEventListener("pointerdown", prime, { capture: true });
    const query = navigator.permissions?.query.bind(navigator.permissions);
    if (query)
      navigator.permissions.query = async (descriptor) =>
        descriptor.name === "microphone"
          ? ({ state: "granted" } as PermissionStatus)
          : query(descriptor);
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          calls++;
          if (typeof AudioContext === "undefined")
            throw Error("Synthetic audio is unavailable in this browser build");
          context ??= new AudioContext();
          void context.resume();
          const output = context.createMediaStreamDestination();
          const oscillator = context.createOscillator();
          oscillator.frequency.value = 440;
          const gain = context.createGain();
          gain.gain.value = 0.1;
          oscillator.connect(gain).connect(output);
          oscillator.start();
          return output.stream;
        },
      },
    });
  });
}
async function hold(page: Page, milliseconds: number) {
  await page.bringToFront();
  const mic = page.getByRole("button", { name: /Hold to (speak live|record)/ });
  await expect(mic).toHaveAttribute("aria-disabled", "false");
  await mic.scrollIntoViewIfNeeded();
  await mic.focus();
  const box = await mic.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect(page.locator(".record-button")).toHaveClass(/is-recording/);
  await page.waitForTimeout(milliseconds);
  await page.mouse.up();
  await expect(page.locator(".record-button")).not.toHaveClass(/is-recording/);
  await expect(mic).toHaveAttribute("aria-disabled", "false");
}
async function table(a: Page, b: Page) {
  await microphone(a);
  await microphone(b);
  await a.bringToFront();
  await a.goto("/");
  await a
    .getByRole("button", { name: "PLAY WITH FRIENDS", exact: true })
    .click();
  await a.getByLabel("Your name", { exact: true }).fill("Alice");
  await a.getByLabel("Computer players to start").selectOption("0");
  await a
    .getByRole("dialog", { name: "PLAY ONLINE" })
    .getByRole("button", { name: /^Create room$/ })
    .last()
    .click();
  const code = await a.locator(".invite-strip strong").innerText();
  await b.bringToFront();
  await b.goto(`${new URL(a.url()).origin}/?room=${code}`);
  await b.getByLabel("Your name", { exact: true }).fill("Bob");
  await b.getByRole("button", { name: /^Join the table/ }).click();
  await expect(b.locator(".invite-strip strong")).toHaveText(code);
  await a.bringToFront();
  await a.getByRole("button", { name: "START GAME", exact: true }).click();
  await expect(
    b.getByRole("button", { name: "Roll dice", exact: true }),
  ).toBeVisible();
  // These are real user gestures that unlock playback; microphone access remains untouched.
  for (const page of [a, b]) {
    await page.bringToFront();
    await page
      .getByRole("button", { name: "Mute speakers", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Unmute speakers", exact: true })
      .click();
  }
}

test("live push-to-talk plays decoded Opus before release; recorded fallback still sends when live is unavailable", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const context = await browser.newContext();
  const peer = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  peer.on("pageerror", (error) => errors.push(error.message));
  try {
    await table(page, peer);
    const supported = await page.evaluate(
      async () =>
        typeof AudioEncoder !== "undefined" &&
        typeof AudioDecoder !== "undefined" &&
        typeof AudioContext !== "undefined" &&
        typeof AudioWorkletNode !== "undefined" &&
        !!(
          await AudioEncoder.isConfigSupported({
            codec: "opus",
            sampleRate: 48000,
            numberOfChannels: 1,
            bitrate: 24000,
          })
        ).supported,
    );
    await page.waitForTimeout(500);
    expect(
      await peer.evaluate(() => Reflect.get(window, "liveTest").calls),
    ).toBe(0);
    if (supported) {
      // Typing must not spend audio-control quotas on identical unlock/listen updates.
      await peer.bringToFront();
      await peer
        .getByRole("button", { name: "Open room chat", exact: true })
        .click();
      await peer
        .getByRole("textbox", { name: "Message to room" })
        .pressSequentially("abcdefghij".repeat(12));
      await peer
        .getByRole("button", { name: "Close room chat", exact: true })
        .click();
      expect(
        await peer.evaluate(
          () => (Reflect.get(window, "testLiveSocket") as WebSocket).readyState,
        ),
      ).toBe(1);
      await page.bringToFront();
      const mic = page.getByRole("button", { name: /Hold to speak live/ });
      await expect(mic).toHaveAttribute("aria-disabled", "false");
      await mic.scrollIntoViewIfNeeded();
      await mic.focus();
      const box = await mic.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await expect(mic).toContainText("LIVE");
      await expect(peer.locator(".record-button")).toContainText(
        "Alice is speaking",
      );
      // The sound must have been decoded/scheduled while the sender still holds the button.
      await expect
        .poll(() => peer.evaluate(() => Reflect.get(window, "liveTest").played))
        .toBeGreaterThan(5);
      expect(
        await peer.evaluate(() => Reflect.get(window, "liveTest").energy),
      ).toBeGreaterThan(0.01);
      await page.mouse.up();
      await expect(page.locator(".record-button")).not.toHaveClass(
        /is-recording/,
      );
      await expect(mic).toHaveAttribute("aria-disabled", "false");
      await page.waitForTimeout(400);
      await expect(page.locator(".voice-message")).toHaveCount(0);
      await expect(peer.locator(".voice-message")).toHaveCount(0);
      // Existing mute has the same meaning for live audio and voice notes.
      await peer.bringToFront();
      await peer
        .getByRole("button", { name: "Mute speakers", exact: true })
        .click();
      const before = await peer.evaluate(
        () => Reflect.get(window, "liveTest").played,
      );
      await hold(page, 350);
      await expect(peer.locator(".muted-voice-toast")).toContainText("Alice");
      expect(
        await peer.evaluate(() => Reflect.get(window, "liveTest").played),
      ).toBe(before);
      await page.waitForTimeout(250);
      // A failed live transport keeps the full note while the game socket remains connected.
      await peer.bringToFront();
      await peer
        .getByRole("button", { name: "Unmute speakers", exact: true })
        .click();
      await page.bringToFront();
      await expect(mic).toHaveAttribute("aria-disabled", "false");
      await mic.scrollIntoViewIfNeeded();
      await mic.focus();
      const nextBox = await mic.boundingBox();
      await page.mouse.move(
        nextBox!.x + nextBox!.width / 2,
        nextBox!.y + nextBox!.height / 2,
      );
      await page.mouse.down();
      await expect(mic).toContainText("LIVE");
      await page.waitForTimeout(250);
      await peer.bringToFront();
      await peer.evaluate(() =>
        (Reflect.get(window, "testLiveSocket") as WebSocket).close(),
      );
      await page.bringToFront();
      await expect(mic).toContainText("Recording");
      await page.waitForTimeout(250);
      await page.mouse.up();
      await expect(
        page.getByText("Voice message sent to the table."),
      ).toBeVisible();
      await expect(mic).toHaveAttribute("aria-disabled", "false");
    } else {
      test.info().annotations.push({
        type: "capability",
        description:
          "Browser lacks native Opus WebCodecs; recording fallback is required and tested.",
      });
    }
    // The saved preference explicitly selects the existing recording path.
    await page.getByRole("button", { name: "Open game menu" }).click();
    await page
      .getByRole("button", { name: "Use voice notes", exact: true })
      .click();
    if (
      await page.evaluate(
        () =>
          typeof MediaRecorder !== "undefined" &&
          typeof AudioContext !== "undefined",
      )
    ) {
      await hold(page, 450);
      await expect(
        page.getByText("Voice message sent to the table."),
      ).toBeVisible();
      await expect(page.locator(".voice-message")).toHaveCount(
        supported ? 2 : 1,
      );
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
