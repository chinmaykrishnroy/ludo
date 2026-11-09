import { chromium } from "playwright";
import fs from "fs";

fs.mkdirSync("output/pro-studio", { recursive: true });

async function main() {
  const browser = await chromium.launch();

  for (const theme of ["light", "dark"]) {
    // 1. Desktop Game Stage
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: theme,
    });
    await context.addInitScript((t) => {
      localStorage.setItem("ludo-appearance", t);
    }, theme);
    const page = await context.newPage();
    await page.goto("http://localhost:3000/");
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `output/pro-studio/01-home-${theme}-desktop.png`,
    });

    // Open Play Offline modal
    await page.getByRole("button", { name: "PLAY OFFLINE" }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `output/pro-studio/02-modal-${theme}-desktop.png`,
    });

    // Click start offline game inside dialog
    const dialog = page.getByRole("dialog", { name: "PLAY OFFLINE" });
    await dialog.getByRole("button", { name: "PLAY OFFLINE" }).click();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `output/pro-studio/03-board-${theme}-desktop.png`,
    });

    // Check scroll height vs inner height
    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    );
    console.log(`[${theme}-desktop] Has vertical scroll:`, hasScroll);

    // 2. Mobile Game Stage
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: theme,
    });
    await mobileContext.addInitScript((t) => {
      localStorage.setItem("ludo-appearance", t);
    }, theme);
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto("http://localhost:3000/");
    await mobilePage.waitForTimeout(400);
    await mobilePage.screenshot({
      path: `output/pro-studio/04-home-${theme}-mobile.png`,
    });

    await mobilePage
      .getByRole("button", { name: "PLAY OFFLINE" })
      .first()
      .click();
    await mobilePage.waitForTimeout(400);
    const mobileDialog = mobilePage.getByRole("dialog", {
      name: "PLAY OFFLINE",
    });
    await mobileDialog.getByRole("button", { name: "PLAY OFFLINE" }).click();
    await mobilePage.waitForTimeout(600);
    await mobilePage.screenshot({
      path: `output/pro-studio/05-board-${theme}-mobile.png`,
    });

    const mobileHasScroll = await mobilePage.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    );
    console.log(`[${theme}-mobile] Has vertical scroll:`, mobileHasScroll);

    // Open soundboard
    const soundsButton = mobilePage.getByRole("button", { name: /Sounds/ });
    if ((await soundsButton.count()) > 0) {
      await soundsButton.click();
      await mobilePage.waitForTimeout(300);
      await mobilePage.screenshot({
        path: `output/pro-studio/06-soundboard-${theme}-mobile.png`,
      });
    }

    await context.close();
    await mobileContext.close();
  }

  await browser.close();
  console.log("Screenshots captured successfully in output/pro-studio/");
}

main().catch(console.error);
