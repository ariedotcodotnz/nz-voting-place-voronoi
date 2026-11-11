/**
 * Visual encoding: turns (election data, map mode, settings) into a colour and
 * a numeric value for every polling place, plus a legend specification.
 * Independent of Google Maps and deck.gl so it can be unit-tested.
 */
import { blocLeader, blocTotals, comparableSite, leader, resolveVoteType, share, siteRow, splitAt, type YearData } from "./stats";
import { membershipFor, activeBlocs, type BlocOverrides } from "./blocs";
import { NO_DATA_HEX, TIE_HEX, UNASSIGNED_HEX, divergingInterpolator, divergingPoles, lighten, opposingPole, quantisedRGBA, sequentialInterpolator, toRGBA, type RGBA } from "./color";
import type { Manifest, PartyId, SitesFile, VoteType } from "./types";
import type { MapMode, Measure, SwingTarget } from "./url";

export interface EncodingSettings {
  mode: MapMode;
  party: PartyId;
  cmpA: PartyId;
  partyB: PartyId;
  measure: Measure;
  voteType: VoteType;
  scheme: string;
  topBloc: string;
  blocOverrides: BlocOverrides;
  swingTarget: SwingTarget;
  swingMinConfidence: "high" | "probable";
  scaleMode: "fixed" | "year" | "custom";
  scaleMax: number;
  shadeMargin: boolean;
  refYear: number | null;
  /** Party votes, or electorate (candidate) votes grouped by the candidate's party. */
  voteKind?: "party" | "candidate";
}

export type LegendSpec =
  | { kind: "categorical"; title: string; items: { key: string; label: string; color: string; count: number }[]; extras: { label: string; color: string; count: number }[] }
  | { kind: "sequential"; title: string; color: string; interpolator: (t: number) => string; domain: [number, number]; format: "pct" | "int"; extras: { label: string; color: string }[] }
  | { kind: "diverging"; title: string; interpolator: (t: number) => string; domain: [number, number]; format: "pp" | "int"; negLabel: string; posLabel: string; extras: { label: string; color: string }[] }
  | { kind: "circles"; title: string };

export interface Encoding {
  colors: RGBA[];
  values: Float64Array;
  legend: LegendSpec;
  voteType: VoteType | null;
  notes: string[];
  /** Matched site index in the reference election (swing mode). */
  refIndex?: Int32Array;
}

const NO_DATA = toRGBA(NO_DATA_HEX);
const TIE = toRGBA(TIE_HEX);
const UNASSIGNED = toRGBA(UNASSIGNED_HEX);
const NOT_COMPARABLE_HEX = "#E3E6E9";
const NOT_COMPARABLE = toRGBA(NOT_COMPARABLE_HEX);
const NOT_ON_BALLOT_HEX = "#D9DCDF";

export function effectiveMembership(manifest: Manifest, s: Pick<EncodingSettings, "scheme" | "topBloc" | "blocOverrides">, year: number) {
  const scheme = manifest.blocs.schemes.find((x) => x.id === s.scheme) ?? manifest.blocs.schemes[0];
  const overrides: BlocOverrides = {};
  for (const p of scheme.configurable ?? []) overrides[p] = s.topBloc;
  Object.assign(overrides, s.blocOverrides);
  return { scheme, membership: membershipFor(scheme, year, overrides) };
}

export function partyColor(manifest: Manifest, pid: PartyId): string {
  return manifest.parties[pid]?.color ?? "#8C8C8C";
}

export function partyLabel(manifest: Manifest, pid: PartyId): string {
  return manifest.parties[pid]?.short ?? pid;
}

function shareDomain(manifest: Manifest, yd: YearData, pid: PartyId, s: EncodingSettings): number {
  if (s.scaleMode === "custom") return Math.max(0.01, s.scaleMax);
  const raw = s.scaleMode === "fixed" ? manifest.partyScale[pid]?.share : yd.file.partyStats[pid]?.p98Share;
  return niceCeil(Math.max(0.02, raw ?? 0.5));
}

function votesDomain(manifest: Manifest, yd: YearData, pid: PartyId, s: EncodingSettings): number {
  const raw = s.scaleMode === "fixed" ? manifest.partyScale[pid]?.votes : yd.file.partyStats[pid]?.p98Votes;
  return niceCeil(Math.max(10, raw ?? 100));
}

/** Round a domain maximum up to a tidy value (0.0237 → 0.025, 1830 → 2000). */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= x - 1e-12) return m * mag;
  return 10 * mag;
}

function unavailable(n: number, title: string, note: string): Encoding {
  const colors: RGBA[] = new Array(n).fill(NO_DATA);
  return { colors, values: new Float64Array(n).fill(NaN), voteType: null, notes: [note], legend: { kind: "categorical", title, items: [], extras: [{ label: "Not available for this election", color: NO_DATA_HEX, count: n }] } };
}

function candidateGap(yd: YearData): string | null {
  const c = yd.file.candidates;
  if (!c) return `No electorate-vote data is available for ${yd.year}.`;
  if (!c.available) return `The ${yd.year} result files don't say which party each candidate stood for, so electorate votes can't be grouped by party. Candidate names and votes are shown in each polling place's details.`;
  return null;
}

/** Colour and value for every polling place. With voteKind "candidate", every
 *  mode uses electorate votes summed by the candidate's party; "split" compares
 *  a party's candidate vote with its party vote at the same polling place. */
export function encode(manifest: Manifest, yd: YearData, s: EncodingSettings, ref: YearData | null, sites: SitesFile | null): Encoding {
  if (s.mode === "split") return encodeSplit(manifest, yd, s);
  if (s.voteKind !== "candidate") return encodeView(manifest, yd, s, ref, sites);
  const gap = candidateGap(yd);
  if (gap || !yd.candidate) return unavailable(yd.n, `Electorate vote, ${yd.year}`, gap ?? "");
  if (s.mode === "swing" && ref && !ref.candidate) return unavailable(yd.n, `Electorate vote swing since ${ref.year}`, candidateGap(ref) ?? "");
  const enc = encodeView(manifest, yd.candidate, s, ref?.candidate ?? null, sites);
  if ("title" in enc.legend) enc.legend = { ...enc.legend, title: `${enc.legend.title} (electorate vote)` };
  enc.notes.push("Electorate votes are summed by the candidate's party. A polling place can record votes for more than one electorate's candidates.");
  return enc;
}

function encodeSplit(manifest: Manifest, yd: YearData, s: EncodingSettings): Encoding {
  const n = yd.n;
  const gap = candidateGap(yd);
  const label = partyLabel(manifest, s.party);
  if (gap || !yd.candidate) return unavailable(n, `${label}: candidate vs party vote`, gap ?? "");
  const notes: string[] = [];
  const vt = resolveVoteType(yd, s.voteType);
  if (vt === null) return unavailable(n, `${label}: candidate vs party vote`, `Advance votes were not reported by voting place in ${yd.year}.`);
  const base = partyColor(manifest, s.party);
  const interp = divergingInterpolator(opposingPole(base), base);
  const domain = s.scaleMode === "custom" ? s.scaleMax : 0.2;
  const scale = quantisedRGBA(interp, 256, -1, 1);
  const values = new Float64Array(n).fill(NaN);
  const colors: RGBA[] = new Array(n).fill(NO_DATA);
  const onBallot = yd.partyIndex.has(s.party) || yd.candidate.partyIndex.has(s.party);
  if (!onBallot) notes.push(`${label} did not stand in ${yd.year}.`);
  for (let i = 0; i < n; i++) {
    const v = splitAt(yd, i, s.party, vt).diff;
    if (!Number.isFinite(v)) continue;
    values[i] = v;
    colors[i] = scale(v / domain);
  }
  notes.push(`Positive where ${label}'s electorate candidates won a bigger share of the electorate vote than ${label} won of the party vote, at the same polling place. Some polling places record electorate votes for several electorates' candidates.`);
  return {
    colors,
    values,
    voteType: vt,
    notes,
    legend: { kind: "diverging", title: `${label}: candidate vs party vote, ${yd.year}`, interpolator: interp, domain: [-domain, domain], format: "pp", negLabel: "Candidate behind party", posLabel: "Candidate ahead of party", extras: [{ label: "No votes recorded", color: NO_DATA_HEX }] },
  };
}

function encodeView(manifest: Manifest, yd: YearData, s: EncodingSettings, ref: YearData | null, sites: SitesFile | null): Encoding {
  const n = yd.n;
  const values = new Float64Array(n).fill(NaN);
  const colors: RGBA[] = new Array(n).fill(NO_DATA);
  const notes: string[] = [];
  let vt = resolveVoteType(yd, s.voteType);
  if (s.mode === "swing" && ref && (!yd.hasAdvance || !ref.hasAdvance) && vt !== "eday") {
    vt = "eday";
    notes.push(`Advance votes were not reported by voting place in ${!ref.hasAdvance ? ref.year : yd.year}, so this swing compares election-day votes only.`);
  }
  if (vt === null) {
    notes.push(`Advance votes were not reported by voting place in ${yd.year}.`);
    return { colors, values, voteType: null, notes, legend: { kind: "categorical", title: "No advance-vote data", items: [], extras: [{ label: "Not reported by voting place", color: NO_DATA_HEX, count: n }] } };
  }
  if (!yd.hasAdvance && s.voteType === "all") notes.push(`${yd.year}: advance votes were reported only as electorate totals, so polling places show election-day votes.`);

  switch (s.mode) {
    case "winner":
    case "circles": {
      const counts = new Map<number, number>();
      let ties = 0;
      let none = 0;
      const partyRGBA = yd.parties.map((p) => toRGBA(partyColor(manifest, p)));
      for (let i = 0; i < n; i++) {
        const row = siteRow(yd, i, vt);
        const L = row ? leader(row.votes, row.total) : null;
        if (!L) {
          none++;
          continue;
        }
        values[i] = L.share;
        if (L.tie) {
          ties++;
          colors[i] = TIE;
          continue;
        }
        counts.set(L.index, (counts.get(L.index) ?? 0) + 1);
        colors[i] = s.shadeMargin ? toRGBA(lighten(partyColor(manifest, yd.parties[L.index]), 0.65 * (1 - Math.min(1, L.marginShare / 0.3)))) : partyRGBA[L.index];
      }
      const items = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, c]) => ({ key: yd.parties[k], label: partyLabel(manifest, yd.parties[k]), color: partyColor(manifest, yd.parties[k]), count: c }));
      const extras = [];
      if (ties) extras.push({ label: "Tied for first", color: TIE_HEX, count: ties });
      if (none) extras.push({ label: "No valid votes recorded", color: NO_DATA_HEX, count: none });
      return { colors, values, voteType: vt, notes, legend: s.mode === "circles" ? { kind: "circles", title: "Proportional circles" } : { kind: "categorical", title: s.shadeMargin ? "Leading party (lighter = narrower lead)" : "Leading party", items, extras } };
    }
    case "bloc": {
      const { scheme, membership } = effectiveMembership(manifest, s, yd.year);
      const blocIds = activeBlocs(scheme, membership, yd.parties, manifest.blocs);
      const counts = new Map<string, number>();
      let ties = 0;
      let none = 0;
      for (let i = 0; i < n; i++) {
        const row = siteRow(yd, i, vt);
        if (!row || row.total <= 0) {
          none++;
          continue;
        }
        const BL = blocLeader(blocTotals(row.votes, yd.parties, membership, blocIds, row.total));
        if (!BL || (!BL.bloc && !BL.tie)) {
          none++;
          colors[i] = UNASSIGNED;
          continue;
        }
        values[i] = BL.share;
        if (BL.tie || !BL.bloc) {
          ties++;
          colors[i] = TIE;
          continue;
        }
        counts.set(BL.bloc, (counts.get(BL.bloc) ?? 0) + 1);
        const hex = manifest.blocs.blocs[BL.bloc]?.color ?? "#888";
        colors[i] = toRGBA(s.shadeMargin ? lighten(hex, 0.65 * (1 - Math.min(1, BL.marginShare / 0.3))) : hex);
      }
      const items = blocIds.map((b) => ({ key: b, label: manifest.blocs.blocs[b].label, color: manifest.blocs.blocs[b].color, count: counts.get(b) ?? 0 }));
      const extras = [];
      if (ties) extras.push({ label: "Blocs tied", color: TIE_HEX, count: ties });
      if (none) extras.push({ label: "No valid votes recorded", color: NO_DATA_HEX, count: none });
      return { colors, values, voteType: vt, notes, legend: { kind: "categorical", title: `Strongest bloc, ${scheme.label.replace("Core blocs: ", "")}`, items, extras } };
    }
    case "party": {
      const k = yd.partyIndex.get(s.party);
      const col = partyColor(manifest, s.party);
      const interp = sequentialInterpolator(col);
      if (k === undefined) {
        notes.push(`${partyLabel(manifest, s.party)} did not contest the ${yd.year} party vote.`);
        const c = toRGBA(NOT_ON_BALLOT_HEX);
        colors.fill(c);
        return { colors, values, voteType: vt, notes, legend: { kind: "sequential", title: `${partyLabel(manifest, s.party)}: not on the ${yd.year} ballot`, color: col, interpolator: interp, domain: [0, 1], format: "pct", extras: [{ label: "Not on the ballot", color: NOT_ON_BALLOT_HEX }] } };
      }
      const max = s.measure === "share" ? shareDomain(manifest, yd, s.party, s) : votesDomain(manifest, yd, s.party, s);
      const scale = s.measure === "share" ? quantisedRGBA(interp, 255, 0, 1) : quantisedRGBA(interp, 255, 0, 1);
      for (let i = 0; i < n; i++) {
        const row = siteRow(yd, i, vt);
        if (!row || row.total <= 0) continue;
        const v = s.measure === "share" ? share(row.votes[k], row.total) : row.votes[k];
        values[i] = v;
        const t = s.measure === "share" ? v / max : Math.sqrt(v / max);
        colors[i] = scale(Math.min(1, t));
      }
      if (s.measure === "votes") notes.push("Vote counts on filled areas emphasise busy polling places regardless of their size. Proportional circles show counts more faithfully.");
      return {
        colors,
        values,
        voteType: vt,
        notes,
        legend: {
          kind: "sequential",
          title: s.measure === "share" ? `${partyLabel(manifest, s.party)} party-vote share` : `${partyLabel(manifest, s.party)} party votes (square-root scale)`,
          color: col,
          interpolator: s.measure === "share" ? interp : (t: number) => interp(Math.sqrt(t)),
          domain: [0, max],
          format: s.measure === "share" ? "pct" : "int",
          extras: [{ label: "No valid votes recorded", color: NO_DATA_HEX }],
        },
      };
    }
    case "compare": {
      const ka = yd.partyIndex.get(s.cmpA);
      const kb = yd.partyIndex.get(s.partyB);
      const ca = partyColor(manifest, s.cmpA);
      const cb = partyColor(manifest, s.partyB);
      const poles = divergingPoles(ca, cb);
      // Positive t = A ahead.
      const interp = divergingInterpolator(poles.b, poles.a);
      const domain = s.measure === "share" ? (s.scaleMode === "custom" ? s.scaleMax : 0.5) : niceCeil(Math.max(votesDomain(manifest, yd, s.cmpA, s), votesDomain(manifest, yd, s.partyB, s)) / 2);
      const scale = quantisedRGBA(interp, 256, -1, 1);
      if (poles.fallback) notes.push(`${partyLabel(manifest, s.cmpA)} and ${partyLabel(manifest, s.partyB)} have similar colours, so purple and orange are used for this comparison.`);
      for (const [k, p] of [[ka, s.cmpA], [kb, s.partyB]] as const) if (k === undefined) notes.push(`${partyLabel(manifest, p)} did not contest the ${yd.year} party vote; it counts as zero here.`);
      for (let i = 0; i < n; i++) {
        const row = siteRow(yd, i, vt);
        if (!row || row.total <= 0) continue;
        const a = ka === undefined ? 0 : row.votes[ka];
        const b = kb === undefined ? 0 : row.votes[kb];
        const v = s.measure === "share" ? (a - b) / row.total : a - b;
        values[i] = v;
        colors[i] = scale(v / domain);
      }
      return {
        colors,
        values,
        voteType: vt,
        notes,
        legend: { kind: "diverging", title: `${partyLabel(manifest, s.cmpA)} vs ${partyLabel(manifest, s.partyB)}`, interpolator: (t) => interp(t), domain: [-domain, domain], format: s.measure === "share" ? "pp" : "int", negLabel: `${partyLabel(manifest, s.partyB)} ahead`, posLabel: `${partyLabel(manifest, s.cmpA)} ahead`, extras: [{ label: "No valid votes recorded", color: NO_DATA_HEX }] },
      };
    }
    case "split":
      return encodeSplit(manifest, yd, s);
    case "swing": {
      const target = s.swingTarget;
      const label = target.kind === "party" ? partyLabel(manifest, target.id) : (manifest.blocs.blocs[target.id]?.label ?? target.id);
      const baseHex = target.kind === "party" ? partyColor(manifest, target.id) : (manifest.blocs.blocs[target.id]?.color ?? "#555");
      const interp = divergingInterpolator(opposingPole(baseHex), baseHex);
      const domain = s.scaleMode === "custom" ? s.scaleMax : 0.2;
      const scale = quantisedRGBA(interp, 256, -1, 1);
      const refIndex = new Int32Array(n).fill(-1);
      if (!ref || !sites || ref.year === yd.year) {
        notes.push(ref?.year === yd.year ? "Choose a different comparison election to see a swing." : "Choose a comparison election.");
        colors.fill(NOT_COMPARABLE);
        return { colors, values, voteType: vt, notes, refIndex, legend: { kind: "diverging", title: `Change in ${label} share`, interpolator: interp, domain: [-domain, domain], format: "pp", negLabel: "Lost support", posLabel: "Gained support", extras: [{ label: "No comparable polling place", color: NOT_COMPARABLE_HEX }] } };
      }
      const valueAt = (d: YearData, i: number): number => {
        const row = siteRow(d, i, vt as VoteType);
        if (!row || row.total <= 0) return NaN;
        if (target.kind === "party") {
          const k = d.partyIndex.get(target.id);
          return k === undefined ? 0 : row.votes[k] / row.total;
        }
        const { scheme, membership } = effectiveMembership(manifest, s, d.year);
        const t = blocTotals(row.votes, d.parties, membership, activeBlocs(scheme, membership, d.parties, manifest.blocs), row.total);
        return (t.blocs.get(target.id) ?? 0) / row.total;
      };
      let comparable = 0;
      for (let i = 0; i < n; i++) {
        const sid = yd.file.sites.id[i];
        const c = comparableSite(sites.sites[sid], yd.year, ref.year, s.swingMinConfidence);
        if (!c) {
          colors[i] = NOT_COMPARABLE;
          continue;
        }
        const v = valueAt(yd, i) - valueAt(ref, c.index);
        if (!Number.isFinite(v)) {
          colors[i] = NO_DATA;
          continue;
        }
        refIndex[i] = c.index;
        values[i] = v;
        colors[i] = scale(v / domain);
        comparable++;
      }
      notes.push(`${comparable.toLocaleString("en-NZ")} of ${n.toLocaleString("en-NZ")} polling places can be matched to the same location in ${ref.year}. Others are shown pale and are not treated as a local swing.`);
      return {
        colors,
        values,
        voteType: vt,
        notes,
        refIndex,
        legend: { kind: "diverging", title: `Change in ${label} share, ${ref.year} → ${yd.year}`, interpolator: interp, domain: [-domain, domain], format: "pp", negLabel: "Lost support", posLabel: "Gained support", extras: [{ label: "No comparable polling place", color: NOT_COMPARABLE_HEX }, { label: "No valid votes recorded", color: NO_DATA_HEX }] },
      };
    }
  }
}
