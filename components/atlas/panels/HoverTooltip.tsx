"use client";

import { useRef, useLayoutEffect, useState } from "react";
import { keys, peek, useResourceVersion } from "@/lib/atlas/data";
import { useAtlas } from "@/lib/atlas/store";
import { blocLeader, blocTotals, comparableSite, leader, resolveVoteType, share, siteRow, type YearData } from "@/lib/atlas/stats";
import { activeBlocs } from "@/lib/atlas/blocs";
import { effectiveMembership, partyColor, partyLabel } from "@/lib/atlas/encoding";
import { fmtInt, fmtPct, fmtPP, fmtSigned } from "@/lib/atlas/format";
import type { Manifest, SitesFile, VoteType } from "@/lib/atlas/types";
import { Swatch } from "./common";

const TYPE_LABEL: Record<string, string> = { AE: "Advance and election-day voting place", E: "Election-day voting place", A: "Advance voting place" };

export function HoverTooltip({ manifest }: { manifest: Manifest }) {
  useResourceVersion();
  const hover = useAtlas((s) => s.hover);
  const shownYear = useAtlas((s) => s.shownYear);
  const s = useAtlas.getState();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 280, h: 160 });
  useLayoutEffect(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      if (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1) setSize({ w: r.width, h: r.height });
    }
  }, [hover, size.w, size.h]);
  if (!hover || shownYear === null) return null;
  const yd = peek<YearData>(keys.year(shownYear));
  if (!yd) return null;
  const vtResolved = resolveVoteType(yd, s.voteType);
  const vt: VoteType = vtResolved ?? "all";

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = hover.x + 16 + size.w > vw - 8 ? hover.x - 16 - size.w : hover.x + 16;
  const top = hover.y + 16 + size.h > vh - 8 ? Math.max(8, hover.y - 16 - size.h) : hover.y + 16;

  let body: React.ReactNode;
  if (hover.cluster) {
    const p = hover.layer.split(":")[1];
    const k = yd.partyIndex.get(p);
    let v = 0;
    let t = 0;
    for (const i of hover.cluster) {
      const row = siteRow(yd, i, vt);
      if (!row) continue;
      v += k === undefined ? 0 : row.votes[k];
      t += row.total;
    }
    body = (
      <>
        <p className="font-semibold text-ink">{hover.cluster.length} polling places combined</p>
        <p className="mt-1 flex items-center gap-1.5 text-ink">
          <Swatch color={partyColor(manifest, p)} ring />
          {partyLabel(manifest, p)} <span className="num ml-auto font-semibold">{fmtInt(v)}</span>
        </p>
        <p className="num text-ink-2">{fmtPct(v / t)} of {fmtInt(t)} valid party votes</p>
        <p className="mt-1 text-[11.5px] text-ink-3">Zoom in or click to separate them.</p>
      </>
    );
  } else {
    const i = hover.index;
    const row = siteRow(yd, i, vt);
    const L = row ? leader(row.votes, row.total) : null;
    const name = yd.file.sites.name[i];
    const suburb = yd.file.sites.suburb[i];
    let modeLine: React.ReactNode = null;
    if (row && row.total > 0) {
      if (s.mode === "party" || (s.mode === "circles" && s.circleSize !== "equal")) {
        const p = hover.layer.startsWith("circles:") ? hover.layer.split(":")[1] : s.party;
        const k = yd.partyIndex.get(p);
        modeLine = (
          <Line color={partyColor(manifest, p)} label={partyLabel(manifest, p)}>
            {k === undefined ? "not on ballot" : `${fmtPct(share(row.votes[k], row.total))} (${fmtInt(row.votes[k])})`}
          </Line>
        );
      } else if (s.mode === "bloc") {
        const { scheme, membership } = effectiveMembership(manifest, s, yd.year);
        const ids = activeBlocs(scheme, membership, yd.parties, manifest.blocs);
        const bt = blocTotals(row.votes, yd.parties, membership, ids, row.total);
        const BL = blocLeader(bt);
        modeLine = (
          <div className="mt-1.5 flex flex-col gap-0.5 border-t border-rule pt-1.5">
            {ids.map((b) => (
              <Line key={b} color={manifest.blocs.blocs[b].color} label={manifest.blocs.blocs[b].short} strong={BL?.bloc === b}>
                {fmtPct((bt.blocs.get(b) ?? 0) / row.total)}
              </Line>
            ))}
            <Line color="#A9AFB5" label="Unassigned parties">
              {fmtPct(bt.unassigned / row.total)}
            </Line>
            {BL && !BL.tie && BL.bloc && <p className="text-[11.5px] text-ink-2">Lead of {fmtPP(BL.marginShare).replace("+", "")} over {BL.runnerUp ? manifest.blocs.blocs[BL.runnerUp].short : "next bloc"}</p>}
          </div>
        );
      } else if (s.mode === "compare") {
        const ka = yd.partyIndex.get(s.cmpA);
        const kb = yd.partyIndex.get(s.partyB);
        const a = ka === undefined ? 0 : row.votes[ka];
        const b = kb === undefined ? 0 : row.votes[kb];
        modeLine = (
          <div className="mt-1.5 flex flex-col gap-0.5 border-t border-rule pt-1.5">
            <Line color={partyColor(manifest, s.cmpA)} label={partyLabel(manifest, s.cmpA)}>
              {fmtPct(a / row.total)} ({fmtInt(a)})
            </Line>
            <Line color={partyColor(manifest, s.partyB)} label={partyLabel(manifest, s.partyB)}>
              {fmtPct(b / row.total)} ({fmtInt(b)})
            </Line>
            <p className="text-[11.5px] font-medium text-ink">
              {a === b ? "Level" : `${partyLabel(manifest, a > b ? s.cmpA : s.partyB)} ahead by ${fmtPP(Math.abs(a - b) / row.total).replace("+", "")} (${fmtSigned(Math.abs(a - b)).replace("+", "")} votes)`}
            </p>
          </div>
        );
      } else if (s.mode === "swing") {
        const sites = peek<SitesFile>(keys.sites);
        const refYd = s.refYear !== null ? peek<YearData>(keys.year(s.refYear)) : undefined;
        const c = sites && refYd ? comparableSite(sites.sites[yd.file.sites.id[i]], yd.year, refYd.year, s.swingMinConfidence) : null;
        const swingVt: VoteType = !yd.hasAdvance || !refYd?.hasAdvance ? "eday" : vt;
        if (!c || !refYd) {
          modeLine = <p className="mt-1.5 border-t border-rule pt-1.5 text-[12px] text-ink-2">No polling place at this location in {s.refYear} (or the match is too uncertain), so no local swing is shown.</p>;
        } else {
          const now = siteRow(yd, i, swingVt);
          const then = siteRow(refYd, c.index, swingVt);
          const val = (d: YearData, r: ReturnType<typeof siteRow>) => {
            if (!r || r.total <= 0) return NaN;
            if (s.swingTarget.kind === "party") {
              const k = d.partyIndex.get(s.swingTarget.id);
              return k === undefined ? 0 : r.votes[k] / r.total;
            }
            const { scheme, membership } = effectiveMembership(manifest, s, d.year);
            const t = blocTotals(r.votes, d.parties, membership, activeBlocs(scheme, membership, d.parties, manifest.blocs), r.total);
            return (t.blocs.get(s.swingTarget.id) ?? 0) / r.total;
          };
          const a = val(yd, now);
          const b = val(refYd, then);
          const label = s.swingTarget.kind === "party" ? partyLabel(manifest, s.swingTarget.id) : manifest.blocs.blocs[s.swingTarget.id]?.short;
          modeLine = (
            <div className="mt-1.5 border-t border-rule pt-1.5 text-[12px] text-ink-2">
              <p>
                {label}: <span className="num">{fmtPct(b)}</span> in {refYd.year} → <span className="num">{fmtPct(a)}</span> in {yd.year}
              </p>
              <p className="num font-semibold text-ink">{fmtPP(a - b)}</p>
              {c.confidence !== "exact" && <p className="text-[11px] text-ink-3">Location match: {c.confidence}</p>}
            </div>
          );
        }
      }
    }
    body = (
      <>
        <p className="leading-snug font-semibold text-ink">{name}</p>
        <p className="text-[11.5px] text-ink-3">
          {suburb ? `${suburb}, ` : ""}
          {yd.year} — {TYPE_LABEL[yd.file.sites.types[i]] ?? "Voting place"}
        </p>
        {!row || row.total <= 0 ? (
          <p className="mt-1.5 text-[12px] text-ink-2">{vtResolved === null ? "Advance votes were not reported by voting place this year." : "No valid party votes recorded (fewer than 6 votes are reported as zero)."}</p>
        ) : (
          <>
            {L && (
              <div className="mt-1.5">
                {L.tie ? (
                  <p className="text-[12.5px] font-medium text-ink">Tie for first: {L.tiedIndices.map((k) => partyLabel(manifest, yd.parties[k])).join(" and ")}</p>
                ) : (
                  <Line color={partyColor(manifest, yd.parties[L.index])} label={partyLabel(manifest, yd.parties[L.index])} strong>
                    {fmtPct(L.share)} ({fmtInt(L.votes)})
                  </Line>
                )}
                {!L.tie && L.runnerUpIndex >= 0 && (
                  <p className="text-[11.5px] text-ink-2">
                    Leads {partyLabel(manifest, yd.parties[L.runnerUpIndex])} by {fmtPP(L.marginShare).replace("+", "")} ({fmtInt(L.marginVotes)} votes)
                  </p>
                )}
              </div>
            )}
            {modeLine}
            <p className="num mt-1.5 text-[11.5px] text-ink-3">
              {fmtInt(row.total)} valid party votes{vt === "eday" ? " on election day" : vt === "advance" ? " in advance" : ""}
            </p>
          </>
        )}
      </>
    );
  }

  return (
    <div ref={ref} role="tooltip" className="panel pointer-events-none fixed z-40 w-max max-w-[300px] px-3 py-2.5 text-[12.5px]" style={{ left, top }} data-testid="hover-tooltip">
      {body}
    </div>
  );
}

function Line({ color, label, children, strong = false }: { color: string; label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <p className="flex items-center gap-1.5 text-[12.5px] text-ink">
      <Swatch color={color} ring />
      <span className={strong ? "font-semibold" : undefined}>{label}</span>
      <span className={`num ml-auto pl-3 ${strong ? "font-semibold" : ""}`}>{children}</span>
    </p>
  );
}
