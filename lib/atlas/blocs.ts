import type { BlocConfig, BlocId, BlocScheme, PartyId } from "./types";

/** User overrides: party -> bloc id, or null to force the party to 'unassigned'. */
export type BlocOverrides = Record<PartyId, BlocId | null>;

function inRange(year: number, from?: number, to?: number): boolean {
  return (from === undefined || year >= from) && (to === undefined || year <= to);
}

/** Party → bloc membership for one election year. Later entries in the
 *  scheme win over earlier ones; user overrides win over the scheme. */
export function membershipFor(scheme: BlocScheme, year: number, overrides: BlocOverrides = {}): Map<PartyId, BlocId> {
  const m = new Map<PartyId, BlocId>();
  for (const entry of scheme.membership) {
    if (inRange(year, entry.from, entry.to)) m.set(entry.party, entry.bloc);
  }
  for (const [party, bloc] of Object.entries(overrides)) {
    if (bloc === null) m.delete(party);
    else m.set(party, bloc);
  }
  return m;
}

/** Blocs shown for a scheme: its declared blocs plus any bloc introduced by an
 *  override, minus blocs with no member parties among `parties`. */
export function activeBlocs(scheme: BlocScheme, membership: Map<PartyId, BlocId>, parties: PartyId[], config: BlocConfig): BlocId[] {
  const used = new Set<BlocId>();
  for (const p of parties) {
    const b = membership.get(p);
    if (b && config.blocs[b]) used.add(b);
  }
  const order = [...scheme.blocs, ...Object.keys(config.blocs).filter((b) => !scheme.blocs.includes(b))];
  return order.filter((b) => used.has(b));
}

export interface BlocDescription {
  blocs: { id: BlocId; parties: PartyId[] }[];
  unassigned: { party: PartyId; reason: string | null }[];
}

/** Human-readable composition of each bloc for the parties on the ballot in `year`. */
export function describeBlocs(scheme: BlocScheme, year: number, parties: PartyId[], membership: Map<PartyId, BlocId>, config: BlocConfig): BlocDescription {
  const ids = activeBlocs(scheme, membership, parties, config);
  const blocs = ids.map((id) => ({ id, parties: parties.filter((p) => membership.get(p) === id) }));
  const unassigned = parties
    .filter((p) => !membership.has(p) || !ids.includes(membership.get(p) as BlocId))
    .map((party) => {
      const why = scheme.explicitlyUnassigned.find((u) => u.party === party && inRange(year, u.from, u.to));
      return { party, reason: why?.reason ?? null };
    });
  return { blocs, unassigned };
}
