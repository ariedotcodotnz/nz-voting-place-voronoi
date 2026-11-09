"use client";

import { ArrowLeftRight, ArrowUpDown, Blocks, CircleDot, Droplet, Flag, Map as MapIcon, Satellite, Settings2, SlidersHorizontal, Layers } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { FieldLabel, PartyPicker, Segmented } from "./common";
import { SearchBox } from "./SearchBox";
import { Strongholds } from "./Strongholds";
import { useAtlas, useControls } from "@/lib/atlas/store";
import { MAP_MODES, type MapMode } from "@/lib/atlas/url";
import type { Manifest } from "@/lib/atlas/types";
import { cn } from "@/lib/utils";

export const MODE_META: Record<MapMode, { label: string; short: string; icon: React.ComponentType<{ className?: string }>; blurb: string }> = {
  winner: { label: "Leading party", short: "Leader", icon: Flag, blurb: "Colour by the party with the most party votes at each polling place." },
  bloc: { label: "Strongest bloc", short: "Blocs", icon: Blocks, blurb: "Colour by the political bloc with the most combined party votes." },
  party: { label: "Party strength", short: "Party", icon: Droplet, blurb: "Shade every polling place by one party’s share of the vote." },
  circles: { label: "Vote circles", short: "Circles", icon: CircleDot, blurb: "Circle area is proportional to the votes counted at each polling place." },
  compare: { label: "Head to head", short: "Head to head", icon: ArrowLeftRight, blurb: "Which of two parties leads at each polling place, and by how much." },
  swing: { label: "Swing", short: "Swing", icon: ArrowUpDown, blurb: "Change in vote share between two elections at the same polling place." },
};

function ModeSwitch({ compact = false }: { compact?: boolean }) {
  const mode = useAtlas((s) => s.mode);
  const setMode = useAtlas((s) => s.setMode);
  return (
    <div role="radiogroup" aria-label="Map mode" className={cn("flex gap-0.5 rounded-lg bg-wash p-0.5", compact && "grid grid-cols-3")}>
      {MAP_MODES.map((m) => {
        const Icon = MODE_META[m].icon;
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            title={MODE_META[m].blurb}
            onClick={() => setMode(m)}
            data-testid={`mode-${m}`}
            className={cn(
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors",
              active ? "bg-ink text-paper" : "text-ink-2 hover:bg-wash-2 hover:text-ink",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className={cn(!compact && "max-xl:sr-only")}>{MODE_META[m].short}</span>
          </button>
        );
      })}
    </div>
  );
}

function BasemapSwitch() {
  const basemap = useAtlas((s) => s.basemap);
  const set = useAtlas((s) => s.set);
  return (
    <Segmented
      label="Basemap"
      value={basemap}
      onChange={(v) => set({ basemap: v })}
      options={[
        { value: "roadmap", label: <><MapIcon className="size-3.5" aria-hidden /><span>Map</span></>, title: "Google roadmap" },
        { value: "satellite", label: <><Satellite className="size-3.5" aria-hidden /><span>Satellite</span></>, title: "Google satellite imagery" },
        { value: "hybrid", label: <><Layers className="size-3.5" aria-hidden /><span className="max-lg:sr-only">Hybrid</span></>, title: "Satellite with labels" },
      ]}
    />
  );
}

export function ModeOptions({ manifest, stacked = false }: { manifest: Manifest; stacked?: boolean }) {
  const s = useControls();
  const years = manifest.elections.map((e) => e.year);
  const row = cn("flex flex-wrap items-center gap-2", stacked && "flex-col items-stretch");
  switch (s.mode) {
    case "winner":
      return (
        <div className={row}>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <Switch checked={s.shadeMargin} onCheckedChange={(v) => s.set({ shadeMargin: v })} aria-label="Shade by winning margin" />
            Lighter where the lead is narrow
          </label>
        </div>
      );
    case "bloc": {
      const scheme = manifest.blocs.schemes.find((x) => x.id === s.scheme);
      return (
        <div className={row}>
          <Segmented label="Bloc variant" value={s.scheme} onChange={(v) => s.set({ scheme: v })} options={manifest.blocs.schemes.map((x) => ({ value: x.id, label: x.id === "core" ? "TOP excluded" : "TOP included", title: x.label }))} />
          {scheme?.configurable?.length ? (
            <div className="flex items-center gap-2">
              <FieldLabel>TOP counted with</FieldLabel>
              <Segmented label="TOP bloc" value={s.topBloc} onChange={(v) => s.set({ topBloc: v })} options={[{ value: "left", label: "Centre-left" }, { value: "right", label: "Centre-right" }, { value: "centre", label: "Own bloc" }]} />
            </div>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => s.set({ panel: "blocs" })}>
            Who is in each bloc?
          </Button>
        </div>
      );
    }
    case "party":
      return (
        <div className={row}>
          <PartyPicker manifest={manifest} year={s.year} value={s.party} onChange={(p) => p && s.set({ party: p })} label="Party" className="w-44" />
          <Strongholds manifest={manifest} />
          <Segmented label="Measure" value={s.measure} onChange={(v) => s.set({ measure: v })} options={[{ value: "share", label: "Vote share" }, { value: "votes", label: "Vote count" }]} />
          <Segmented
            label="Colour scale"
            value={s.scaleMode}
            onChange={(v) => s.set({ scaleMode: v })}
            options={[
              { value: "fixed", label: "Same scale every year", title: "Scale fixed across all elections for fair comparison" },
              { value: "year", label: "This election", title: "Scale fitted to this election" },
              ...(s.measure === "share" ? [{ value: "custom" as const, label: "Custom" }] : []),
            ]}
          />
          {s.scaleMode === "custom" && s.measure === "share" && (
            <div className="flex w-48 items-center gap-2">
              <FieldLabel>Max</FieldLabel>
              <Slider min={5} max={100} step={5} value={[Math.round(s.scaleMax * 100)]} onValueChange={([v]) => s.set({ scaleMax: v / 100 })} aria-label="Scale maximum" />
              <span className="num w-9 text-right text-[12px] text-ink-2">{Math.round(s.scaleMax * 100)}%</span>
            </div>
          )}
        </div>
      );
    case "circles":
      return (
        <div className={row}>
          {s.circleSize !== "equal" && (
            <>
              <PartyPicker manifest={manifest} year={s.year} value={s.party} onChange={(p) => p && s.set({ party: p })} label="Party" className="w-40" />
              <span className="text-[12px] text-ink-3">with</span>
              <PartyPicker manifest={manifest} year={s.year} value={s.circlesB} onChange={(p) => s.set({ circlesB: p })} label="Compare with" allowNone className="w-36" />
            </>
          )}
          <Segmented
            label="Circle size"
            value={s.circleSize}
            onChange={(v) => s.set({ circleSize: v })}
            options={[
              { value: "votes", label: "Votes", title: "Area proportional to the party’s votes" },
              { value: "share", label: "Share", title: "Area proportional to the party’s vote share" },
              { value: "equal", label: "Equal", title: "One equal dot per polling place, coloured by leading party" },
            ]}
          />
          <div className="flex w-36 items-center gap-2">
            <FieldLabel>Size</FieldLabel>
            <Slider min={0.4} max={2.5} step={0.1} value={[s.circleScale]} onValueChange={([v]) => s.set({ circleScale: v })} aria-label="Circle size" />
          </div>
          <div className="flex w-36 items-center gap-2">
            <FieldLabel>Opacity</FieldLabel>
            <Slider min={0.2} max={1} step={0.05} value={[s.circleOpacity]} onValueChange={([v]) => s.set({ circleOpacity: v })} aria-label="Circle opacity" />
          </div>
          {s.circleSize === "votes" && (
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <Switch checked={s.cluster} onCheckedChange={(v) => s.set({ cluster: v })} aria-label="Combine nearby circles when zoomed out" />
              Combine when zoomed out
            </label>
          )}
        </div>
      );
    case "compare":
      return (
        <div className={row}>
          <PartyPicker manifest={manifest} year={s.year} value={s.cmpA} onChange={(p) => p && s.set({ cmpA: p })} label="Party A" className="w-40" />
          <button type="button" aria-label="Swap parties" onClick={() => s.set({ cmpA: s.partyB, partyB: s.cmpA })} className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-wash hover:text-ink">
            <ArrowLeftRight className="size-4" aria-hidden />
          </button>
          <PartyPicker manifest={manifest} year={s.year} value={s.partyB} onChange={(p) => p && s.set({ partyB: p })} label="Party B" className="w-40" />
          <Segmented label="Measure" value={s.measure} onChange={(v) => s.set({ measure: v })} options={[{ value: "share", label: "Points" }, { value: "votes", label: "Votes" }]} />
        </div>
      );
    case "swing": {
      const blocIds = Object.keys(manifest.blocs.blocs);
      return (
        <div className={row}>
          <Segmented
            label="Swing of"
            value={s.swingTarget.kind}
            onChange={(k) => s.set({ swingTarget: k === "party" ? { kind: "party", id: s.party } : { kind: "bloc", id: "left" } })}
            options={[{ value: "party", label: "Party" }, { value: "bloc", label: "Bloc" }]}
          />
          {s.swingTarget.kind === "party" ? (
            <PartyPicker manifest={manifest} year={s.year} value={s.swingTarget.id} onChange={(p) => p && s.set({ swingTarget: { kind: "party", id: p } })} label="Party" className="w-40" />
          ) : (
            <Select value={s.swingTarget.id} onValueChange={(v) => s.set({ swingTarget: { kind: "bloc", id: v } })}>
              <SelectTrigger size="sm" className="w-40" aria-label="Bloc">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {blocIds.map((b) => (
                  <SelectItem key={b} value={b}>
                    {manifest.blocs.blocs[b].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-2">
            <FieldLabel>since</FieldLabel>
            <Select value={String(s.refYear ?? "")} onValueChange={(v) => s.set({ refYear: Number(v) })}>
              <SelectTrigger size="sm" className="w-24" aria-label="Comparison election">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {years
                  .filter((y) => y !== s.year)
                  .map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Segmented
            label="Location matching"
            value={s.swingMinConfidence}
            onChange={(v) => s.set({ swingMinConfidence: v })}
            options={[
              { value: "high", label: "Same place", title: "Only polling places matched with high confidence" },
              { value: "probable", label: "Include probable", title: "Also include probable matches (nearby, similar name)" },
            ]}
          />
        </div>
      );
    }
  }
}

export function GeneralSettings({ manifest }: { manifest: Manifest }) {
  const s = useControls();
  const el = manifest.elections.find((e) => e.year === s.year);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Catchment boundaries</FieldLabel>
        <Segmented
          label="Catchment boundaries"
          value={s.boundary ?? manifest.boundary.default}
          onChange={(v) => s.set({ boundary: v })}
          options={[
            { value: "meshblock", label: "Meshblock (default)" },
            { value: "voronoi", label: "Raw Voronoi" },
          ]}
        />
        <p className="text-[12px] leading-snug text-ink-3">{manifest.boundary.methods[s.boundary ?? manifest.boundary.default]} Both are estimates, not official voting areas.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Votes counted</FieldLabel>
        <Segmented
          label="Votes counted"
          value={s.voteType}
          onChange={(v) => s.set({ voteType: v })}
          options={[
            { value: "all", label: "All at venue" },
            { value: "eday", label: "Election day" },
            { value: "advance", label: "Advance", disabled: !el?.advanceByVenue },
          ]}
        />
        <p className="text-[12px] leading-snug text-ink-3">
          {el?.advanceByVenue ? "Advance votes are reported by venue from 2017." : `In ${el?.year}, advance votes were reported only as electorate totals, so polling places show election-day votes.`}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Overlay opacity</FieldLabel>
        <Slider min={0.3} max={1} step={0.02} value={[s.overlayOpacity]} onValueChange={([v]) => s.set({ overlayOpacity: v })} aria-label="Overlay opacity" />
      </div>
      <label className="flex items-start gap-2.5 text-[13px] text-ink">
        <Switch checked={s.placeLabels} onCheckedChange={(v) => s.set({ placeLabels: v })} aria-label="Show place names on top of the map" className="mt-0.5" />
        <span>
          Place names on top
          <span className="block text-[12px] leading-snug text-ink-3">Town and suburb names drawn above the colours. Street names stay on the basemap underneath.</span>
        </span>
      </label>
      <label className="flex items-start gap-2.5 text-[13px] text-ink">
        <Switch checked={s.electorates} onCheckedChange={(v) => s.set({ electorates: v })} aria-label="Show approximate electorate outlines" className="mt-0.5" />
        <span>
          Electorate outlines
          <span className="block text-[12px] leading-snug text-ink-3">Dashed lines, approximated from the catchments of each electorate’s own polling places. Not official boundaries.</span>
        </span>
      </label>
      <label className="flex items-center gap-2.5 text-[13px] text-ink">
        <Switch checked={s.loop} onCheckedChange={(v) => s.set({ loop: v })} aria-label="Loop playback" />
        Loop timeline playback
      </label>
    </div>
  );
}

export function ControlBar({ manifest }: { manifest: Manifest }) {
  return (
    <div className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2">
      <div className="panel flex items-center gap-1.5 p-1.5">
        <div className="max-sm:hidden">
          <ModeSwitch />
        </div>
        <div className="max-md:hidden">
          <BasemapSwitch />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Map settings" className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-wash hover:text-ink max-sm:hidden">
              <Settings2 className="size-4" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[340px]">
            <GeneralSettings manifest={manifest} />
          </PopoverContent>
        </Popover>
        <Sheet>
          <SheetTrigger asChild>
            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink sm:hidden" aria-label="Map options">
              <SlidersHorizontal className="size-4" aria-hidden /> Options
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-4 pb-6">
            <SheetHeader className="px-0">
              <SheetTitle>Map options</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-5">
              <SearchBox manifest={manifest} />
              <ModeSwitch compact />
              <ModeOptions manifest={manifest} stacked />
              <BasemapSwitch />
              <GeneralSettings manifest={manifest} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
      <div className="panel max-w-[min(720px,calc(100vw-1.5rem))] p-2 max-sm:hidden" data-testid="mode-options">
        <ModeOptions manifest={manifest} />
      </div>
    </div>
  );
}
