import { describe, expect, it } from "vitest";
import { DEFAULT_URL_STATE, parseUrlState, serialiseUrlState } from "@/lib/atlas/url";
import { decodeRing, decodeGeometryFile, splitViewport, viewportIntersects } from "@/lib/atlas/geometry";
import { fold } from "@/lib/atlas/text";

describe("URL state", () => {
  it("round-trips a full view", () => {
    const s = { ...DEFAULT_URL_STATE, year: 2014, refYear: 2011, mode: "swing" as const, party: "act", cmpA: "green", partyB: "labour", voteType: "eday" as const, boundary: "voronoi" as const, basemap: "satellite" as const, scheme: "core-top", topBloc: "centre", blocOverrides: { nzfirst: "right", tpm: null }, swingTarget: { kind: "bloc" as const, id: "left" }, selected: "175701-592040", view: { lat: -41.2865, lng: 174.7762, zoom: 12.5 }, electorates: true };
    const parsed = parseUrlState(serialiseUrlState(s));
    expect(parsed).toEqual({ ...s, view: { lat: -41.2865, lng: 174.7762, zoom: 12.5 } });
  });
  it("omits defaults", () => {
    expect(serialiseUrlState(DEFAULT_URL_STATE)).toBe("");
  });
  it("sanitises hostile or malformed input", () => {
    const p = parseUrlState("?m=<script>&p=../../etc&y=abc&v=1,2&bo=a:b:c,x:<y>&sel=%3Cimg%3E");
    expect(p.mode).toBe("winner");
    expect(p.party).toBe(DEFAULT_URL_STATE.party);
    expect(p.year).toBeNull();
    expect(p.view).toBeNull();
    expect(p.selected).toBeNull();
    expect(p.blocOverrides).toEqual({ a: "b" });
  });
});

describe("geometry decoding", () => {
  it("decodes delta-encoded rings", () => {
    expect(decodeRing([17470000, -4130000, 100, 0, 0, 100, -100, -100], 100000)).toEqual([
      [174.7, -41.3],
      [174.701, -41.3],
      [174.701, -41.299],
      [174.7, -41.3],
    ]);
  });
  it("decodes a feature file", () => {
    const f = decodeGeometryFile({ v: 1, scale: 10, features: [[7, [[[10, 20, 1, 0, 0, 1, -1, -1]]]]] }, "lo");
    expect(f[0].properties.i).toBe(7);
    expect(f[0].geometry.coordinates[0][0][1]).toEqual([1.1, 2]);
  });
  it("handles viewports that cross the antimeridian (Chatham Islands)", () => {
    expect(splitViewport([170, -45, -175, -40])).toHaveLength(2);
    expect(viewportIntersects([170, -45, -175, -40], [-176.9, -44.4, -176.1, -43.7])).toBe(true);
    expect(viewportIntersects([170, -45, 175, -40], [-176.9, -44.4, -176.1, -43.7])).toBe(false);
  });
});

describe("search folding", () => {
  it("ignores macrons and case", () => {
    expect(fold("Ōtāhuhu")).toBe("otahuhu");
    expect(fold("St Mary’s")).toBe("st marys");
  });
});
