"use client";

import { useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { keys, peek, useResourceVersion } from "@/lib/atlas/data";
import { useAtlas } from "@/lib/atlas/store";
import { resolveVoteType, siteRow, viewFor, type YearData } from "@/lib/atlas/stats";
import { partyLabel } from "@/lib/atlas/encoding";
import { fmtInt, fmtPct } from "@/lib/atlas/format";
import type { Manifest } from "@/lib/atlas/types";

/** Minimum valid votes for a polling place to count as a stronghold, so tiny
 *  booths with a handful of votes don't dominate the list. */
const MIN_VOTES = 100;

export function Strongholds({ manifest }: { manifest: Manifest }) {
  useResourceVersion();
  const [open, setOpen] = useState(false);
  const year = useAtlas((s) => s.shownYear);
  const party = useAtlas((s) => s.party);
  const voteType = useAtlas((s) => s.voteType);
  const voteKind = useAtlas((s) => s.voteKind);
  const ydAll = year !== null ? peek<YearData>(keys.year(year)) : undefined;
  const yd = viewFor(ydAll, voteKind) ?? undefined;
  const top = useMemo(() => {
    if (!yd) return [];
    const k = yd.partyIndex.get(party);
    const vt = resolveVoteType(yd, voteType);
    if (k === undefined || !vt) return [];
    const out: { i: number; share: number; votes: number; total: number }[] = [];
    for (let i = 0; i < yd.n; i++) {
      const row = siteRow(yd, i, vt);
      if (row && row.total >= MIN_VOTES) out.push({ i, share: row.votes[k] / row.total, votes: row.votes[k], total: row.total });
    }
    return out.sort((a, b) => b.share - a.share).slice(0, 12);
  }, [yd, party, voteType]);
  if (!yd) return null;
  const go = (i: number) => {
    const s = useAtlas.getState();
    s.select(yd.file.sites.id[i]);
    s.requestFlyTo({ lat: yd.file.sites.lat[i], lng: yd.file.sites.lng[i], zoom: 13.5 });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rule px-2.5 text-[12.5px] font-medium text-ink hover:bg-wash">
          <Trophy className="size-3.5" aria-hidden /> Strongholds
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b border-rule px-3 py-2 text-[12px] text-ink-2">
          Highest {partyLabel(manifest, party)} {voteKind === "candidate" ? "electorate-vote" : "party-vote"} share in {yd.year}, polling places with at least {MIN_VOTES} valid votes
        </p>
        {top.length === 0 ? (
          <p className="px-3 py-3 text-[12.5px] text-ink-2">{partyLabel(manifest, party)} was not on the {yd.year} ballot.</p>
        ) : (
          <ol className="max-h-80 overflow-y-auto py-1">
            {top.map((t, rank) => (
              <li key={t.i}>
                <button type="button" onClick={() => go(t.i)} className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-wash">
                  <span className="num w-4 shrink-0 text-right text-[11px] text-ink-3">{rank + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{yd.file.sites.name[t.i]}</span>
                    <span className="block truncate text-[11px] text-ink-3">{yd.file.sites.suburb[t.i]}</span>
                  </span>
                  <span className="num text-[12.5px] font-semibold text-ink">{fmtPct(t.share)}</span>
                  <span className="num w-12 text-right text-[11px] text-ink-3">{fmtInt(t.votes)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
