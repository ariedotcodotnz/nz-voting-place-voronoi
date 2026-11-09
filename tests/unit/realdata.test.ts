/**
 * Sanity checks against the real generated datasets in public/data (skipped
 * if the pipeline has not been run). These exercise the same selectors the
 * app uses on every election.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildYearData, leader, siteRow } from "@/lib/atlas/stats";
import type { Manifest, ResultsFile } from "@/lib/atlas/types";

const dir = path.resolve(__dirname, "../../public/data");
const has = fs.existsSync(path.join(dir, "manifest.json"));
const read = <T,>(rel: string): T => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8")) as T;

describe.skipIf(!has)("generated election data", () => {
  const manifest = has ? read<Manifest>("manifest.json") : (null as unknown as Manifest);

  it("lists elections in chronological order without gaps in metadata", () => {
    const years = manifest.elections.map((e) => e.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(new Set(years).size).toBe(years.length);
    for (const e of manifest.elections) {
      expect(e.files.results).toBeTruthy();
      expect(e.files.meshblock?.lo).toBeTruthy();
      expect(e.files.voronoi?.lo).toBeTruthy();
    }
  });

  it.each(has ? manifest.elections.map((e) => e.year) : [])("%i: every polling place has well-formed shares and leaders", (year) => {
    const e = manifest.elections.find((x) => x.year === year)!;
    const file = read<ResultsFile>(e.files.results);
    const yd = buildYearData(file);
    expect(yd.n).toBe(e.sites);
    let led = 0;
    for (let i = 0; i < yd.n; i++) {
      const row = siteRow(yd, i, "all")!;
      const sum = Array.from(row.votes).reduce((a, b) => a + b, 0);
      expect(sum).toBe(row.total);
      const L = leader(row.votes, row.total);
      if (L) {
        led++;
        expect(L.share).toBeGreaterThan(0);
        expect(L.share).toBeLessThanOrEqual(1);
        expect(L.marginShare).toBeGreaterThanOrEqual(0);
      }
    }
    expect(led / yd.n).toBeGreaterThan(0.95);
    // National totals are the sum of the official electorate totals
    const nat = Object.values(e.national).reduce((a, b) => a + b, 0);
    expect(nat).toBe(e.nationalValid);
    // Mapped votes never exceed the official total
    expect(e.stats.valid_votes_mapped).toBeLessThanOrEqual(e.stats.valid_votes_total);
  });
});
