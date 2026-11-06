import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "dark",
  });
  await context.addInitScript(() => {
    localStorage.setItem("ludo-appearance", "dark");
  });
  const page = await context.newPage();
  await page.goto("http://localhost:3000/");
  await page.waitForTimeout(300);

  // Play Offline
  await page
    .locator(".home-actions")
    .getByRole("button", { name: /play offline/i })
    .click();
  await page.waitForTimeout(300);
  await page
    .locator("dialog")
    .getByRole("button", { name: /play offline/i })
    .click();
  await page.waitForTimeout(600);

  // Capture Your Turn (Red card)
  await page.screenshot({ path: "output/pro-studio/turn-red-mobile.png" });

  // Roll dice to advance turn (or wait for bot turns)
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();

  // Wait a little and screenshot next bot's turn (e.g. Milo or Sunny or other)
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1500);
    const text = await page.locator(".dice-turn").textContent();
    console.log(`Current turn [${i}]:`, text);
    await page.screenshot({
      path: `output/pro-studio/turn-step-${i}-mobile.png`,
    });
  }

  await browser.close();
  console.log("Screenshots saved.");
}

main().catch(console.error);
