import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
for (const theme of ["light", "dark"] as const) {
  test(`${theme} homepage, lobby, board and dialogs pass WCAG checks`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    const scan = async () => {
      const r = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        r.violations.map((v) => ({
          id: v.id,
          description: v.description,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      ).toEqual([]);
    };
    await scan();
    const settings = page.getByRole("button", {
      name: "Settings",
      exact: true,
    });
    await settings.click();
    await scan();
    const dialog = page.getByRole("dialog", { name: "SETTINGS", exact: true });
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((d) => d.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();
    await page
      .getByRole("button", { name: "PLAY WITH FRIENDS", exact: true })
      .click();
    await page.getByLabel("Computer players to start").selectOption("1");
    await page
      .getByRole("dialog", { name: "PLAY ONLINE" })
      .getByRole("button", { name: /^Create room$/ })
      .last()
      .click();
    await scan();
    await page.getByRole("button", { name: "START GAME", exact: true }).click();
    await scan();
    await page
      .getByRole("button", { name: "Open room chat", exact: true })
      .click();
    await scan();
  });
}
