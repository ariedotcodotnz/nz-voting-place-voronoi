import { describe, expect, it } from "vitest";
import { blocLeader, blocTotals, buildYearData, circleArea, circleRadius, clusterPoints, comparableSite, leader, nearestYear, rankParties, resolveVoteType, share, siteRow, sortYears, stepYear, swing } from "@/lib/atlas/stats";
import { circleRadiusPx, clusterCellDeg, legendValues, valueForRadius, zoomFactor } from "@/lib/atlas/circles";
import { PARTIES, results, sites } from "./fixtures";

describe("vote-share percentages", () => {
  it("divides votes by valid votes", () => {
    expect(share(250, 1000)).toBe(0.25);
    expect(share(0, 1000)).toBe(0);
  });
  it("returns NaN (missing) rather than 0 when nothing was recorded", () => {
    expect(share(0, 0)).toBeNaN();
  });
  it("rejects impossible percentages", () => {
    expect(() => share(11, 10)).toThrow(RangeError);
    expect(() => share(-1, 10)).toThrow(RangeError);
  });
  it("shares across all parties sum to one", () => {
    const yd = buildYearData(results(2020, [[120, 80, 40, 20, 5, 35]]));
    const row = siteRow(yd, 0, "all")!;
    const total = Array.from(row.votes).reduce((s, v) => s + share(v, row.total), 0);
    expect(total).toBeCloseTo(1, 12);
  });
});

describe("leading party", () => {
  it("finds the leader, runner-up and margin", () => {
    const L = leader([300, 450, 100, 50], 900)!;
    expect(L.index).toBe(1);
    expect(L.votes).toBe(450);
    expect(L.share).toBeCloseTo(0.5);
    expect(L.runnerUpIndex).toBe(0);
    expect(L.marginVotes).toBe(150);
    expect(L.marginShare).toBeCloseTo(150 / 900);
    expect(L.tie).toBe(false);
  });
  it("reports ties explicitly instead of picking a winner", () => {
    const L = leader([200, 200, 100], 500)!;
    expect(L.tie).toBe(true);
    expect(L.index).toBe(-1);
    expect(L.tiedIndices).toEqual([0, 1]);
    expect(L.marginVotes).toBe(0);
  });
  it("returns null when no votes were recorded (suppressed booths)", () => {
    expect(leader([0, 0, 0], 0)).toBeNull();
    expect(leader([], 10)).toBeNull();
  });
  it("ranks parties by votes with a stable tie-break", () => {
    expect(rankParties([5, 9, 9, 1], 24).map((r) => r.index)).toEqual([1, 2, 0, 3]);
  });
});

describe("vote types", () => {
  it("adds advance and election-day votes for 'all'", () => {
    const yd = buildYearData(results(2020, [[10, 20, 0, 0, 0, 0]], { advance: [[5, 1, 0, 0, 0, 0]] }));
    expect(Array.from(siteRow(yd, 0, "all")!.votes.slice(0, 2))).toEqual([15, 21]);
    expect(siteRow(yd, 0, "all")!.total).toBe(36);
    expect(siteRow(yd, 0, "advance")!.total).toBe(6);
  });
  it("treats advance votes as unavailable for elections without venue-level advance results", () => {
    const yd = buildYearData(results(2011, [[10, 20, 0, 0, 0, 0]]));
    expect(resolveVoteType(yd, "advance")).toBeNull();
    expect(resolveVoteType(yd, "all")).toBe("all");
    expect(siteRow(yd, 0, "all")!.total).toBe(30);
  });
});

describe("bloc aggregation", () => {
  const parties = PARTIES; // labour national green act top nzfirst
  const row = [400, 380, 100, 90, 60, 70];
  const total = 1100;
  it("keeps unassigned votes separate from bloc votes", () => {
    const m = new Map([["labour", "left"], ["green", "left"], ["national", "right"], ["act", "right"]]);
    const t = blocTotals(row, parties, m, ["left", "right"], total);
    expect(t.blocs.get("left")).toBe(500);
    expect(t.blocs.get("right")).toBe(470);
    expect(t.unassigned).toBe(130);
    expect(t.blocs.get("left")! + t.blocs.get("right")! + t.unassigned).toBe(total);
  });
  it("TOP-exclusive and TOP-inclusive variants differ only by TOP's votes", () => {
    const base = new Map([["labour", "left"], ["green", "left"], ["national", "right"], ["act", "right"]]);
    const withTop = new Map(base).set("top", "left");
    const a = blocTotals(row, parties, base, ["left", "right"], total);
    const b = blocTotals(row, parties, withTop, ["left", "right"], total);
    expect(b.blocs.get("left")! - a.blocs.get("left")!).toBe(60);
    expect(a.unassigned - b.unassigned).toBe(60);
    expect(blocLeader(b)!.marginVotes).toBe(blocLeader(a)!.marginVotes + 60);
  });
  it("distinguishes zero bloc votes from no data", () => {
    const m = new Map([["labour", "left"]]);
    const t = blocTotals([0, 50, 0, 0, 0, 0], parties, m, ["left"], 50);
    const L = blocLeader(t)!;
    expect(L.bloc).toBeNull();
    expect(L.unassigned).toBe(50);
    expect(L.unassignedLargest).toBe(true);
    expect(blocLeader(blocTotals([0, 0, 0, 0, 0, 0], parties, m, ["left"], 0))).toBeNull();
  });
  it("detects bloc ties", () => {
    const m = new Map([["labour", "left"], ["national", "right"]]);
    expect(blocLeader(blocTotals([100, 100, 0, 0, 0, 0], parties, m, ["left", "right"], 200))!.tie).toBe(true);
  });
});

describe("proportional circles", () => {
  it("makes circle AREA proportional to votes (10× votes → 10× area)", () => {
    const a = circleArea(circleRadius(1000, 1000, 30));
    const b = circleArea(circleRadius(100, 1000, 30));
    expect(a / b).toBeCloseTo(10, 10);
  });
  it("keeps the area ratio at every zoom level and scale", () => {
    for (const z of [5, 8, 11, 15]) {
      const r1 = circleRadiusPx(1000, z, "votes", 1.7);
      const r2 = circleRadiusPx(100, z, "votes", 1.7);
      expect((r1 * r1) / (r2 * r2)).toBeCloseTo(10, 10);
    }
  });
  it("applies a minimum radius without affecting larger circles", () => {
    expect(circleRadius(1, 10000, 30, 2)).toBe(2);
    expect(circleRadius(10000, 10000, 30, 2)).toBe(30);
    expect(circleRadius(0, 100, 30, 2)).toBe(0);
  });
  it("inverts radius to value for legends", () => {
    const r = circleRadiusPx(2500, 9, "votes");
    expect(valueForRadius(r, 9, "votes")).toBeCloseTo(2500, 6);
    expect(zoomFactor(11)).toBe(1);
  });
  it("clusters by summing votes so cluster area equals the sum of member areas", () => {
    const pts = [
      { lng: 174.012, lat: -41.012, value: 300, index: 0 },
      { lng: 174.013, lat: -41.013, value: 100, index: 1 },
      { lng: 176, lat: -38, value: 50, index: 2 },
    ];
    const c = clusterPoints(pts, 0.05);
    expect(c).toHaveLength(2);
    const big = c.find((x) => x.members.length === 2)!;
    expect(big.value).toBe(400);
    const area = (v: number) => circleRadiusPx(v, 7, "votes") ** 2;
    expect(area(big.value)).toBeCloseTo(area(300) + area(100), 8);
    expect(clusterCellDeg(12, true)).toBe(0);
    expect(clusterCellDeg(6, false)).toBe(0);
  });
  it("produces tidy, increasing legend values", () => {
    const v = legendValues(4321, "votes");
    expect(v).toEqual([...v].sort((a, b) => a - b));
    expect(v[v.length - 1]).toBeLessThanOrEqual(4321);
  });
});

describe("election years", () => {
  it("sorts and de-duplicates years", () => {
    expect(sortYears([2023, 2008, 2017, 2008, 2011])).toEqual([2008, 2011, 2017, 2023]);
  });
  it("steps to the previous/next available election and stops at the ends", () => {
    const ys = [2008, 2011, 2014, 2017];
    expect(stepYear(ys, 2011, 1)).toBe(2014);
    expect(stepYear(ys, 2011, -1)).toBe(2008);
    expect(stepYear(ys, 2017, 1)).toBeNull();
    expect(stepYear(ys, 2008, -1)).toBeNull();
  });
  it("resolves a missing year to the nearest available election", () => {
    expect(nearestYear([2008, 2011, 2014, 2017, 2020, 2023], 2005)).toBe(2008);
    expect(nearestYear([2008, 2011, 2014], 2012)).toBe(2011);
    expect(nearestYear([2008, 2014], 2011)).toBe(2014);
    expect(nearestYear([], 2011)).toBeNull();
  });
});

describe("historical matching and swing", () => {
  it("matches only with sufficient confidence", () => {
    expect(comparableSite(sites.sites.S0, 2023, 2020, "high")).toEqual({ index: 0, confidence: "exact" });
    expect(comparableSite(sites.sites.S1, 2023, 2020, "high")).toBeNull();
    expect(comparableSite(sites.sites.S1, 2023, 2020, "probable")!.confidence).toBe("probable");
  });
  it("returns null when the location has no polling place in the other election", () => {
    expect(comparableSite(sites.sites.S2, 2023, 2020)).toBeNull();
    expect(comparableSite(undefined, 2023, 2020)).toBeNull();
  });
  it("computes swing in percentage points", () => {
    expect(swing(300, 1000, 200, 1000)).toBeCloseTo(0.1);
    expect(swing(0, 0, 200, 1000)).toBeNaN();
  });
});
