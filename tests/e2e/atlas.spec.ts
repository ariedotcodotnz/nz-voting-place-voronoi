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
  await expect(panel).toContainText("2023 party vote");
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

test("compares electorate (candidate) votes with party votes", async ({ page }) => {
  await openAtlas(page, "?y=2023");
  await page.getByRole("radio", { name: "Electorate vote" }).click();
  await expect(page.getByTestId("legend")).toContainText("electorate vote");
  await expect(page).toHaveURL(/vk=c/);
  await page.getByTestId("mode-split").click();
  await expect(page.getByTestId("legend")).toContainText("candidate vs party");
  // The 2026 workbooks carry no candidate affiliations; they come from the
  // Electoral Commission's candidate list (data/2026/candidate-parties.csv).
  await page.locator('[data-year="2026"]').click();
  await expect(page.getByTestId("legend")).toContainText("candidate vs party vote, 2026");
  await expect(page.getByTestId("no-data-notice")).toHaveCount(0);
});

test("explains a map with no data instead of leaving it grey", async ({ page }) => {
  // Advance votes were not reported by voting place before 2017.
  await openAtlas(page, "?y=2014&vt=advance");
  await expect(page.getByTestId("no-data-notice")).toContainText("Advance votes were not reported by voting place in 2014");
});

test("video page renders deterministic frames", async ({ page }) => {
  // The test server is a plain static server: request the exported HTML file directly.
  await page.goto("/video.html?area=wellington");
  await page.waitForFunction(() => window.__video !== undefined);
  const info = await page.evaluate(() => window.__video!.ready);
  expect(info.frames).toBeGreaterThan(300);
  expect(info.keys).toHaveLength(info.frames);
  // Asking for the frame already on screen must still draw and resolve.
  await page.evaluate(() => window.__video!.render(0));
  await page.evaluate(() => window.__video!.render(40));
  await expect(page.getByTestId("video-year")).toHaveText("2008");
  await page.evaluate((n) => window.__video!.render(n), info.frames - 1);
  await expect(page.getByTestId("video-year")).toHaveText("2026");
});

test("recovers when an election's data fails to load once", async ({ page }) => {
  let failed = false;
  await page.route("**/data/results/2026.*.json", (route) => {
    if (failed) return route.continue();
    failed = true;
    return route.abort("failed");
  });
  await page.goto("/");
  await expect(page.getByText("Some map data couldn’t be loaded. Retrying…")).toBeVisible();
  // The map requested this file once; the cache retries it without another request.
  await expect(page.getByTestId("legend")).toContainText("2026");
  await expect(page.getByText("Some map data couldn’t be loaded. Retrying…")).toHaveCount(0);
});
