import { expect, type Page } from "@playwright/test";

export async function openAtlas(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/${query}`);
  await expect(page.getByTestId("atlas")).toBeVisible();
  await expect(page.locator(".gm-style").first()).toBeVisible();
  await expect(page.getByTestId("legend")).toBeVisible();
  return errors;
}

/** Find a real polling place from the generated search index. */
export async function findPlace(page: Page, nameIncludes: string, year: number) {
  return page.evaluate(
    async ({ nameIncludes, year }) => {
      const m = await (await fetch("/data/manifest.json")).json();
      const s = await (await fetch(`/data/${m.files.search}`)).json();
      const p = s.places.find((x: [string, string, string, number, number, number[]]) => x[1].includes(nameIncludes) && x[5].includes(year));
      return p ? { id: p[0] as string, name: p[1] as string, lat: p[3] as number, lng: p[4] as number } : null;
    },
    { nameIncludes, year },
  );
}

export const currentYear = (page: Page) => page.getByTestId("current-year");
