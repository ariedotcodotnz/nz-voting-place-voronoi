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
        Each shape is coloured by the party votes counted at one polling place. The data are the Electoral Commission’s results by voting place for each general election. Votes are counted where they were cast, which is often not where the voter lives —
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

function Quality({ manifest }: { manifest: Manifest }) {
  const res = useResource(keys.report, () => loadReport(manifest).promise);
  const r = res?.value;
  if (!r) return <P>Loading the processing report…</P>;
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-rule text-left text-ink-3">
              <th className="py-1.5 pr-3 font-medium">Election</th>
              <th className="py-1.5 pr-3 text-right font-medium">Polling places</th>
              <th className="py-1.5 pr-3 text-right font-medium">Valid party votes</th>
              <th className="py-1.5 pr-3 text-right font-medium">Mapped</th>
              <th className="py-1.5 text-right font-medium">Venue votes not located</th>
            </tr>
          </thead>
          <tbody>
            {r.elections.map((e) => (
              <tr key={e.year} className="border-b border-rule/70">
                <td className="py-1.5 pr-3 font-medium text-ink">
                  {e.year}
                  {e.status === "preliminary" && <span className="ml-1 text-ink-3">(preliminary)</span>}
                </td>
                <td className="num py-1.5 pr-3 text-right">{fmtInt(e.stats.sites)}</td>
                <td className="num py-1.5 pr-3 text-right">{fmtInt(e.stats.valid_votes_total)}</td>
                <td className="num py-1.5 pr-3 text-right">{fmtPct(e.stats.mapped_share)}</td>
                <td className="num py-1.5 text-right">{fmtInt(e.stats.valid_votes_by_nongeo_category.unmatched ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>
        “Mapped” is the share of valid party votes cast at a located polling place. The remainder are special, overseas, aggregated advance and mobile-team votes, which have no single location. {fmtInt(r.linking.stableLocations)} distinct physical
        locations were identified across all elections.
      </P>
      {r.elections.map((e) =>
        e.notes.length || e.unmatched.length ? (
          <details key={e.year} className="rounded-lg border border-rule px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-ink">
              {e.year}: {e.unmatched.length ? `${e.unmatched.length}${e.unmatched.length === 40 ? "+" : ""} unlocated venue rows` : "notes"}
            </summary>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[12px] text-ink-2">
              {e.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {e.unmatched.map((u, k) => (
                <li key={k}>{u.message}</li>
              ))}
            </ul>
          </details>
        ) : null,
      )}
      {r.excludedIslands.length > 0 && <P>Remote islands with no polling place within 150 km ({r.excludedIslands.slice(0, 5).map((x) => x.name).join(", ")}) are not part of any catchment.</P>}
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
          <DialogTitle>{panel === "blocs" ? "Political blocs" : "How to read this map"}</DialogTitle>
          <DialogDescription>{panel === "blocs" ? "Which parties are combined in each bloc, and why." : "What the map shows, how it was made, and what it cannot tell you."}</DialogDescription>
        </DialogHeader>
        {panel === "blocs" ? (
          <BlocComposition manifest={manifest} />
        ) : (
          <Tabs defaultValue="method">
            <TabsList>
              <TabsTrigger value="method">Method</TabsTrigger>
              <TabsTrigger value="quality">Data quality</TabsTrigger>
            </TabsList>
            <TabsContent value="method" className="pt-3">
              <Method manifest={manifest} />
            </TabsContent>
            <TabsContent value="quality" className="pt-3">
              <Quality manifest={manifest} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
