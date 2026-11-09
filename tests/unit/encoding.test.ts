import { describe, expect, it } from "vitest";
import { encode, niceCeil, type EncodingSettings } from "@/lib/atlas/encoding";
import { buildYearData } from "@/lib/atlas/stats";
import { toRGBA, NO_DATA_HEX, TIE_HEX, deltaE, divergingPoles, sequentialInterpolator } from "@/lib/atlas/color";
import { lab } from "d3";
import { manifest, results, sites } from "./fixtures";

const base: EncodingSettings = {
  mode: "winner",
  party: "green",
  cmpA: "labour",
  partyB: "national",
  measure: "share",
  voteType: "all",
  scheme: "core",
  topBloc: "left",
  blocOverrides: {},
  swingTarget: { kind: "party", id: "labour" },
  swingMinConfidence: "high",
  scaleMode: "fixed",
  scaleMax: 0.6,
  shadeMargin: false,
  refYear: 2020,
};

// labour national green act top nzfirst
const y2023 = buildYearData(results(2023, [[500, 300, 100, 0, 50, 50], [200, 200, 10, 0, 0, 0], [0, 0, 0, 0, 0, 0]], { advance: [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]] }));
const y2020 = buildYearData(results(2020, [[400, 400, 100, 0, 50, 50], [300, 100, 0, 0, 0, 0]], { advance: [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]] }));

describe("leading-party encoding", () => {
  const e = encode(manifest, y2023, base, null, null);
  it("colours by leader, flags ties and missing data", () => {
    expect(e.colors[0]).toEqual(toRGBA("#D8291F"));
    expect(e.colors[1]).toEqual(toRGBA(TIE_HEX));
    expect(e.colors[2]).toEqual(toRGBA(NO_DATA_HEX));
    expect(e.values[2]).toBeNaN();
  });
  it("legend counts polling places led", () => {
    if (e.legend.kind !== "categorical") throw new Error("expected categorical");
    expect(e.legend.items).toEqual([expect.objectContaining({ key: "labour", count: 1 })]);
    expect(e.legend.extras.map((x) => x.count)).toEqual([1, 1]);
  });
});

describe("party strength encoding", () => {
  it("shows share as a value and missing data as NaN, not zero", () => {
    const e = encode(manifest, y2023, { ...base, mode: "party", party: "green" }, null, null);
    expect(e.values[0]).toBeCloseTo(0.1);
    expect(e.values[2]).toBeNaN();
  });
  it("marks parties not on the ballot", () => {
    const yd = buildYearData({ ...results(2023, [[1, 2, 3, 4, 5, 6]]), parties: ["labour", "national", "green", "act", "top", "nzfirst"] });
    const e = encode(manifest, yd, { ...base, mode: "party", party: "alliance" }, null, null);
    expect(e.notes.join(" ")).toMatch(/did not contest/);
  });
});

describe("head-to-head encoding", () => {
  it("uses percentage-point differences by default", () => {
    const e = encode(manifest, y2023, { ...base, mode: "compare", cmpA: "labour", partyB: "national" }, null, null);
    expect(e.values[0]).toBeCloseTo((500 - 300) / 1000);
    expect(e.values[1]).toBeCloseTo(0);
  });
  it("can use raw vote differences", () => {
    const e = encode(manifest, y2023, { ...base, mode: "compare", cmpA: "labour", partyB: "national", measure: "votes" }, null, null);
    expect(e.values[0]).toBe(200);
  });
});

describe("swing encoding", () => {
  it("computes swing only at matched polling places", () => {
    const e = encode(manifest, y2023, { ...base, mode: "swing" }, y2020, sites);
    expect(e.values[0]).toBeCloseTo(0.5 - 0.4); // S0 matched exactly
    expect(e.values[1]).toBeNaN(); // S1 only a probable match
    expect(e.values[2]).toBeNaN(); // S2 new in 2023
    expect(e.refIndex![0]).toBe(0);
  });
  it("includes probable matches when asked", () => {
    const e = encode(manifest, y2023, { ...base, mode: "swing", swingMinConfidence: "probable" }, y2020, sites);
    expect(e.values[1]).toBeCloseTo(200 / 410 - 300 / 400);
  });
  it("falls back to election-day votes when one election lacks venue-level advance votes", () => {
    const old = buildYearData(results(2014, [[400, 400, 100, 0, 50, 50], [300, 100, 0, 0, 0, 0]]));
    const e = encode(manifest, y2023, { ...base, mode: "swing", refYear: 2014 }, old, { sites: { S0: { ...sites.sites.S0, years: { "2014": 0, "2023": 0 }, confidence: { "2014-2023": "exact" } } } });
    expect(e.voteType).toBe("eday");
    expect(e.notes.join(" ")).toMatch(/election-day votes only/);
  });
});

describe("bloc encoding", () => {
  it("TOP-inclusive variant moves TOP votes into its bloc", () => {
    const excl = encode(manifest, y2023, { ...base, mode: "bloc", scheme: "core" }, null, null);
    const incl = encode(manifest, y2023, { ...base, mode: "bloc", scheme: "core-top", topBloc: "left" }, null, null);
    expect(incl.values[0] - excl.values[0]).toBeCloseTo(50 / 1000);
  });
});

describe("colour scales", () => {
  it("sequential ramps get darker monotonically", () => {
    const f = sequentialInterpolator("#14894A");
    const L = [0, 0.25, 0.5, 0.75, 1].map((t) => lab(f(t)).l);
    for (let k = 1; k < L.length; k++) expect(L[k]).toBeLessThan(L[k - 1]);
  });
  it("falls back to purple/orange when two party colours are too similar", () => {
    expect(divergingPoles("#D8291F", "#C8312B").fallback).toBe(true);
    expect(divergingPoles("#D8291F", "#0B5CAD").fallback).toBe(false);
    expect(deltaE("#000000", "#ffffff")).toBeGreaterThan(99);
  });
  it("rounds scale domains to tidy values", () => {
    expect(niceCeil(0.0237)).toBeCloseTo(0.025);
    expect(niceCeil(1830)).toBe(2000);
    expect(niceCeil(0.5)).toBe(0.5);
  });
});
