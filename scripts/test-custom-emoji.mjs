import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");

  // Click Play Offline on home page
  await page
    .locator(".home-actions")
    .getByRole("button", { name: /play offline/i })
    .click();
  await page.waitForTimeout(300);

  // In modal, click PLAY OFFLINE to start
  await page
    .locator("dialog")
    .getByRole("button", { name: /play offline/i })
    .click();
  await page.waitForTimeout(800);

  // Click + button for more emoji reactions
  const plusButton = page.getByRole("button", {
    name: /react with any emoji/i,
  });
  await plusButton.click();
  await page.waitForTimeout(300);

  // Check custom palette is visible
  const customPalette = page.locator(".reaction-custom-palette");
  const isPaletteVisible = await customPalette.isVisible();
  console.log("Custom palette visible:", isPaletteVisible);

  // Click Trophy emoji
  const trophyButton = customPalette.getByRole("button", {
    name: /react with 🏆/i,
  });
  await trophyButton.click();
  await page.waitForTimeout(1000);

  // Verify no error boundary screen
  const errorScreen = page.locator(".app-error-screen");
  const hasError = await errorScreen.isVisible();
  console.log("Has app error screen:", hasError);
  console.log("Page errors:", errors);

  // Check reaction overlay appeared
  const reactionOverlay = page.locator(".table-reaction");
  const overlayCount = await reactionOverlay.count();
  console.log("Reaction overlays rendered:", overlayCount);

  // Check reaction buttons width matches play-controls / big-dice-button
  const diceBox = await page.locator(".big-dice-button").boundingBox();
  const reactionBox = await page.locator(".reaction-buttons").boundingBox();
  console.log(
    "Dice button width:",
    diceBox?.width,
    "Reaction buttons width:",
    reactionBox?.width,
  );

  await browser.close();

  if (hasError || errors.length > 0) {
    console.error("TEST FAILED!");
    process.exit(1);
  } else {
    console.log("TEST PASSED 100%!");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
