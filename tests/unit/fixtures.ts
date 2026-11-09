/**
 * Small synthetic fixtures for unit tests. These numbers are invented test
 * inputs, not election results; real-data checks live in realdata.test.ts.
 */
import type { Manifest, ResultsFile, SitesFile } from "@/lib/atlas/types";

export const PARTIES = ["labour", "national", "green", "act", "top", "nzfirst"];

export function results(year: number, rows: number[][], opts: { advance?: number[][]; ids?: string[]; candidates?: number[][]; candidatesAvailable?: boolean } = {}): ResultsFile {
  const n = rows.length;
  const P = PARTIES.length;
  const sum = (r: number[]) => r.reduce((a, b) => a + b, 0);
  return {
    year,
    date: `${year}-10-01`,
    status: "final",
    advanceByVenue: Boolean(opts.advance),
    parties: PARTIES,
    partyStats: Object.fromEntries(PARTIES.map((p) => [p, { p98Share: 0.5, maxShare: 0.6, p98Votes: 500, maxVotes: 900 }])),
    sites: {
      id: opts.ids ?? rows.map((_, i) => `S${i}`),
      name: rows.map((_, i) => `Site ${i}`),
      address: rows.map((_, i) => `${i} Test Street`),
      suburb: rows.map(() => "Testville"),
      lat: rows.map((_, i) => -41 - i * 0.01),
      lng: rows.map((_, i) => 174 + i * 0.01),
      home: rows.map(() => 0),
      types: rows.map(() => (opts.advance ? "AE" : "E")),
      located: rows.map(() => "exact"),
      locationYear: rows.map(() => year),
      zeroRows: rows.map(() => 0),
      electorates: rows.map((r) => [[0, sum(r)]]),
      areaKm2: {},
    },
    votes: {
      e: rows,
      a: opts.advance ?? null,
      te: rows.map(sum),
      ta: opts.advance ? opts.advance.map(sum) : null,
      ie: rows.map(() => 0),
      ia: opts.advance ? opts.advance.map(() => 0) : null,
    },
    electorates: [{ no: 1, name: "Test", kind: "general", totals: Array(P).fill(0), totalValid: 0, informal: 0, mapped: 0, nongeo: {}, bbox: null }],
    national: { totals: Array(P).fill(0), totalValid: 0, informal: 0 },
    nongeo: {},
    nongeoLabels: {},
    stats: { electorates: 1, result_rows: n, venue_rows: n, match_methods: {}, coordinate_records: n, sites: n, valid_votes_total: 0, valid_votes_mapped: 0, valid_votes_by_nongeo_category: {}, mapped_share: 1 },
    candidates: opts.candidates
      ? {
          available: opts.candidatesAvailable ?? true,
          parties: PARTIES,
          e: opts.candidates,
          a: opts.advance ? opts.candidates.map(() => Array(P).fill(0)) : null,
          te: opts.candidates.map(sum),
          ta: opts.advance ? opts.candidates.map(() => 0) : null,
          national: Array(P).fill(0),
          electorates: [{ names: PARTIES.map((p) => `CANDIDATE, ${p}`), parties: PARTIES, totals: Array(P).fill(0), totalValid: 0, informal: 0, winner: 0, majority: 0, note: null }],
          sites: opts.candidates.map((r) => [[0, r, null]]),
        }
      : null,
  };
}

export const manifest = {
  generatedAt: "2026-01-01T00:00:00Z",
  partyScale: Object.fromEntries(PARTIES.map((p) => [p, { share: 0.6, votes: 800 }])),
  elections: [2017, 2020, 2023].map((year) => ({
    year,
    date: `${year}-10-01`,
    status: year === 2023 ? "preliminary" : "final",
    advanceByVenue: true,
    sites: 3,
    parties: PARTIES,
    national: { labour: 500, national: 400, green: 100 },
    nationalValid: 1000,
    files: { results: `results/${year}.json` },
    stats: {},
    source: null,
  })),
  parties: Object.fromEntries(
    PARTIES.map((p, k) => [p, { name: p, short: p.toUpperCase(), color: ["#D8291F", "#0B5CAD", "#14894A", "#F2BE00", "#1FB5C4", "#2A2A2A"][k], notes: null, classified: true, ballotNames: { "2017": p, "2020": p, "2023": p } }]),
  ),
  blocs: {
    blocs: {
      left: { label: "Centre-left bloc", short: "Centre-left", color: "#C8312B" },
      right: { label: "Centre-right bloc", short: "Centre-right", color: "#1D5FA8" },
      centre: { label: "Centrist bloc", short: "Centrist", color: "#1FB5C4" },
    },
    schemes: [
      {
        id: "core",
        label: "Core blocs — TOP excluded",
        description: "",
        blocs: ["left", "right"],
        membership: [
          { party: "labour", bloc: "left" },
          { party: "green", bloc: "left" },
          { party: "national", bloc: "right" },
          { party: "act", bloc: "right" },
        ],
        explicitlyUnassigned: [{ party: "top", reason: "Excluded in this variant" }],
      },
      {
        id: "core-top",
        label: "Core blocs — TOP included",
        description: "",
        blocs: ["left", "right", "centre"],
        configurable: ["top"],
        membership: [
          { party: "labour", bloc: "left" },
          { party: "green", bloc: "left" },
          { party: "top", bloc: "left" },
          { party: "national", bloc: "right" },
          { party: "act", bloc: "right" },
        ],
        explicitlyUnassigned: [],
      },
    ],
  },
  boundary: { default: "meshblock", methods: { meshblock: "m", voronoi: "v" }, lod: { loToleranceM: 150, hiToleranceM: 8 } },
  files: { sites: "sites.json", search: "search.json", report: "report.json" },
} as unknown as Manifest;

export const sites: SitesFile = {
  sites: {
    S0: { id: "S0", name: "Site 0", suburb: "", lat: 0, lng: 0, years: { "2020": 0, "2023": 0 }, confidence: { "2020-2023": "exact" } },
    S1: { id: "S1", name: "Site 1", suburb: "", lat: 0, lng: 0, years: { "2020": 1, "2023": 1 }, confidence: { "2020-2023": "probable" } },
    S2: { id: "S2", name: "Site 2", suburb: "", lat: 0, lng: 0, years: { "2023": 2 }, confidence: {} },
  },
};
