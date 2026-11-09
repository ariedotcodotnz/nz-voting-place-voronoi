"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Search, Landmark, Map as MapIcon, Building2 } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { keys, loadSearch, loadYear, useResource } from "@/lib/atlas/data";
import { fold } from "@/lib/atlas/text";
import { useAtlas } from "@/lib/atlas/store";
import { nearestYear } from "@/lib/atlas/stats";
import type { Manifest, SearchFile } from "@/lib/atlas/types";

const LIMIT = 6;

/** Local, precomputed search index — no paid Places/Geocoding requests. */
export function SearchBox({ manifest }: { manifest: Manifest }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const res = useResource(open || query ? keys.search : null, () => loadSearch(manifest).promise);
  const index = res?.value;
  const year = useAtlas((s) => s.year);

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  const results = useMemo(() => (index && query.trim().length >= 2 ? searchIndex(index, query, year) : null), [index, query, year]);

  const go = async (kind: string, payload: unknown) => {
    const s = useAtlas.getState();
    setOpen(false);
    setQuery("");
    if (kind === "place") {
      const [id, , , lat, lng, years] = payload as SearchFile["places"][number];
      if (s.year !== null && !years.includes(s.year)) s.set({ year: nearestYear(years, s.year) });
      s.select(id);
      s.requestFlyTo({ lat, lng, zoom: 14 });
    } else if (kind === "suburb") {
      const [, lat, lng] = payload as SearchFile["suburbs"][number];
      s.requestFlyTo({ lat, lng, zoom: 13.5 });
    } else if (kind === "region") {
      const r = payload as SearchFile["regions"][number];
      s.requestFlyTo({ bbox: r.bbox });
    } else if (kind === "electorate") {
      const e = payload as SearchFile["electorates"][number];
      const y = s.year !== null && e.years.includes(s.year) ? s.year : (nearestYear(e.years, s.year ?? e.years[e.years.length - 1]) as number);
      const yd = await loadYear(manifest, y).promise;
      const el = yd.file.electorates.find((x) => x.name === e.name);
      if (y !== s.year) s.set({ year: y });
      if (el?.bbox) s.requestFlyTo({ bbox: el.bbox });
      if (e.kind === "general") s.set({ electorates: true });
    }
  };

  return (
    <div ref={wrap} className="relative mt-3">
      <Command shouldFilter={false} className="overflow-visible rounded-lg border border-rule bg-paper p-0 focus-within:border-ink/40">
        <div className="flex items-center gap-2 px-2.5" onFocus={() => setOpen(true)}>
          <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
          <CommandPrimitive.Input
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setOpen(true);
            }}
            placeholder="Search places, suburbs, electorates"
            aria-label="Search the map"
            className="h-9 w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        {open && query.trim().length >= 2 && (
          <CommandList className="absolute top-full right-0 left-0 z-30 mt-1 max-h-[min(60vh,420px)] rounded-lg border border-rule bg-paper shadow-elev">
            {!index && <div className="px-3 py-2 text-[13px] text-ink-3">Loading search index…</div>}
            {results && <CommandEmpty>Nothing found for “{query}”.</CommandEmpty>}
            {results && results.places.length > 0 && (
              <CommandGroup heading="Polling places">
                {results.places.map((p) => (
                  <CommandItem key={p[0]} value={`place-${p[0]}`} onSelect={() => go("place", p)}>
                    <MapPin className="size-4 text-ink-3" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {p[1]}
                      <span className="text-ink-3"> {p[2]}</span>
                    </span>
                    <span className="text-[11px] text-ink-3">{p[5].length === 1 ? p[5][0] : `${p[5][0]}–${String(p[5][p[5].length - 1]).slice(2)}`}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results && results.suburbs.length > 0 && (
              <CommandGroup heading="Suburbs and localities">
                {results.suburbs.map((sb) => (
                  <CommandItem key={sb[0]} value={`suburb-${sb[0]}`} onSelect={() => go("suburb", sb)}>
                    <Building2 className="size-4 text-ink-3" aria-hidden />
                    {sb[0]}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results && results.electorates.length > 0 && (
              <CommandGroup heading="Electorates">
                {results.electorates.map((e) => (
                  <CommandItem key={e.name} value={`el-${e.name}`} onSelect={() => go("electorate", e)}>
                    <Landmark className="size-4 text-ink-3" aria-hidden />
                    <span className="flex-1">{e.name}</span>
                    <span className="text-[11px] text-ink-3">{e.kind === "maori" ? "Māori electorate" : `${e.years[0]}–${String(e.years[e.years.length - 1]).slice(2)}`}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results && results.regions.length > 0 && (
              <CommandGroup heading="Regions and cities">
                {results.regions.map((r) => (
                  <CommandItem key={r.name} value={`region-${r.name}`} onSelect={() => go("region", r)}>
                    <MapIcon className="size-4 text-ink-3" aria-hidden />
                    {r.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        )}
      </Command>
    </div>
  );
}

export function searchIndex(index: SearchFile, query: string, year: number | null) {
  const q = fold(query.trim());
  const score = (text: string) => {
    const t = fold(text);
    if (t.startsWith(q)) return 3;
    if (t.includes(` ${q}`)) return 2;
    if (t.includes(q)) return 1;
    return 0;
  };
  const top = <T,>(items: T[], text: (x: T) => string, bonus: (x: T) => number = () => 0) =>
    items
      .map((x) => ({ x, s: score(text(x)) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s + bonus(b.x) - (a.s + bonus(a.x)))
      .slice(0, LIMIT)
      .map((r) => r.x);
  return {
    places: top(index.places, (p) => `${p[1]} ${p[2]}`, (p) => (year !== null && p[5].includes(year) ? 0.5 : 0)),
    suburbs: top(index.suburbs, (s) => s[0], (s) => Math.min(0.5, s[3] / 100)),
    electorates: top(index.electorates, (e) => e.name, (e) => (year !== null && e.years.includes(year) ? 0.5 : 0)),
    regions: top(index.regions, (r) => r.name, (r) => (r.kind === "city" ? 0.3 : 0)),
  };
}
