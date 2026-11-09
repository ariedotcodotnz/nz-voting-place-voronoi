"use client";

import { useState } from "react";
import { scaleLinear } from "d3";
import { fmtInt, fmtPct } from "@/lib/atlas/format";
import { rankParties } from "@/lib/atlas/stats";
import type { Manifest, PartyId } from "@/lib/atlas/types";

/** Ranked horizontal bars: every party on the ballot, by vote share. */
export function PartyBars({ manifest, parties, votes, total }: { manifest: Manifest; parties: PartyId[]; votes: ArrayLike<number>; total: number }) {
  const [all, setAll] = useState(false);
  const ranked = rankParties(votes, total);
  const max = Math.max(0.0001, ranked[0]?.share ?? 0);
  const x = scaleLinear().domain([0, Math.max(max, 0.05)]).range([0, 100]);
  const visible = all ? ranked : ranked.filter((r, k) => k < 6 || r.share >= 0.02);
  const hidden = ranked.length - visible.length;
  return (
    <div>
      <table className="w-full border-collapse text-[12.5px]">
        <caption className="sr-only">Party votes at this polling place</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Party</th>
            <th scope="col">Share</th>
            <th scope="col">Votes</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const p = parties[r.index];
            const meta = manifest.parties[p];
            return (
              <tr key={p} className="align-middle">
                <th scope="row" className="w-[42%] py-[3px] pr-2 text-left font-normal">
                  <span className="block truncate text-ink">{meta?.short ?? p}</span>
                  <span className="mt-[3px] block h-[6px] rounded-r-[3px]" style={{ width: `${Math.max(0.5, x(r.share))}%`, background: meta?.color ?? "#999" }} aria-hidden />
                </th>
                <td className="num w-[24%] py-[3px] text-right font-medium text-ink">{fmtPct(r.share)}</td>
                <td className="num w-[34%] py-[3px] text-right text-ink-2">{fmtInt(r.votes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className="mt-1 text-[12px] text-ink-2 underline decoration-rule underline-offset-2 hover:text-ink">
          Show {hidden} more {hidden === 1 ? "party" : "parties"}
        </button>
      )}
    </div>
  );
}
