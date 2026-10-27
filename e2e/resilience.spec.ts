import { test, expect } from "@playwright/test";

// These tests intercept API/socket responses. An active worker can bypass page
// routing in WebKit; PWA lifecycle/offline behavior has its own enabled suite.
test.use({ serviceWorkers: "block" });

test("load notice pauses new-room and match controls and reopens after recovery", async ({
  page,
}) => {
  let available = false;
  await page.route("**/api/admission", (route) =>
    route.fulfill({
      json: {
        newRoomsAvailable: available,
        retryAfterSeconds: available ? 0 : 5,
      },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "PLAY WITH FRIENDS", exact: true })
    .click();
  const create = page
    .getByRole("dialog", { name: "PLAY ONLINE" })
    .getByRole("button", { name: "Create room", exact: true })
    .last();
  await expect(
    page.getByText("The server is busy keeping existing games smooth.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(create).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Join with code", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Computer players to start").selectOption("1");
  available = true;
  await expect(create).toBeEnabled({ timeout: 8000 });
  await create.click();
  available = false;
  await expect(
    page.getByRole("button", { name: "START GAME", exact: true }),
  ).toBeDisabled({ timeout: 8000 });
  await expect(
    page.getByText("your room and seats are saved.", { exact: false }),
  ).toBeVisible();
  available = true;
  await expect(
    page.getByRole("button", { name: "START GAME", exact: true }),
  ).toBeEnabled({ timeout: 8000 });
});

test("runtime failure notice stays accessible inside dialogs with private diagnostics excluded", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "PLAY WITH FRIENDS", exact: true })
    .click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new ErrorEvent("error", { message: "private-room secret-token" }),
    ),
  );
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "Something went wrong." });
  await expect(notice).toBeVisible();
  const link = notice.getByRole("link", { name: "Report issue" });
  await expect(link).toBeVisible();
  const url = new URL((await link.getAttribute("href"))!);
  expect(url.pathname).toBe("/chinmaykrishnroy/ludo/issues/new");
  expect(url.searchParams.get("body")).toContain("Category: RUNTIME_ERROR");
  expect(url.searchParams.get("body")).not.toMatch(
    /secret-token|private-room|127\.0\.0\.1/,
  );
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await notice.getByRole("button", { name: "Dismiss error report" }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "PLAY ONLINE" })).toBeVisible();
});

test("React crash offers reload and reconnects to the retained game", async ({
  page,
}) => {
  let corruptNext = false,
    injected = false;
  await page.routeWebSocket("**/socket.io/**", (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      if (
        typeof message === "string" &&
        message.startsWith('42["room:state",')
      ) {
        const packet = JSON.parse(message.slice(2));
        if (corruptNext && !injected && packet[1].game) {
          packet[1].game.turn = 9;
          injected = true;
          ws.send("42" + JSON.stringify(packet));
          return;
        }
      }
      ws.send(message);
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
  const code = await page.locator(".invite-strip strong").innerText();
  corruptNext = true;
  await page.getByRole("button", { name: "START GAME", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Something went wrong." }),
  ).toBeVisible();
  const body = new URL(
    (await page
      .getByRole("link", { name: "Report issue" })
      .getAttribute("href"))!,
  ).searchParams.get("body")!;
  expect(body).toContain("Category: UI_RENDER_ERROR");
  expect(body).not.toContain(code);
  await page.getByRole("button", { name: "Reload game", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Roll dice", exact: true }),
  ).toBeVisible();
  expect(injected).toBe(true);
});
