"use client";

import { useEffect, useMemo, useState } from "react";
import { Crosshair, Link2, X, Check } from "lucide-react";
import { PartyBars } from "../charts/PartyBars";
import { HistoryChart, type HistoryPoint } from "../charts/HistoryChart";
import { keys, loadSites, loadYear, peek, useResource, useResourceVersion } from "@/lib/atlas/data";
import { useAtlas } from "@/lib/atlas/store";
import { leader, resolveVoteType, siteRow, splitAt, viewFor, type YearData } from "@/lib/atlas/stats";
import { formatCandidateName, siteCandidates } from "@/lib/atlas/candidates";
import { partyColor, partyLabel } from "@/lib/atlas/encoding";
import { fmtInt, fmtPct, fmtPP } from "@/lib/atlas/format";
import type { Manifest, VoteType } from "@/lib/atlas/types";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import { Swatch } from "./common";

const TYPE_LABEL: Record<string, string> = { AE: "Advance and election-day voting place", E: "Election-day voting place", A: "Advance voting place" };
const LOCATED: Record<string, string> = {
  exact: "Location from the Electoral Commission’s coordinate file.",
  fuzzy: "Location matched to the coordinate file by a near-identical address.",
  inferred: "Location inferred from another election’s coordinate file by address.",
};

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-t border-rule px-4 py-3", className)}>
      <h3 className="mb-2 text-[12px] font-semibold text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

export function DetailsPanel({ manifest }: { manifest: Manifest }) {
  useResourceVersion();
  const selected = useAtlas((s) => s.selected);
  const year = useAtlas((s) => s.shownYear ?? s.year);
  const voteType = useAtlas((s) => s.voteType);
  const voteKind = useAtlas((s) => s.voteKind);
  const mode = useAtlas((s) => s.mode);
  const historyKind = voteKind === "candidate" && mode !== "split" ? "candidate" : "party";
  const boundary = useAtlas((s) => s.boundary) ?? manifest.boundary.default;
  const select = useAtlas((s) => s.select);
  const requestFlyTo = useAtlas((s) => s.requestFlyTo);
  const sitesRes = useResource(selected ? keys.sites : null, () => loadSites(manifest).promise);
  const stable = selected ? sitesRes?.value?.sites[selected] : undefined;
  const [copied, setCopied] = useState(false);

  // Load every election this location appears in (for the history chart).
  useEffect(() => {
    if (!stable) return;
    for (const y of Object.keys(stable.years)) loadYear(manifest, Number(y));
  }, [manifest, stable]);

  const yd = year !== null ? peek<YearData>(keys.year(year)) : undefined;
  const i = selected && yd ? yd.stableIndex.get(selected) : undefined;

  const loadedSig = manifest.elections.map((e) => (peek(keys.year(e.year)) ? "1" : "0")).join("");
  const history = useMemo((): HistoryPoint[] | null => {
    if (!stable || year === null) return null;
    return manifest.elections.map((e) => {
      const idx = stable.years[String(e.year)];
      const d = viewFor(peek<YearData>(keys.year(e.year)), historyKind);
      // No advance-vote data (before 2017) is a gap, never election-day votes.
      const vt = d ? resolveVoteType(d, voteType) : null;
      if (idx === undefined || !d || !vt) return { year: e.year, shares: null, total: 0, confidence: null };
      const row = siteRow(d, idx, vt);
      if (!row || row.total <= 0) return { year: e.year, shares: null, total: 0, confidence: null };
      const shares: Record<string, number> = {};
      d.parties.forEach((p, k) => (shares[p] = row.votes[k] / row.total));
      const [a, b] = e.year < year ? [e.year, year] : [year, e.year];
      const confidence = e.year === year ? "self" : (stable.confidence[`${a}-${b}`] ?? null);
      return { year: e.year, shares, total: row.total, confidence };
    });
    // `loadedSig` changes whenever another election's results finish loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stable, year, voteType, manifest, loadedSig, historyKind]);

  if (!selected) return null;

  const close = () => select(null);
  // null when advance votes were not reported by voting place this year.
  const vt = yd ? resolveVoteType(yd, voteType) : null;
  const row = yd && i !== undefined && vt ? siteRow(yd, i, vt) : null;
  const L = row ? leader(row.votes, row.total) : null;
  const name = i !== undefined && yd ? yd.file.sites.name[i] : (stable?.name ?? "Polling place");
  const address = i !== undefined && yd ? yd.file.sites.address[i] : null;
  const suburb = i !== undefined && yd ? yd.file.sites.suburb[i] : stable?.suburb;
  const lat = i !== undefined && yd ? yd.file.sites.lat[i] : stable?.lat;
  const lng = i !== undefined && yd ? yd.file.sites.lng[i] : stable?.lng;
  const area = i !== undefined && yd ? yd.file.sites.areaKm2[boundary]?.[i] : undefined;
  const el = manifest.elections.find((e) => e.year === year);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      trackEvent("link_copied");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable: the URL bar already holds the link */
    }
  };

  const topParties = history
    ? (() => {
        const cur = history.find((h) => h.year === year)?.shares ?? history.find((h) => h.shares)?.shares ?? {};
        return Object.entries(cur)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([k]) => k);
      })()
    : [];

  return (
    <aside
      aria-label="Polling place details"
      data-testid="details-panel"
      className="panel pointer-events-auto absolute right-4 bottom-4 z-20 flex w-[380px] flex-col overflow-hidden max-sm:fixed max-sm:inset-x-0 max-sm:top-auto! max-sm:right-0 max-sm:bottom-0 max-sm:max-h-[72dvh] max-sm:w-auto max-sm:rounded-b-none"
      style={{ top: "calc(var(--controls-bottom, 120px) + 8px)" }}
    >
      <div className="flex items-start gap-2 px-4 pt-3.5 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] leading-snug font-bold tracking-[-0.01em] text-ink">{name}</h2>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
            {address && address !== name ? `${address.replace(`${name}, `, "")}${suburb ? `, ${suburb}` : ""}` : suburb}
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Close details" className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-wash hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="flex gap-1.5 px-4 pb-3">
        <button type="button" onClick={() => lat !== undefined && lng !== undefined && requestFlyTo({ lat, lng, zoom: 14 })} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-wash px-2.5 text-[12px] font-medium text-ink hover:bg-wash-2">
          <Crosshair className="size-3.5" aria-hidden /> Zoom to
        </button>
        <button type="button" onClick={copyLink} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-wash px-2.5 text-[12px] font-medium text-ink hover:bg-wash-2">
          {copied ? <Check className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />} {copied ? "Link copied" : "Copy link"}
        </button>
        <button type="button" onClick={close} className="inline-flex h-7 items-center rounded-md px-2 text-[12px] text-ink-2 hover:bg-wash hover:text-ink">
          Clear selection
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {i === undefined || !yd ? (
          <Section title={`${year ?? ""}`}>
            <p className="text-[13px] leading-relaxed text-ink-2">There was no polling place at this location in {year}. The chart below shows the elections where there was.</p>
          </Section>
        ) : (
          <>
            <Section title={`${year} party vote${el?.status === "preliminary" ? ", preliminary count" : ""}`} className="border-t-0 pt-0">
              <p className="text-[12px] text-ink-3">{TYPE_LABEL[yd.file.sites.types[i]] ?? "Voting place"}</p>
              {vt === null ? (
                <p className="mt-2 text-[13px] text-ink-2">Advance votes were not reported by voting place in {year}.</p>
              ) : !row || row.total <= 0 ? (
                <p className="mt-2 text-[13px] text-ink-2">No valid party votes were recorded here. Places with fewer than 6 votes are reported as zero to protect the secrecy of the vote.</p>
              ) : (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11.5px] text-ink-3">Valid party votes</p>
                      <p className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink">{fmtInt(row.total)}</p>
                      {yd.hasAdvance && vt === "all" && yd.file.sites.types[i] === "AE" && (
                        <p className="num text-[11.5px] text-ink-2">
                          {fmtInt(yd.totals.advance![i])} advance, {fmtInt(yd.totals.eday![i])} on the day
                        </p>
                      )}
                    </div>
                    {L && (
                      <div>
                        <p className="text-[11.5px] text-ink-3">{L.tie ? "Tied for first" : "Leading party"}</p>
                        {L.tie ? (
                          <p className="text-[14px] font-semibold text-ink">{L.tiedIndices.map((k) => partyLabel(manifest, yd.parties[k])).join(" / ")}</p>
                        ) : (
                          <>
                            <p className="flex items-center gap-1.5 text-[17px] leading-tight font-bold text-ink">
                              <Swatch color={partyColor(manifest, yd.parties[L.index])} ring className="size-3" />
                              {partyLabel(manifest, yd.parties[L.index])}
                            </p>
                            <p className="num text-[11.5px] text-ink-2">
                              {fmtPct(L.share)}, ahead by {fmtPP(L.marginShare).replace("+", "")} ({fmtInt(L.marginVotes)})
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-3">
                    <PartyBars manifest={manifest} parties={yd.parties} votes={row.votes} total={row.total} />
                  </div>
                  {!yd.hasAdvance && <p className="mt-2 text-[11.5px] leading-snug text-ink-3">In {year}, advance votes were reported only as electorate totals, so these are election-day votes.</p>}
                </>
              )}
            </Section>
            <CandidateSection manifest={manifest} yd={yd} i={i} vt={vt} />
            {yd.file.sites.electorates[i].length > 0 && (
              <Section title="Votes cast here by voters enrolled in">
                <ul className="flex flex-col gap-0.5">
                  {yd.file.sites.electorates[i].map(([ei, v]) => (
                    <li key={ei} className="flex justify-between text-[12.5px]">
                      <span className="text-ink">
                        {yd.file.electorates[ei].name}
                        {yd.file.electorates[ei].kind === "maori" && <span className="text-ink-3"> (Māori electorate)</span>}
                      </span>
                      <span className="num text-ink-2">{fmtInt(v)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">All votes recorded at this venue, including advance votes. Many people vote away from home, especially in advance.</p>
              </Section>
            )}
          </>
        )}
        {history && (
          <Section title={historyKind === "candidate" ? "Electorate vote share at this location, by candidates' party" : "Party vote share at this location"}>
            <HistoryChart key={`${selected}-${topParties.length > 0}`} manifest={manifest} points={history} current={year ?? 0} initialParties={topParties} />
            {voteType === "advance" && <p className="mt-1.5 text-[11.5px] text-ink-3">Advance votes only. Elections before 2017 did not report them by voting place, so they are left out.</p>}
          </Section>
        )}
        <Section title="Location and estimated catchment">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            {lat !== undefined && lng !== undefined && (
              <>
                <dt className="text-ink-3">Coordinates</dt>
                <dd className="num text-ink">
                  {Math.abs(lat).toFixed(5)}° S, {lng < 0 ? `${Math.abs(lng).toFixed(5)}° W` : `${lng.toFixed(5)}° E`}
                </dd>
              </>
            )}
            {area !== undefined && (
              <>
                <dt className="text-ink-3">Catchment</dt>
                <dd className="text-ink">
                  {area < 1 ? `${Math.round(area * 100)} ha` : `${area < 100 ? area.toFixed(1) : fmtInt(area)} km²`}{" "}
                  <span className="text-ink-3">({boundary === "meshblock" ? "meshblock method" : "Voronoi method"})</span>
                </dd>
              </>
            )}
          </dl>
          {i !== undefined && yd && <p className="mt-2 text-[11.5px] leading-snug text-ink-3">{LOCATED[yd.file.sites.located[i]] ?? ""} {yd.file.sites.locationYear[i] !== yd.year ? `Coordinates from the ${yd.file.sites.locationYear[i]} file.` : ""}</p>}
          <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">The shaded area is the land nearer to this polling place than to any other. It is an estimate for mapping, not an official voting area, and not where this polling place’s voters live.</p>
        </Section>
      </div>
    </aside>
  );
}

/** Electorate (candidate) votes cast at this polling place, by electorate, plus
 *  how each main party's candidates compare with its party vote here. */
function CandidateSection({ manifest, yd, i, vt }: { manifest: Manifest; yd: YearData; i: number; vt: VoteType | null }) {
  const block = yd.file.candidates;
  if (!block) return null;
  if (vt === null)
    return (
      <Section title="Electorate vote">
        <p className="text-[12.5px] text-ink-2">Advance votes were not reported by voting place in {yd.year}.</p>
      </Section>
    );
  const list = siteCandidates(yd.file, i, vt);
  const main = list[0];
  const mainEl = main ? block.electorates[main.electorateIndex] : null;
  const winner = mainEl && mainEl.winner !== null && mainEl.totalValid > 0 ? mainEl : null;
  const prow = siteRow(yd, i, vt);
  const splitParties = yd.candidate && prow ? Array.from(yd.parties.keys()).sort((a, b) => prow.votes[b] - prow.votes[a]).slice(0, 5).map((k) => yd.parties[k]) : [];
  return (
    <Section title="Electorate vote">
      {list.length === 0 ? (
        <p className="text-[12.5px] text-ink-2">No electorate votes were recorded at this polling place{mainEl?.note ? ` (${mainEl.note.toLowerCase()})` : ""}.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {list.slice(0, 3).map((e) => (
            <div key={e.electorateIndex}>
              {list.length > 1 && (
                <p className="mb-1 text-[11.5px] text-ink-3">
                  {e.electorate}
                  {e.maori ? " (Māori electorate)" : ""}, {fmtInt(e.total)} votes
                </p>
              )}
              <table className="w-full border-collapse text-[12.5px]">
                <caption className="sr-only">Candidate votes for {e.electorate} at this polling place</caption>
                <tbody>
                  {e.candidates
                    .filter((c, k) => k < 5 || c.votes / e.total >= 0.02)
                    .map((c) => (
                      <tr key={c.name}>
                        <th scope="row" className="py-[2px] pr-2 text-left font-normal">
                          <span className="flex items-center gap-1.5">
                            <Swatch color={c.party ? partyColor(manifest, c.party) : "#B8BEC4"} ring />
                            <span className="truncate text-ink">{c.name}</span>
                          </span>
                          <span className="block pl-4 text-[11px] text-ink-3">{c.party ? partyLabel(manifest, c.party) : "Party not stated in the source"}</span>
                        </th>
                        <td className="num w-[22%] py-[2px] text-right align-top font-medium text-ink">{fmtPct(c.votes / e.total)}</td>
                        <td className="num w-[22%] py-[2px] text-right align-top text-ink-2">{fmtInt(c.votes)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
          {list.length > 3 && <p className="text-[11.5px] text-ink-3">And votes for {list.length - 3} more electorates.</p>}
        </div>
      )}
      {winner && main && (
        <p className="mt-2 text-[11.5px] leading-snug text-ink-2">
          {main.electorate} was won by {formatCandidateName(winner.names[winner.winner as number])}
          {winner.majority !== null ? ` with a majority of ${fmtInt(winner.majority)}` : ""} (all votes in the electorate, including special votes).
        </p>
      )}
      {mainEl?.note && <p className="mt-2 text-[11.5px] text-ink-2">{main?.electorate}: {mainEl.note}.</p>}
      {splitParties.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11.5px] text-ink-3">Candidate vote vs party vote here</p>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-ink-3">
                <th className="py-[2px] text-left font-normal">Party</th>
                <th className="py-[2px] text-right font-normal">Party</th>
                <th className="py-[2px] text-right font-normal">Candidates</th>
                <th className="py-[2px] text-right font-normal">Gap</th>
              </tr>
            </thead>
            <tbody>
              {splitParties.map((p) => {
                const sp = splitAt(yd, i, p, vt);
                return (
                  <tr key={p}>
                    <th scope="row" className="py-[2px] text-left font-normal text-ink">
                      <span className="flex items-center gap-1.5">
                        <Swatch color={partyColor(manifest, p)} ring /> {partyLabel(manifest, p)}
                      </span>
                    </th>
                    <td className="num py-[2px] text-right text-ink-2">{fmtPct(sp.party)}</td>
                    <td className="num py-[2px] text-right text-ink-2">{fmtPct(sp.cand)}</td>
                    <td className="num py-[2px] text-right font-medium text-ink">{fmtPP(sp.diff)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!block.available && <p className="mt-2 text-[11.5px] leading-snug text-ink-3">The {yd.year} result files don’t state candidates’ parties, so their votes aren’t grouped by party.</p>}
    </Section>
  );
}
