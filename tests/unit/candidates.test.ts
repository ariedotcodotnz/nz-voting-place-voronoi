import { describe, expect, it } from "vitest";
import { encode, type EncodingSettings } from "@/lib/atlas/encoding";
import { buildYearData, splitAt, viewFor } from "@/lib/atlas/stats";
import { formatCandidateName, siteCandidates } from "@/lib/atlas/candidates";
import { manifest, results } from "./fixtures";

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
  refYear: null,
  voteKind: "party",
};

// labour national green act top nzfirst
const party = [[400, 450, 150, 0, 0, 0], [300, 200, 100, 0, 0, 0]];
const cand = [[300, 250, 450, 0, 0, 0], [350, 250, 0, 0, 0, 0]];

describe("electorate (candidate) votes", () => {
  const yd = buildYearData(results(2023, party, { candidates: cand }));

  it("builds a candidate view grouped by party", () => {
    const c = viewFor(yd, "candidate")!;
    expect(c.kind).toBe("candidate");
    expect(c.totals.all![0]).toBe(1000);
    expect(viewFor(yd, "party")).toBe(yd);
  });

  it("maps the leading party of the electorate vote, which can differ from the party vote", () => {
    const p = encode(manifest, yd, base, null, null);
    const c = encode(manifest, yd, { ...base, voteKind: "candidate" }, null, null);
    expect(p.colors[0]).not.toEqual(c.colors[0]); // National leads party vote, Green the candidate vote
    expect(c.legend.kind === "categorical" && c.legend.title).toMatch(/electorate vote/);
  });

  it("computes candidate-minus-party share for the split comparison", () => {
    const sp = splitAt(yd, 0, "green", "all");
    expect(sp.party).toBeCloseTo(0.15);
    expect(sp.cand).toBeCloseTo(0.45);
    expect(sp.diff).toBeCloseTo(0.3);
    const e = encode(manifest, yd, { ...base, mode: "split", party: "green" }, null, null);
    expect(e.values[0]).toBeCloseTo(0.3);
    expect(e.values[1]).toBeCloseTo(-100 / 600);
  });

  it("never guesses affiliations: names-only elections are reported as unavailable", () => {
    const names = buildYearData(results(2026, party, { candidates: cand, candidatesAvailable: false }));
    expect(names.candidate).toBeNull();
    const e = encode(manifest, names, { ...base, voteKind: "candidate" }, null, null);
    expect(e.notes.join(" ")).toMatch(/don't say which party/);
    expect(Array.from(e.values).every(Number.isNaN)).toBe(true);
    expect(Number.isNaN(splitAt(names, 0, "green", "all").diff)).toBe(true);
  });

  it("lists candidates recorded at a polling place, largest first", () => {
    const list = siteCandidates(yd.file, 0, "all");
    expect(list[0].candidates[0]).toMatchObject({ party: "green", votes: 450 });
    expect(list[0].total).toBe(1000);
  });

  it("formats candidate names for display", () => {
    expect(formatCandidateName("SWARBRICK, Chlöe Charlotte")).toBe("Chlöe Charlotte Swarbrick");
    expect(formatCandidateName("O'CONNELL, Kevin Patrick")).toBe("Kevin Patrick O'Connell");
    expect(formatCandidateName("GALEY-YOUNG, Aaron")).toBe("Aaron Galey-Young");
    expect(formatCandidateName("Plain Name")).toBe("Plain Name");
  });
});
