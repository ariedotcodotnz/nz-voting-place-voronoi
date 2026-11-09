import { expect, test } from "@playwright/test";
import { currentYear, findPlace, openAtlas } from "./helpers";

test("loads the Google basemap with the election overlay", async ({ page }) => {
  const errors = await openAtlas(page);
  // deck.gl draws into a canvas attached to the Google map
  await expect.poll(async () => page.locator("canvas").count()).toBeGreaterThan(0);
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Party Vote Atlas" })).toBeVisible();
  await expect(page.getByTestId("legend")).toContainText("Leading party");
  expect(errors).toEqual([]);
});

test("switches election years from the timeline and the URL follows", async ({ page }) => {
  await openAtlas(page, "?y=2023");
  await expect(currentYear(page)).toHaveText("2023");
  await page.locator('[data-year="2014"]').click();
  await expect(currentYear(page)).toHaveText("2014");
  await expect(page).toHaveURL(/y=2014/);
  // Keyboard navigation on the slider
  await page.getByRole("slider", { name: "Election year" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(currentYear(page)).toHaveText("2011");
  await expect(page.getByTestId("legend")).toContainText("2011");
});

test("plays and pauses the historical timeline", async ({ page }) => {
  await openAtlas(page, "?y=2008");
  await page.getByTestId("play").click();
  await expect(currentYear(page)).toHaveText("2011", { timeout: 30_000 });
  await page.getByTestId("play").click();
  const held = await currentYear(page).textContent();
  await page.waitForTimeout(3000);
  await expect(currentYear(page)).toHaveText(held ?? "");
});

test("switches basemap between roadmap and satellite", async ({ page }) => {
  await openAtlas(page);
  await page.getByRole("radio", { name: /Satellite/ }).click();
  await expect(page).toHaveURL(/map=satellite/);
  await page.getByRole("radio", { name: /^Map/ }).click();
  await expect(page).not.toHaveURL(/map=/);
});

test("changes visualisation modes", async ({ page }) => {
  await openAtlas(page, "?y=2023");
  await page.getByTestId("mode-party").click();
  await expect(page.getByTestId("legend")).toContainText("party-vote share");
  await page.getByTestId("mode-circles").click();
  await expect(page.getByTestId("legend")).toContainText("votes");
  await page.getByTestId("mode-bloc").click();
  await expect(page.getByTestId("legend")).toContainText("Strongest bloc");
  await page.getByRole("radio", { name: "TOP included" }).click();
  await expect(page.getByTestId("legend")).toContainText("TOP included");
  await page.getByTestId("mode-compare").click();
  await expect(page.getByTestId("legend")).toContainText("ahead");
  await page.getByTestId("mode-swing").click();
  await expect(page.getByTestId("legend")).toContainText("Change in");
  await expect(page).toHaveURL(/m=swing/);
});

test("selecting a polling place shows results and a history chart", async ({ page }) => {
  await openAtlas(page, "?y=2023");
  const place = await findPlace(page, "School", 2023);
  expect(place).not.toBeNull();
  await page.goto(`/?y=2023&sel=${place!.id}&v=${place!.lat},${place!.lng},14`);
  const panel = page.getByTestId("details-panel");
  await expect(panel).toBeVisible();
  // Venue names can change between elections; the panel shows the selected election's name.
  await expect(panel.getByRole("heading", { level: 2 })).toContainText(place!.name.split(" ")[0]);
  await expect(panel).toContainText("2023 results");
  await expect(panel.getByRole("table").first()).toBeVisible();
  await expect(panel.getByRole("img", { name: /Party vote share at this location/ })).toBeVisible();
  await panel.getByRole("button", { name: "Close details" }).click();
  await expect(panel).toBeHidden();
});

test("clicking the map selects the polling place under the cursor", async ({ page }) => {
  await openAtlas(page, "?y=2023&v=-41.2865,174.7762,13");
  await page.waitForTimeout(2500);
  const box = (await page.locator(".gm-style").first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60);
  await expect(page.getByTestId("hover-tooltip")).toBeVisible();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 60);
  await expect(page.getByTestId("details-panel")).toBeVisible();
  await expect(page).toHaveURL(/sel=/);
});
