/**
 * Electorate (candidate) vote helpers for display.
 */
import type { PartyId, ResultsFile, VoteType } from "./types";

/** "SWARBRICK, Chlöe Charlotte" → "Chlöe Charlotte Swarbrick"; "O'CONNELL, Kevin" → "Kevin O'Connell". */
export function formatCandidateName(raw: string): string {
  const m = /^\s*([^,]+),\s*(.+?)\s*$/.exec(raw);
  if (!m) return raw.trim();
  const [, surname, given] = m;
  const fixed = surname === surname.toUpperCase() ? surname.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase()) : surname;
  return `${given} ${fixed}`.trim();
}

export interface SiteCandidate {
  name: string;
  party: PartyId | null;
  votes: number;
}

export interface SiteElectorateCandidates {
  electorateIndex: number;
  electorate: string;
  maori: boolean;
  total: number;
  candidates: SiteCandidate[];
}

/** Candidate votes recorded at one polling place, per electorate (largest first). */
export function siteCandidates(file: ResultsFile, i: number, vt: VoteType): SiteElectorateCandidates[] {
  const c = file.candidates;
  if (!c) return [];
  return (c.sites[i] ?? [])
    .map(([ei, ed, adv]) => {
      const el = c.electorates[ei];
      if (!el) return null;
      const votes = el.names.map((_, k) => (vt === "eday" ? ed[k] : vt === "advance" ? (adv?.[k] ?? 0) : ed[k] + (adv?.[k] ?? 0)));
      const candidates = el.names.map((name, k) => ({ name: formatCandidateName(name), party: el.parties[k], votes: votes[k] })).sort((a, b) => b.votes - a.votes);
      return { electorateIndex: ei, electorate: file.electorates[ei]?.name ?? "", maori: file.electorates[ei]?.kind === "maori", total: votes.reduce((s, v) => s + v, 0), candidates };
    })
    .filter((x): x is SiteElectorateCandidates => x !== null && x.total > 0)
    .sort((a, b) => b.total - a.total);
}
