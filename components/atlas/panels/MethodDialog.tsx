"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { keys, loadReport, useResource } from "@/lib/atlas/data";
import { useAtlas, useControls } from "@/lib/atlas/store";
import { describeBlocs } from "@/lib/atlas/blocs";
import { effectiveMembership } from "@/lib/atlas/encoding";
import { fmtInt, fmtPct } from "@/lib/atlas/format";
import type { Manifest } from "@/lib/atlas/types";
import { Swatch } from "./common";
import { analyticsEnabled } from "@/lib/analytics";

const P = ({ children }: { children: React.ReactNode }) => <p className="text-[13.5px] leading-relaxed text-ink-2">{children}</p>;
const H = ({ children }: { children: React.ReactNode }) => <h3 className="mt-4 mb-1 text-[14px] font-semibold text-ink first:mt-0">{children}</h3>;

function Method({ manifest }: { manifest: Manifest }) {
  return (
    <div className="max-w-[68ch]">
      <H>What the colours show</H>
      <P>
        Each shape is coloured by the party votes counted at one polling place. The data are the Electoral Commission’s results by voting place for each general election. Votes are counted where they were cast, which is often not where the voter lives:
        many people vote near work, at a shopping centre, or in advance.
      </P>
      <H>Estimated catchments</H>
      <P>
        New Zealand has no official precincts around polling places, so the map draws an estimated catchment for each one: the land that is nearer to it than to any other polling place in the same election. The default method assigns whole Stats NZ
        meshblocks to their nearest polling place, so boundaries follow streets and rivers and lakes stay as water. The raw Voronoi method uses straight nearest-point lines clipped to the coastline. Either way, the shapes are mapping estimates. They
        are not official voting areas, and they do not mean that the people living inside one voted there.
      </P>
      <P>Polling places move between elections, so every election has its own catchments. Large rural catchments look important on a map even when few votes were cast in them; the proportional circles and equal-dot views correct for this.</P>
      <H>Which votes are included</H>
      <P>
        From 2017 the results report advance votes by venue, so “All at venue” combines advance and election-day votes. Before 2017 advance votes were published only as electorate totals, so polling places show election-day votes. Special votes,
        overseas votes, mobile-team votes and venues that could not be located are kept in electorate and national totals but cannot be drawn on the map.
      </P>
      <H>Party vote and electorate vote</H>
      <P>
        Every voter casts a party vote and an electorate (candidate) vote. The “Electorate vote” switch maps candidate votes, summed by each candidate’s party, because a
        polling place can take votes for several electorates’ candidates. “Split” shows how far a party’s candidates ran ahead of or behind its party vote at the same
        polling place. Candidates’ parties come from the results files; where a file doesn’t state them (the 2026 preliminary results), they are not guessed.
      </P>
      <H>Comparing elections</H>
      <P>
        Swing is shown only where the same physical polling place can be matched in both elections, by location and venue name. Everything else is shown pale rather than as a local swing, because a change in which polling places existed is not a
        change in how people voted. When either election predates venue-level advance results, the swing compares election-day votes only.
      </P>
      <P>When the timeline plays, the map crossfades between elections as a visual transition only. Every number shown belongs to an actual election; nothing is interpolated between them.</P>
      <H>Preliminary results</H>
      <P>Results labelled preliminary come from election-night counts. They exclude special votes and may change in the official count.</P>
      <H>Sources</H>
      <P>
        Election results and voting-place coordinates: Electoral Commission (elections.nz). Meshblocks: Stats NZ Meshblock 2026. Coastline: LINZ NZ Coastlines and Islands Polygons (Topo 1:50k). Basemap: Google Maps. Data processed on{" "}
        {new Date(manifest.generatedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })}.
      </P>
      {analyticsEnabled && (
        <>
          <H>Privacy</H>
          <P>
            This site uses Microsoft Clarity to see how the map is used, through clicks, scrolling and session replays, so it can be improved. Clarity uses cookies,
            and the data is processed by Microsoft under its{" "}
            <a href="https://privacy.microsoft.com/privacystatement" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
              privacy statement
            </a>
            . What you type into search is masked and never recorded. This site has no accounts and does not collect your name or contact details.
          </P>
        </>
      )}
    </div>
  );
}

/** A share of all valid votes; tiny non-zero shares are not rounded down to 0%. */
function share(n: number, total: number): string {
  if (n <= 0 || total <= 0) return "0%";
  const x = n / total;
  return x < 0.001 ? "under 0.1%" : fmtPct(x);
}

/** "No coordinates for 'Hall, 1 Main Road' (Coromandel, election_day); …" as its parts. */
function unlocatedRow(message: string): { place: string; electorate: string; advance: boolean } | null {
  const m = /^No coordinates for (['"])(.+)\1 \((.+), (\w+)\);/.exec(message);
  return m ? { place: m[2], electorate: m[3], advance: m[4] === "advance" } : null;
}

function Coverage({ manifest }: { manifest: Manifest }) {
  const res = useResource(keys.report, () => loadReport(manifest).promise);
  const r = res?.value;
  if (!r) return <P>Loading…</P>;
  const rows = r.elections.map((e) => {
    const total = e.stats.valid_votes_total;
    const notFound = e.stats.valid_votes_by_nongeo_category.unmatched ?? 0;
    return { ...e, total, notFound, noPlace: total - e.stats.valid_votes_mapped - notFound };
  });
  const advanceTotals = rows.filter((e) => (e.stats.valid_votes_by_nongeo_category.advance_aggregate ?? 0) > 0).map((e) => e.year);
  const preliminary = rows.filter((e) => e.status === "preliminary").map((e) => e.year);
  // Elections with no coordinate file of their own are located from other years' files.
  const borrowed = rows.filter((e) => e.stats.coordinate_records === 0);
  return (
    <div className="flex max-w-[68ch] flex-col gap-4">
      <P>
        Every figure on the map is the Electoral Commission’s official count for a polling place. Nothing is estimated, modelled or adjusted. The table shows how much of each election’s vote was cast at a polling place and so can be drawn on a
        map.
      </P>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-rule text-left text-ink-3">
              <th className="py-1.5 pr-3 font-medium">Election</th>
              <th className="py-1.5 pr-3 text-right font-medium">Polling places</th>
              <th className="py-1.5 pr-3 text-right font-medium">Valid votes</th>
              <th className="py-1.5 pr-3 text-right font-medium">On the map</th>
              <th className="py-1.5 pr-3 text-right font-medium">No single place</th>
              <th className="py-1.5 text-right font-medium">Place not found</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.year} className="border-b border-rule/70">
                <td className="py-1.5 pr-3 font-medium text-ink">
                  {e.year}
                  {e.status === "preliminary" && <span className="ml-1 font-normal text-ink-3">preliminary</span>}
                </td>
                <td className="num py-1.5 pr-3 text-right">{fmtInt(e.stats.sites)}</td>
                <td className="num py-1.5 pr-3 text-right">{fmtInt(e.total)}</td>
                <td className="num py-1.5 pr-3 text-right text-ink">{fmtPct(e.stats.mapped_share)}</td>
                <td className="num py-1.5 pr-3 text-right">{share(e.noPlace, e.total)}</td>
                <td className="num py-1.5 text-right">{share(e.notFound, e.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <H>No single place</H>
        <P>
          Special votes, overseas votes, votes collected by mobile teams in hospitals and rest homes, and places with fewer than six votes are published as totals for a whole electorate. They are included in every national and electorate figure
          on this site, but have no location to draw.
          {advanceTotals.length > 0 &&
            ` In ${advanceTotals[0]}–${advanceTotals[advanceTotals.length - 1]} advance votes were also published this way, which is why less of those elections is on the map.`}
          {preliminary.length > 0 && ` The ${preliminary.join(" and ")} count is preliminary and does not yet include special votes, so its share will fall once they are added.`}
        </P>
        <H>Place not found</H>
        <P>
          A polling place is drawn at the coordinates the Commission publishes for it. Where a place is missing from those files it is left off the map, and its votes stay in the electorate and national totals.
          {borrowed.map((e) => {
            const from = [...new Set(Object.keys(e.stats.match_methods).map((k) => /inferred-from-(\d+)/.exec(k)?.[1]).filter(Boolean))].sort().slice(0, 2);
            return ` There is no coordinate file for ${e.year}, so its polling places were located by matching their addresses to the ${from.join(" and ")} files; ${share(e.notFound, e.total)} of its votes were at places that could not be matched.`;
          })}
        </P>
      </div>
      {rows.map((e) =>
        e.unmatched.length ? (
          <details key={e.year} className="border-t border-rule pt-2">
            <summary className="cursor-pointer text-[13px] text-ink-2 hover:text-ink">
              Places not found in {e.year}
              {(e.stats.match_methods.unmatched ?? 0) > e.unmatched.length && ` (the ${e.unmatched.length} largest)`}
            </summary>
            <table className="mt-2 w-full border-collapse text-[12px] text-ink-2">
              <tbody>
                {e.unmatched.map((u, k) => {
                  const row = unlocatedRow(u.message);
                  return (
                    <tr key={k} className="border-b border-rule/70 align-top">
                      <td className="py-1 pr-3">{row ? row.place : u.message}</td>
                      <td className="py-1 pr-3 text-ink-3">
                        {row?.electorate}
                        {row?.advance && ", advance"}
                      </td>
                      <td className="num py-1 text-right whitespace-nowrap">{fmtInt(u.votes)} votes</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        ) : null,
      )}
      {r.excludedIslands.length > 0 && (
        <P>
          Uninhabited outlying islands (
          {r.excludedIslands
            .slice(0, 3)
            .map((x) => x.name)
            .join(", ")}{" "}
          and others) have no polling place nearby and are left blank.
        </P>
      )}
    </div>
  );
}

export function BlocComposition({ manifest }: { manifest: Manifest }) {
  const s = useControls();
  const year = s.year ?? manifest.elections[manifest.elections.length - 1].year;
  const el = manifest.elections.find((e) => e.year === year)!;
  const { scheme, membership } = effectiveMembership(manifest, s, year);
  const desc = useMemo(() => describeBlocs(scheme, year, el.parties, membership, manifest.blocs), [scheme, year, el.parties, membership, manifest.blocs]);
  const blocChoices = Object.keys(manifest.blocs.blocs);
  const setParty = (pid: string, v: string) => {
    const next = { ...s.blocOverrides };
    const schemeDefault = new Map(effectiveMembership(manifest, { ...s, blocOverrides: {} }, year).membership).get(pid) ?? "-";
    if (v === schemeDefault) delete next[pid];
    else next[pid] = v === "-" ? null : v;
    s.set({ blocOverrides: next });
  };
  return (
    <div className="flex flex-col gap-3">
      <P>{scheme.description}</P>
      <P>Bloc membership is a modelling assumption for comparison, not a statement about any party’s alignment. Change any party’s bloc below; your changes apply to every election and are saved in the link.</P>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-rule text-left text-ink-3">
              <th className="py-1.5 pr-3 font-medium">Party on the {year} ballot</th>
              <th className="py-1.5 pr-3 text-right font-medium">National vote</th>
              <th className="py-1.5 font-medium">Bloc</th>
            </tr>
          </thead>
          <tbody>
            {[...el.parties]
              .sort((a, b) => (el.national[b] ?? 0) - (el.national[a] ?? 0))
              .map((pid) => {
                const b = membership.get(pid);
                const reason = desc.unassigned.find((u) => u.party === pid)?.reason;
                return (
                  <tr key={pid} className="border-b border-rule/70 align-top">
                    <td className="py-1.5 pr-3">
                      <span className="flex items-center gap-1.5 text-ink">
                        <Swatch color={manifest.parties[pid]?.color ?? "#888"} ring /> {manifest.parties[pid]?.short ?? pid}
                      </span>
                      {reason && <span className="block text-[11.5px] text-ink-3">{reason}</span>}
                    </td>
                    <td className="num py-1.5 pr-3 text-right text-ink-2">{fmtPct((el.national[pid] ?? 0) / el.nationalValid)}</td>
                    <td className="py-1.5">
                      <Select value={b ?? "-"} onValueChange={(v) => setParty(pid, v)}>
                        <SelectTrigger size="sm" className="w-40" aria-label={`Bloc for ${manifest.parties[pid]?.short ?? pid}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="-">Unassigned</SelectItem>
                          {blocChoices.map((c) => (
                            <SelectItem key={c} value={c}>
                              {manifest.blocs.blocs[c].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {Object.keys(s.blocOverrides).length > 0 && (
        <button type="button" onClick={() => s.set({ blocOverrides: {} })} className="self-start text-[12.5px] text-ink-2 underline underline-offset-2 hover:text-ink">
          Reset to the {scheme.label.toLowerCase()} defaults
        </button>
      )}
    </div>
  );
}

export function MethodDialog({ manifest }: { manifest: Manifest }) {
  const panel = useAtlas((s) => s.panel);
  const set = useAtlas((s) => s.set);
  const open = panel === "method" || panel === "blocs";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && set({ panel: null })}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{panel === "blocs" ? "Political blocs" : "Information"}</DialogTitle>
          <DialogDescription>{panel === "blocs" ? "Which parties are combined in each bloc, and why." : "What the map shows, how it was made, and what it cannot tell you."}</DialogDescription>
        </DialogHeader>
        {panel === "blocs" ? (
          <BlocComposition manifest={manifest} />
        ) : (
          <Tabs defaultValue="method">
            <TabsList>
              <TabsTrigger value="method">Method</TabsTrigger>
              <TabsTrigger value="quality">Coverage</TabsTrigger>
            </TabsList>
            <TabsContent value="method" className="pt-3">
              <Method manifest={manifest} />
            </TabsContent>
            <TabsContent value="quality" className="pt-3">
              <Coverage manifest={manifest} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
