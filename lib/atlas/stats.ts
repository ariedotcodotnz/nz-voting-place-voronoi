/**
 * Pure statistical selectors. No React, no Google Maps, no deck.gl — every
 * function here is unit-tested in tests/unit.
 */
import type { PartyId, ResultsFile, StableSite, LinkConfidence, VoteType } from "./types";

export type VoteKind = "party" | "candidate";

export interface YearData {
  year: number;
  kind: VoteKind;
  file: ResultsFile;
  n: number;
  P: number;
  parties: PartyId[];
  partyIndex: Map<PartyId, number>;
  hasAdvance: boolean;
  stableIndex: Map<string, number>;
  /** Row-major n×P vote matrices per vote type; null when not available for this election. */
  votes: Record<VoteType, Int32Array | null>;
  totals: Record<VoteType, Int32Array | null>;
  /** Electorate (candidate) votes grouped by candidates' parties; null when
   *  unavailable (no candidate data, or affiliations missing as in 2026). */
  candidate: YearData | null;
}

function flatten(rows: number[][], P: number): Int32Array {
  const out = new Int32Array(rows.length * P);
  rows.forEach((row, i) => {
    if (row.length !== P) throw new Error(`Row ${i} has ${row.length} parties, expected ${P}`);
    out.set(row, i * P);
  });
  return out;
}

export function buildYearData(file: ResultsFile): YearData {
  const yd = buildMatrix(file, "party", file.parties, file.votes);
  const c = file.candidates;
  yd.candidate = c && c.available ? buildMatrix(file, "candidate", c.parties, c) : null;
  return yd;
}

function buildMatrix(file: ResultsFile, kind: VoteKind, parties: PartyId[], v: { e: number[][]; a: number[][] | null; te: number[]; ta: number[] | null }): YearData {
  const P = parties.length;
  const n = file.sites.name.length;
  const eday = flatten(v.e, P);
  const teday = Int32Array.from(v.te);
  const adv = v.a ? flatten(v.a, P) : null;
  const tadv = v.ta ? Int32Array.from(v.ta) : null;
  let all = eday;
  let tall = teday;
  if (adv && tadv) {
    all = new Int32Array(eday.length);
    for (let k = 0; k < all.length; k++) all[k] = eday[k] + adv[k];
    tall = new Int32Array(n);
    for (let i = 0; i < n; i++) tall[i] = teday[i] + tadv[i];
  }
  const stableIndex = new Map<string, number>();
  file.sites.id.forEach((id, i) => id && stableIndex.set(id, i));
  return {
    year: file.year,
    kind,
    file,
    n,
    P,
    parties,
    partyIndex: new Map(parties.map((p, i) => [p, i])),
    hasAdvance: Boolean(adv),
    stableIndex,
    votes: { all, eday, advance: adv },
    totals: { all: tall, eday: teday, advance: tadv },
    candidate: null,
  };
}

/** The party-vote or candidate-vote view of an election (null if unavailable). */
export function viewFor(yd: YearData | undefined | null, kind: VoteKind): YearData | null {
  if (!yd) return null;
  return kind === "candidate" ? yd.candidate : yd;
}

/** Candidate-vote share minus party-vote share for one party at one site
 *  (fraction; +0.05 = the candidate ran 5 points ahead). NaN when either is missing. */
export function splitAt(yd: YearData, i: number, party: PartyId, vt: VoteType): { cand: number; party: number; diff: number } {
  const c = yd.candidate;
  const pr = siteRow(yd, i, vt);
  const cr = c ? siteRow(c, i, vt) : null;
  if (!c || !pr || !cr || pr.total <= 0 || cr.total <= 0) return { cand: NaN, party: NaN, diff: NaN };
  const kp = yd.partyIndex.get(party);
  const kc = c.partyIndex.get(party);
  const ps = kp === undefined ? 0 : pr.votes[kp] / pr.total;
  const cs = kc === undefined ? 0 : cr.votes[kc] / cr.total;
  return { cand: cs, party: ps, diff: cs - ps };
}

/** The vote type actually used for an election. Elections before 2017 did not
 *  report advance votes by venue, so 'advance' is unavailable and 'all' equals
 *  election-day votes. */
export function resolveVoteType(yd: YearData, requested: VoteType): VoteType | null {
  if (requested === "advance" && !yd.hasAdvance) return null;
  return requested;
}

export function siteRow(yd: YearData, i: number, vt: VoteType): { votes: Int32Array; total: number } | null {
  const v = yd.votes[vt];
  const t = yd.totals[vt];
  if (!v || !t || i < 0 || i >= yd.n) return null;
  return { votes: v.subarray(i * yd.P, (i + 1) * yd.P), total: t[i] };
}

/** Share of `votes` in `total`; NaN (not 0) when nothing was recorded, so
 *  missing data is never confused with zero support. */
export function share(votes: number, total: number): number {
  if (!(total > 0)) return NaN;
  if (votes < 0 || votes > total) throw new RangeError(`Impossible share ${votes}/${total}`);
  return votes / total;
}

export interface RankedParty {
  index: number;
  votes: number;
  share: number;
}

/** Parties ordered by votes (desc), ties broken by column order for stability. */
export function rankParties(row: ArrayLike<number>, total: number): RankedParty[] {
  const out: RankedParty[] = [];
  for (let k = 0; k < row.length; k++) out.push({ index: k, votes: row[k], share: share(row[k], total) });
  return out.sort((a, b) => b.votes - a.votes || a.index - b.index);
}

export interface Leader {
  /** Column index of the leading party, or -1 when two or more parties tie for first. */
  index: number;
  tiedIndices: number[];
  tie: boolean;
  votes: number;
  share: number;
  runnerUpIndex: number;
  runnerUpVotes: number;
  marginVotes: number;
  /** Margin in percentage points expressed as a fraction (0.12 = 12 pp). */
  marginShare: number;
  total: number;
}

/** Leading party for one polling place. Returns null when no valid votes were
 *  recorded (e.g. results suppressed because fewer than 6 votes were taken). */
export function leader(row: ArrayLike<number>, total: number): Leader | null {
  if (!(total > 0) || row.length === 0) return null;
  let max = -1;
  for (let k = 0; k < row.length; k++) if (row[k] > max) max = row[k];
  if (max <= 0) return null;
  const tiedIndices: number[] = [];
  for (let k = 0; k < row.length; k++) if (row[k] === max) tiedIndices.push(k);
  const tie = tiedIndices.length > 1;
  // Runner-up: best party other than the first leader. In a tie this is the
  // other tied party, so the margin is zero.
  let second = -1;
  let secondIdx = -1;
  for (let k = 0; k < row.length; k++) {
    if (k === tiedIndices[0]) continue;
    if (row[k] > second) {
      second = row[k];
      secondIdx = k;
    }
  }
  const runnerUpVotes = Math.max(0, second);
  return {
    index: tie ? -1 : tiedIndices[0],
    tiedIndices,
    tie,
    votes: max,
    share: max / total,
    runnerUpIndex: secondIdx,
    runnerUpVotes,
    marginVotes: max - runnerUpVotes,
    marginShare: (max - runnerUpVotes) / total,
    total,
  };
}

/* ------------------------------------------------------------------------ */
/* Blocs                                                                     */
/* ------------------------------------------------------------------------ */

export interface BlocTotals {
  blocs: Map<string, number>;
  unassigned: number;
  total: number;
}

export function blocTotals(row: ArrayLike<number>, parties: PartyId[], membership: Map<PartyId, string>, blocIds: string[], total: number): BlocTotals {
  const blocs = new Map<string, number>(blocIds.map((b) => [b, 0]));
  let unassigned = 0;
  for (let k = 0; k < parties.length; k++) {
    const b = membership.get(parties[k]);
    if (b !== undefined && blocs.has(b)) blocs.set(b, (blocs.get(b) ?? 0) + row[k]);
    else unassigned += row[k];
  }
  return { blocs, unassigned, total };
}

export interface BlocLeader {
  bloc: string | null;
  tie: boolean;
  votes: number;
  share: number;
  runnerUp: string | null;
  runnerUpVotes: number;
  marginVotes: number;
  marginShare: number;
  unassigned: number;
  unassignedShare: number;
  /** True when unassigned parties together out-poll the leading bloc. */
  unassignedLargest: boolean;
}

export function blocLeader(t: BlocTotals): BlocLeader | null {
  if (!(t.total > 0)) return null;
  const entries = [...t.blocs.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0 || entries[0][1] <= 0) {
    return { bloc: null, tie: false, votes: 0, share: 0, runnerUp: null, runnerUpVotes: 0, marginVotes: 0, marginShare: 0, unassigned: t.unassigned, unassignedShare: t.unassigned / t.total, unassignedLargest: t.unassigned > 0 };
  }
  const [first, second] = entries;
  const tie = Boolean(second && second[1] === first[1]);
  const runnerUpVotes = second ? second[1] : 0;
  return {
    bloc: tie ? null : first[0],
    tie,
    votes: first[1],
    share: first[1] / t.total,
    runnerUp: second ? second[0] : null,
    runnerUpVotes,
    marginVotes: first[1] - runnerUpVotes,
    marginShare: (first[1] - runnerUpVotes) / t.total,
    unassigned: t.unassigned,
    unassignedShare: t.unassigned / t.total,
    unassignedLargest: t.unassigned > first[1],
  };
}

/* ------------------------------------------------------------------------ */
/* Proportional symbols                                                      */
/* ------------------------------------------------------------------------ */

/** Radius such that circle AREA is proportional to `value`: r = rMax·√(v/vMax).
 *  Values below the minimum visible radius are clamped (and flagged by callers). */
export function circleRadius(value: number, maxValue: number, maxRadius: number, minRadius = 0): number {
  if (!(value > 0) || !(maxValue > 0)) return 0;
  const r = maxRadius * Math.sqrt(value / maxValue);
  return Math.max(minRadius, r);
}

export function circleArea(radius: number): number {
  return Math.PI * radius * radius;
}

export interface ClusterInput {
  lng: number;
  lat: number;
  value: number;
  index: number;
}

export interface Cluster {
  lng: number;
  lat: number;
  value: number;
  members: number[];
}

/** Aggregate points on a square grid (cell size in degrees of latitude;
 *  longitude cells are widened by 1/cos(lat) so cells are square on the
 *  ground). Values are summed, so cluster circle area stays proportional to
 *  the total votes it represents. Position is the value-weighted centroid. */
export function clusterPoints(points: ClusterInput[], cellDeg: number): Cluster[] {
  if (cellDeg <= 0) return points.map((p) => ({ lng: p.lng, lat: p.lat, value: p.value, members: [p.index] }));
  const cells = new Map<string, { sx: number; sy: number; w: number; value: number; members: number[]; fx: number; fy: number }>();
  for (const p of points) {
    const lngCell = cellDeg / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
    const key = `${Math.floor(p.lng / lngCell)}:${Math.floor(p.lat / cellDeg)}`;
    let c = cells.get(key);
    if (!c) {
      c = { sx: 0, sy: 0, w: 0, value: 0, members: [], fx: p.lng, fy: p.lat };
      cells.set(key, c);
    }
    const w = Math.max(p.value, 0);
    c.sx += p.lng * w;
    c.sy += p.lat * w;
    c.w += w;
    c.value += p.value;
    c.members.push(p.index);
  }
  return [...cells.values()].map((c) => ({
    lng: c.w > 0 ? c.sx / c.w : c.fx,
    lat: c.w > 0 ? c.sy / c.w : c.fy,
    value: c.value,
    members: c.members,
  }));
}

/* ------------------------------------------------------------------------ */
/* Elections / timeline                                                      */
/* ------------------------------------------------------------------------ */

export function sortYears(years: Iterable<number>): number[] {
  return [...new Set(years)].filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
}

/** Step to the previous/next available election; null at either end. */
export function stepYear(years: number[], current: number, dir: -1 | 1): number | null {
  const sorted = sortYears(years);
  const i = sorted.indexOf(current);
  if (i < 0) return nearestYear(sorted, current);
  const j = i + dir;
  return j >= 0 && j < sorted.length ? sorted[j] : null;
}

/** Nearest available election to a requested year (ties resolve to the later one). */
export function nearestYear(years: number[], requested: number): number | null {
  const sorted = sortYears(years);
  if (sorted.length === 0) return null;
  let best = sorted[0];
  for (const y of sorted) if (Math.abs(y - requested) <= Math.abs(best - requested)) best = y;
  return best;
}

/* ------------------------------------------------------------------------ */
/* Historical matching                                                       */
/* ------------------------------------------------------------------------ */

const CONFIDENCE_ORDER: LinkConfidence[] = ["exact", "high", "address-inferred", "probable", "chained"];

export function confidenceRank(c: LinkConfidence): number {
  return CONFIDENCE_ORDER.indexOf(c);
}

export interface Comparable {
  index: number;
  confidence: LinkConfidence;
}

/** Site index in `targetYear` that is the same physical place as `stable`,
 *  provided the pairwise match is at least `minConfidence`. */
export function comparableSite(stable: StableSite | undefined, fromYear: number, targetYear: number, minConfidence: LinkConfidence = "high"): Comparable | null {
  if (!stable) return null;
  const idx = stable.years[String(targetYear)];
  if (idx === undefined || stable.years[String(fromYear)] === undefined) return null;
  if (fromYear === targetYear) return { index: idx, confidence: "exact" };
  const [a, b] = fromYear < targetYear ? [fromYear, targetYear] : [targetYear, fromYear];
  const conf = stable.confidence[`${a}-${b}`];
  if (!conf || confidenceRank(conf) > confidenceRank(minConfidence)) return null;
  return { index: idx, confidence: conf };
}

/** Change in vote share (fraction; 0.05 = +5 pp) between two observations.
 *  NaN when either observation has no valid votes. */
export function swing(votesNow: number, totalNow: number, votesThen: number, totalThen: number): number {
  const a = share(votesNow, totalNow);
  const b = share(votesThen, totalThen);
  return a - b;
}
