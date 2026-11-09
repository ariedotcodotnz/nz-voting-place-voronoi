import { expect, test } from "@playwright/test";
import { currentYear, openAtlas } from "./helpers";

test("works on a phone-sized screen", async ({ page }) => {
  await openAtlas(page, "?y=2020");
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(currentYear(page)).toHaveText("2020");
  await page.getByRole("button", { name: "Map options" }).click();
  const sheet = page.getByRole("dialog", { name: "Map options" });
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("mode-party").click();
  await expect(page.getByTestId("legend")).toContainText("share");
  // Nothing overflows the viewport horizontally
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
