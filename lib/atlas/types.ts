/**
 * Typed contract for the assets written by the Python pipeline
 * (`python -m pipeline build` → public/data). Keep in sync with
 * pipeline/build.py and pipeline/export.py.
 */

export type PartyId = string;
export type BlocId = string;
export type BoundaryMethod = "meshblock" | "voronoi";
export type VoteType = "all" | "eday" | "advance";
export type ElectionStatus = "final" | "preliminary";

export interface PartyMeta {
  name: string;
  short: string;
  color: string;
  notes: string | null;
  classified: boolean;
  /** Only ever an electorate candidate's affiliation (no party list). */
  candidateOnly?: boolean;
  /** Name printed on each year's ballot, keyed by year. */
  ballotNames: Record<string, string>;
}

export interface BlocDef {
  label: string;
  short: string;
  color: string;
}

export interface BlocMembership {
  party: PartyId;
  bloc: BlocId;
  from?: number;
  to?: number;
}

export interface BlocScheme {
  id: string;
  label: string;
  description: string;
  blocs: BlocId[];
  configurable?: PartyId[];
  membership: BlocMembership[];
  explicitlyUnassigned: { party: PartyId; reason: string; from?: number; to?: number }[];
}

export interface BlocConfig {
  blocs: Record<BlocId, BlocDef>;
  schemes: BlocScheme[];
}

export interface ChunkRef {
  file: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  n: number;
}

export interface ElectionFiles {
  results: string;
  electorates?: string;
  meshblock?: { lo: string; hi: ChunkRef[] };
  voronoi?: { lo: string; hi: ChunkRef[] };
}

export interface ElectionStats {
  electorates: number;
  result_rows: number;
  venue_rows: number;
  match_methods: Record<string, number>;
  coordinate_records: number;
  sites: number;
  valid_votes_total: number;
  valid_votes_mapped: number;
  valid_votes_by_nongeo_category: Record<string, number>;
  mapped_share: number;
}

export interface ManifestElection {
  year: number;
  date: string | null;
  status: ElectionStatus;
  advanceByVenue: boolean;
  /** Electorate (candidate) votes: by party, by name only (affiliations missing), or absent. */
  candidates: "byParty" | "namesOnly" | null;
  sites: number;
  parties: PartyId[];
  /** Official national party-vote totals (all electorates, incl. special votes). */
  national: Record<PartyId, number>;
  nationalValid: number;
  files: ElectionFiles;
  stats: ElectionStats;
  source: Record<string, unknown> | null;
}

export interface PartyStats {
  p98Share: number;
  maxShare: number;
  p98Votes: number;
  maxVotes: number;
}

export interface Manifest {
  generatedAt: string;
  /** Per-party scale domains fixed across all elections (98th percentiles). */
  partyScale: Record<PartyId, { share: number; votes: number }>;
  elections: ManifestElection[];
  parties: Record<PartyId, PartyMeta>;
  blocs: BlocConfig;
  boundary: {
    default: BoundaryMethod;
    methods: Record<BoundaryMethod, string>;
    lod: { loToleranceM: number; hiToleranceM: number };
  };
  files: { sites: string; search: string; report: string; labels?: string };
}

export type LabelKind = "region" | "city" | "locality";

/** Place-name labels: [name, lat, lng, kind, weight]; higher weight wins collisions. */
export interface LabelsFile {
  labels: [string, number, number, LabelKind, number][];
}

export type LocationQuality = "exact" | "fuzzy" | "inferred";

export interface ElectorateSummary {
  no: number;
  name: string;
  kind: "general" | "maori";
  totals: number[];
  totalValid: number;
  informal: number;
  mapped: number;
  nongeo: Record<string, number>;
  bbox: [number, number, number, number] | null;
}

export interface ResultsFile {
  year: number;
  date: string | null;
  status: ElectionStatus;
  advanceByVenue: boolean;
  parties: PartyId[];
  sites: {
    id: string[];
    name: string[];
    address: string[];
    suburb: string[];
    lat: number[];
    lng: number[];
    home: number[];
    types: string[];
    located: LocationQuality[];
    locationYear: number[];
    zeroRows: number[];
    electorates: [number, number][][];
    areaKm2: Partial<Record<BoundaryMethod, number[]>>;
  };
  votes: {
    e: number[][];
    a: number[][] | null;
    te: number[];
    ta: number[] | null;
    ie: number[];
    ia: number[] | null;
  };
  partyStats: Record<PartyId, PartyStats>;
  electorates: ElectorateSummary[];
  national: { totals: number[]; totalValid: number; informal: number };
  nongeo: Record<string, number[]>;
  nongeoLabels: Record<string, string>;
  stats: ElectionStats;
  candidates: CandidatesBlock | null;
}

export interface CandidateElectorate {
  /** Candidate names as printed by the Electoral Commission ("SURNAME, Given"). */
  names: string[];
  /** Party id for each candidate, or null when the source gives no affiliation. */
  parties: (PartyId | null)[];
  totals: number[];
  totalValid: number;
  informal: number;
  winner: number | null;
  majority: number | null;
  note: string | null;
}

/** Electorate (candidate) votes for one election. */
export interface CandidatesBlock {
  /** True when every candidate's party is known, so votes can be grouped by party. */
  available: boolean;
  /** Column order of the by-party arrays ("?" = unknown affiliation). */
  parties: PartyId[];
  e: number[][];
  a: number[][] | null;
  te: number[];
  ta: number[] | null;
  national: number[];
  /** Aligned with ResultsFile.electorates (null when that electorate has no candidate file). */
  electorates: (CandidateElectorate | null)[];
  /** Per site: [electorateIndex, election-day votes per candidate, advance votes per candidate | null][] */
  sites: [number, number[], number[] | null][][];
}

/** Compact encoded geometry (see pipeline/export.py). */
export interface EncodedGeometryFile {
  v: 1;
  scale: number;
  year?: number;
  method?: BoundaryMethod;
  lod?: "lo" | "hi";
  approximate?: boolean;
  features: [number, number[][][]][];
}

export type LinkConfidence = "exact" | "high" | "probable" | "address-inferred" | "chained";

export interface StableSite {
  id: string;
  name: string;
  suburb: string;
  lat: number;
  lng: number;
  /** election year -> site index in that year's results */
  years: Record<string, number>;
  /** "y1-y2" (y1 < y2) -> confidence that both are the same physical place */
  confidence: Record<string, LinkConfidence>;
}

export interface SitesFile {
  sites: Record<string, StableSite>;
}

export interface SearchFile {
  /** [stableId, name, suburb, lat, lng, years] */
  places: [string, string, string, number, number, number[]][];
  /** [suburb, lat, lng, count] */
  suburbs: [string, number, number, number][];
  electorates: { name: string; kind: "general" | "maori"; years: number[] }[];
  regions: { name: string; kind: "region" | "city"; bbox: [number, number, number, number] }[];
}

export interface ReportFile {
  generatedAt: string;
  elections: {
    year: number;
    status: ElectionStatus;
    stats: ElectionStats;
    issueCounts: Record<string, number>;
    unmatched: { message: string; votes: number }[];
    notes: string[];
  }[];
  geometry: Record<string, Record<string, number | boolean>>;
  linking: { stableLocations: number; pairs: Record<string, number | string>[] };
  excludedIslands: { name: string; polygons: number; area_km2: number }[];
  unclassifiedParties: { id: string; name: string }[];
  issueCounts: Record<string, number>;
}

/** A decoded polygon feature ready for deck.gl. */
export interface CatchmentFeature {
  type: "Feature";
  /** site index within the election */
  id: number;
  properties: { i: number; chunk: string };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}
