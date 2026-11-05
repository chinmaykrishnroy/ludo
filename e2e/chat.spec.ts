import { test, expect, request, type Page } from "@playwright/test";
import { io } from "socket.io-client";
import type { Reply, Typing } from "../shared/protocol";
const gif = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

async function roomWithPeer(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "PLAY WITH FRIENDS", exact: true })
    .click();
  await page.getByLabel("Your name", { exact: true }).fill("Alice");
  await page.getByLabel("Computer players to start").selectOption("0");
  await page
    .getByRole("dialog", { name: "PLAY ONLINE" })
    .getByRole("button", { name: /^Create room$/ })
    .last()
    .click();
  const code = await page.locator(".invite-strip strong").innerText();
  const origin = new URL(page.url()).origin;
  const api = await request.newContext({ baseURL: origin });
  const session = await api.get("/api/session"),
    cookie = session.headers()["set-cookie"].split(";")[0];
  const socket = io(origin, {
    autoConnect: false,
    transports: ["websocket"],
    extraHeaders: { Cookie: cookie },
    reconnection: false,
  });
  socket.connect();
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const send = (event: string, data: unknown) =>
    socket.timeout(5000).emitWithAck(event, data) as Promise<Reply>;
  expect((await send("room:join", { code, playerName: "Bob" })).ok).toBe(true);
  await page.getByRole("button", { name: "START GAME", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Roll dice", exact: true }),
  ).toBeVisible();
  return {
    send,
    socket,
    close: async () => {
      socket.disconnect();
      await api.dispose();
    },
  };
}

test("a reaction style can be selected by dragging and starts at the rotated home", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const peer = await roomWithPeer(page);
  try {
    const angry = page.getByRole("button", {
      name: "React: Angry",
      exact: true,
    });
    const box = (await angry.boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 15);
    const option = page.getByRole("button", { name: "Ripple", exact: true });
    await expect(option).toBeVisible();
    const choice = (await option.boundingBox())!;
    await page.mouse.move(
      choice.x + choice.width / 2,
      choice.y + choice.height / 2,
    );
    await page.mouse.up();
    const effect = page.locator(
      '.table-reaction[data-reaction-style="ripple"]',
    );
    await expect(effect).toBeVisible();
    await expect(effect.locator(".reaction-animation")).toHaveCSS(
      "--origin-y",
      "80%",
    );
    await expect(effect.locator(".reaction-animation")).toHaveCSS(
      "--origin-x",
      "20%",
    );
    await expect(angry).toBeDisabled();
    await expect(angry.locator(".reaction-button-time")).toHaveText(/^[1-4]s$/);
    await expect(page.locator(".reaction-button-time")).toHaveCount(1);
    await expect(angry).toBeEnabled();
    await angry.focus();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("button", { name: "Pop", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(angry).toBeFocused();
    await angry.click({ button: "right" });
    await expect(
      page.getByRole("button", { name: "Float", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await angry.hover();
    await page.mouse.down();
    const burst = page.getByRole("button", { name: "Burst", exact: true });
    await expect(burst).toBeVisible();
    await page.mouse.up();
    await burst.click();
    await expect(
      page.locator('.table-reaction[data-reaction-style="burst"]'),
    ).toBeVisible();
  } finally {
    await peer.close();
  }
});

test("incoming text and GIF previews stack above the mobile board and expire independently", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const peer = await roomWithPeer(page);
  try {
    const longWord = "long".repeat(38);
    expect((await peer.send("chat:send", { text: longWord })).ok).toBe(true);
    const preview = page.locator(".play-board .chat-preview");
    await expect(preview.first()).toHaveText(`Bob: ${longWord}`);
    const box = (await preview.first().boundingBox())!;
    expect(box.width).toBeLessThan(375);
    expect(box.height).toBeGreaterThan(40);
    await page.waitForTimeout(1200);
    expect((await peer.send("chat:send", { text: "", gif })).ok).toBe(true);
    await expect(preview).toHaveCount(2);
    await expect(preview.last()).toHaveText("Bob: sent a GIF");
    await expect(preview).toHaveCount(1, { timeout: 4000 });
    await expect(preview.first()).toHaveText("Bob: sent a GIF");
    await expect(preview).toHaveCount(0, { timeout: 4000 });
  } finally {
    await peer.close();
  }
});

test("chat composer fits above a keyboard that only shrinks the visual viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.addInitScript(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, "height", {
      configurable: true,
      get: () => Number(document.documentElement.dataset.keyboardHeight ?? 820),
    });
    Object.defineProperty(viewport, "offsetTop", {
      configurable: true,
      get: () => 0,
    });
    Object.defineProperty(viewport, "scale", {
      configurable: true,
      get: () => 1,
    });
  });
  const peer = await roomWithPeer(page);
  try {
    await page
      .getByRole("button", { name: "Open room chat", exact: true })
      .click();
    const composer = page.getByRole("textbox", { name: "Message to room" });
    await composer.fill("Keyboard test");
    await page.evaluate(() => {
      document.documentElement.dataset.keyboardHeight = "480";
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect
      .poll(async () => {
        const rect = (await composer.boundingBox())!;
        return rect.y + rect.height;
      })
      .toBeLessThan(480);
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("Keyboard test");
  } finally {
    await peer.close();
  }
});

test("a played clip lights the sender's home and dice and mic take equal space", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  // Exercise the playback UI without relying on the runner's audio codecs.
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      set() {},
    });
    HTMLMediaElement.prototype.play = async () => {};
    HTMLMediaElement.prototype.pause = () => {};
  });
  const peer = await roomWithPeer(page);
  try {
    const roll = page.getByRole("button", { name: "Roll dice", exact: true });
    const mic = page.getByRole("button", {
      name: "Hold to record a voice message",
      exact: true,
    });
    const [diceBox, micBox] = await Promise.all([
      roll.boundingBox(),
      mic.boundingBox(),
    ]);
    expect(Math.abs(diceBox!.width - micBox!.width)).toBeLessThan(1);
    expect(diceBox!.height).toBe(micBox!.height);
    expect(
      (
        await peer.send("voice:send", {
          audio: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(20).fill(0)]),
          mime: "audio/webm",
          duration: 1,
        })
      ).ok,
    ).toBe(true);
    const home = page.locator('[data-speaking-colour="green"]');
    await expect(home).toBeVisible();
    await page
      .getByRole("button", { name: "Mute speakers", exact: true })
      .click();
    await expect(home).toHaveCount(0);
  } finally {
    await peer.close();
  }
});

test("chat has unread counts, typing, coloured mentions, emoji, GIFs and navigable replies", async ({
  page,
}) => {
  test.setTimeout(60000);
  const peer = await roomWithPeer(page);
  try {
    for (let i = 0; i < 10; i++)
      expect((await peer.send("chat:send", { text: `Hello ${i}` })).ok).toBe(
        true,
      );
    const launch = page.getByRole("button", {
      name: "Open room chat, 10 unread messages",
      exact: true,
    });
    await expect(launch).toBeVisible();
    await expect(launch.locator(".chat-badge")).toHaveText("9+");
    await launch.click();
    const dialog = page.getByRole("dialog", {
        name: "TABLE CHAT",
        exact: true,
      }),
      input = dialog.getByRole("textbox", { name: "Message to room" });
    const typing: Typing[] = [];
    peer.socket.on("chat:typing", (v) => typing.push(v));
    await input.fill("@B");
    await expect(
      dialog.getByRole("option", { name: "Bob", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => typing.some((v) => v.name === "Alice" && v.active))
      .toBe(true);
    await dialog.getByRole("option", { name: "Bob", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(dialog.locator(".chat-mention")).toHaveText("@Bob");
    await expect(dialog.locator(".chat-mention")).toHaveCSS(
      "color",
      "rgb(38, 150, 106)",
    );
    expect((await peer.send("chat:typing", { active: true })).ok).toBe(true);
    await expect(dialog.getByRole("status")).toContainText("Bob is typing");
    expect((await peer.send("chat:typing", { active: false })).ok).toBe(true);
    await expect(dialog.getByRole("status")).toBeEmpty();
    await input.fill("👨‍👩‍👧‍👦 🎲");
    await input.press("Enter");
    await expect(dialog.locator(".emoji-only .chat-text")).toHaveText("👨‍👩‍👧‍👦 🎲");
    await dialog
      .getByRole("button", { name: "Reply to Bob", exact: true })
      .first()
      .click();
    await input.fill("Quoted reply");
    await input.press("Enter");
    await dialog
      .getByRole("button", {
        name: "Go to original message from Bob",
        exact: true,
      })
      .click();
    await expect(dialog.locator(".chat-highlight .chat-text")).toHaveText(
      "Hello 0",
    );
    await dialog
      .getByLabel("Choose photo or GIF", { exact: true })
      .setInputFiles({ name: "test.gif", mimeType: "image/gif", buffer: gif });
    await expect(dialog.getByAltText("GIF ready to send")).toBeVisible();
    await expect
      .poll(() =>
        dialog
          .getByAltText("GIF ready to send")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(1);
    await dialog
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const image = dialog.getByAltText("GIF shared by Alice");
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth === 1,
        ),
      )
      .toBe(true);
    const photoSource = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 2400;
      canvas.height = 1600;
      const context = canvas.getContext("2d")!;
      for (let x = 0; x < 2400; x += 10)
        for (let y = 0; y < 1600; y += 10) {
          context.fillStyle = `rgb(${(x * 19 + y) % 255},${(y * 7 + x) % 255},${(x * 13 + y * 3) % 255})`;
          context.fillRect(x, y, 10, 10);
        }
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await dialog
      .getByLabel("Choose photo or GIF", { exact: true })
      .setInputFiles({
        name: "large-photo.png",
        mimeType: "image/png",
        buffer: Buffer.from(photoSource, "base64"),
      });
    await expect(dialog.getByAltText("Photo ready to send")).toBeVisible();
    await dialog
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const photo = dialog.getByAltText("Photo shared by Alice");
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate((img: HTMLImageElement) => ({
          width: img.naturalWidth,
          height: img.naturalHeight,
        })),
      )
      .toEqual({ width: 1080, height: 720 });
    const uploaded = await page.request.get((await photo.getAttribute("src"))!);
    expect(uploaded.headers()["content-type"]).toContain("image/jpeg");
    expect((await uploaded.body()).length).toBeLessThanOrEqual(1024 * 1024);
    await dialog
      .getByRole("button", { name: "Add attachment", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Photo or GIF", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByLabel("Take photo with camera", { exact: true }),
    ).toHaveAttribute("capture", "environment");
    await dialog
      .getByRole("button", { name: "Add attachment", exact: true })
      .click();
    const scroll = await dialog.locator(".chat-feed").evaluate((el) => ({
      end: el.scrollTop + el.clientHeight,
      height: el.scrollHeight,
    }));
    expect(scroll.height - scroll.end).toBeLessThan(4);
    await dialog.getByRole("button", { name: "Close room chat" }).click();
    await expect(
      page.getByRole("button", { name: "Open room chat", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Mute speakers", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Unmute speakers", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Unmute speakers", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open room chat", exact: true })
      .click();
    await expect(page.getByText("Quoted reply", { exact: true })).toBeVisible();
  } finally {
    await peer.close();
  }
});

test("chat idle close resets on input, preserves the draft, and text swipes copy without creating a reply", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), chatIdleSeconds: 2 },
    });
  });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          Reflect.set(window, "copiedChatText", text);
        },
      },
    }),
  );
  const peer = await roomWithPeer(page);
  try {
    await peer.send("chat:send", { text: "Swipe this message" });
    await page.getByRole("button", { name: /^Open room chat/ }).click();
    const dialog = page.getByRole("dialog", {
        name: "TABLE CHAT",
        exact: true,
      }),
      input = dialog.getByRole("textbox", { name: "Message to room" });
    const text = dialog.locator(".chat-text").first();
    await text.scrollIntoViewIfNeeded();
    const box = (await text.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 65, box.y + 8, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "copiedChatText")))
      .toBe("Swipe this message");
    await expect(dialog.getByLabel("Cancel reply")).toHaveCount(0);
    const bubble = dialog.locator(".chat-bubble").first(),
      b = (await bubble.boundingBox())!;
    await page.mouse.move(b.x + 5, b.y + 4);
    await page.mouse.down();
    await page.mouse.move(b.x + 68, b.y + 4, { steps: 8 });
    await page.mouse.up();
    await expect(dialog.getByLabel("Cancel reply")).toBeVisible();
    await dialog.getByLabel("Cancel reply").click();
    await input.fill("Saved draft");
    await page.waitForTimeout(1200);
    await input.press("End");
    await input.press("!");
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /^Open room chat/ }).click();
    await expect(input).toHaveValue("Saved draft!");
  } finally {
    await peer.close();
  }
});

test("blocked audio has a visible tap action and speaker mute stops manual and automatic playback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let allowed = false;
    document.addEventListener(
      "click",
      () => {
        allowed = true;
      },
      { capture: true },
    );
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.src.includes("/api/voice/")) return Promise.resolve();
      if (!Reflect.get(window, "voiceAttempted")) {
        Reflect.set(window, "voiceAttempted", true);
        allowed = false;
      }
      if (!allowed)
        return Promise.reject(
          new DOMException("Tap required", "NotAllowedError"),
        );
      Reflect.set(window, "voicePlayed", this.src);
      return Promise.resolve();
    };
    Reflect.set(window, "originalMediaPlay", original);
  });
  const peer = await roomWithPeer(page);
  try {
    expect(
      (
        await peer.send("voice:send", {
          audio: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(60).fill(0)]),
          mime: "audio/webm",
          duration: 1,
        })
      ).ok,
    ).toBe(true);
    const prompt = page.getByRole("button", {
      name: "Play voice messages",
      exact: true,
    });
    await expect(prompt).toBeVisible();
    await prompt.click();
    await expect(prompt).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "voicePlayed")))
      .toContain("/api/voice/");
    await page
      .getByRole("button", { name: "Mute speakers", exact: true })
      .click();
    await page.getByRole("button", { name: /^Open room chat/ }).click();
    await expect(
      page.getByRole("button", {
        name: "Play voice message from Bob",
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      (
        await peer.send("voice:send", {
          audio: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(60).fill(0)]),
          mime: "audio/webm",
          duration: 1,
        })
      ).ok,
    ).toBe(true);
    const notice = page.locator(".muted-voice-toast");
    await expect(notice).toContainText("Bob spoke");
    await notice
      .getByRole("button", { name: "Unmute to listen", exact: true })
      .click();
    await expect(notice).toHaveCount(0);
    await page.getByRole("button", { name: "Close room chat" }).click();
    await expect(
      page.getByRole("button", { name: "Mute speakers", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  } finally {
    await peer.close();
  }
});
