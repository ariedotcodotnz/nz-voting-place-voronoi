"use client";

import { SearchBox } from "./SearchBox";
import { SITE_NAME } from "@/lib/brand";
import { useAtlas } from "@/lib/atlas/store";
import { fmtDate } from "@/lib/atlas/format";
import type { Manifest } from "@/lib/atlas/types";

export function TitleBlock({ manifest }: { manifest: Manifest }) {
  const year = useAtlas((s) => s.year);
  const set = useAtlas((s) => s.set);
  const el = manifest.elections.find((e) => e.year === year);
  return (
    <header className="panel pointer-events-auto w-[min(340px,calc(100vw-1.5rem))] shrink-0 p-3.5 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[17px] leading-tight font-bold tracking-[-0.015em] text-ink">{SITE_NAME}</h1>
        <button type="button" onClick={() => set({ panel: "method" })} className="shrink-0 text-[12.5px] text-ink-2 underline decoration-rule underline-offset-[3px] hover:text-ink hover:decoration-ink">
          <span className="max-sm:hidden">How to read this map</span>
          <span className="sm:hidden">About</span>
        </button>
      </div>
      {el && (
        <p className="mt-1 text-[13px] text-ink-2">
          {fmtDate(el.date) || el.year} general election
          {el.status === "preliminary" ? (
            <span className="ml-1.5 inline-flex translate-y-[-1px] items-center rounded-full border border-ink px-1.5 text-[11px] leading-[17px] font-semibold text-ink">Preliminary</span>
          ) : (
            <span className="text-ink-3">, final results</span>
          )}
        </p>
      )}
      <p className="mt-2 text-[12.5px] leading-snug text-ink-3 max-sm:hidden">
        Votes counted at each polling place, drawn over estimated catchments. Shapes show where a polling place is nearest — not where its voters live.
      </p>
      <div className="max-sm:hidden">
        <SearchBox manifest={manifest} />
      </div>
    </header>
  );
}
