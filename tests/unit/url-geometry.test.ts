import { describe, expect, it } from "vitest";
import { DEFAULT_URL_STATE, parseUrlState, serialiseUrlState } from "@/lib/atlas/url";
import { decodeRing, decodeGeometryFile, padBBox, splitViewport, viewportIntersects } from "@/lib/atlas/geometry";
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
  it("pads viewports that cross the antimeridian outwards, not inside out", () => {
    const padded = padBBox([175, -44, -175, -40], 0.15);
    expect(padded[0]).toBeCloseTo(173.5);
    expect(padded[2]).toBeCloseTo(-173.5);
    // A chunk just inside the viewport stays in view after padding.
    expect(viewportIntersects(padded, [-176.9, -44.4, -176.1, -43.7])).toBe(true);
    expect(padBBox([170, -44, 175, -40], 0.1)).toEqual([169.5, -44.4, 175.5, -39.6]);
    expect(padBBox([-10, -44, -20, -40], 0.5).slice(0, 3)).toEqual([-180, -46, 180]);
  });
});

describe("search folding", () => {
  it("ignores macrons and case", () => {
    expect(fold("Ōtāhuhu")).toBe("otahuhu");
    expect(fold("St Mary’s")).toBe("st marys");
  });
});

import { claritySession, reportDetails, reportUrl } from "@/lib/report";

describe("problem report link", () => {
  const ctx = { link: "https://example.nz/?y=2023&m=swing", view: "2023, swing, Green, party vote", place: "Katikati Memorial Hall (s12)", userAgent: "UA/1.0", screen: "1440×900 @2x", dataBuilt: "2026-11-11", failed: [], cookie: "" };

  it("prefills the form's technical-details question with the view, round-tripping through the URL", () => {
    const details = reportDetails(ctx);
    expect(details.split("\n")).toEqual(["Link: https://example.nz/?y=2023&m=swing", "View: 2023, swing, Green, party vote", "Place: Katikati Memorial Hall (s12)", "Device: UA/1.0; window 1440×900 @2x", "Version: data built 2026-11-11"]);
    const url = new URL(reportUrl(details));
    expect(url.pathname.endsWith("/viewform")).toBe(true);
    expect(url.searchParams.get("entry.895402550")).toBe(details);
  });

  it("leaves out the place and session when there are none, and lists failed files", () => {
    const details = reportDetails({ ...ctx, place: null, failed: ["year:2011"] });
    expect(details).not.toContain("Place:");
    expect(details).not.toContain("Session:");
    expect(details).toContain("failed to load: year:2011");
  });

  it("reads the Clarity session from its cookies, in either separator format", () => {
    expect(claritySession("a=1; _clck=u1x2y3%5E2%5Efz1; _clsk=s9k8j7%5E1731300000000%5E3%5E1%5Eb.clarity.ms%2Fcollect")).toBe("s9k8j7 (visitor u1x2y3)");
    expect(claritySession("_clsk=abcd12|1731300000000|1|1|x")).toBe("abcd12");
    expect(claritySession("other=1")).toBeNull();
    expect(reportDetails({ ...ctx, cookie: "_clsk=abcd12^1^1" })).toContain("Session: abcd12");
  });
});
