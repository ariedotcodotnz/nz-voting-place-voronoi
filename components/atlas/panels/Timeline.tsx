"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pause, Play, SkipBack, SkipForward, LoaderCircle } from "lucide-react";
import { cumsum, scaleLinear } from "d3";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { preloadYear } from "@/lib/atlas/data";
import { PLAYBACK_MS, useAtlas, type PlaybackSpeed } from "@/lib/atlas/store";
import { sortYears, stepYear } from "@/lib/atlas/stats";
import { fmtPct } from "@/lib/atlas/format";
import type { Manifest } from "@/lib/atlas/types";
import { cn } from "@/lib/utils";
import { Segmented } from "./common";
import { MODE_META } from "./ControlBar";

const BAR_PARTIES = 7;

/** A stop on the timeline is a tiny stacked bar of that election's national
 *  party vote, so the scrubber itself shows how the country voted. */
function StopBar({ manifest, year, width }: { manifest: Manifest; year: number; width: number }) {
  const el = manifest.elections.find((e) => e.year === year)!;
  const segs = useMemo(() => {
    const entries = Object.entries(el.national).sort((a, b) => b[1] - a[1]);
    const total = el.nationalValid || entries.reduce((s, [, v]) => s + v, 0);
    const x = scaleLinear().domain([0, total]).range([0, width]);
    const shown = entries.slice(0, BAR_PARTIES).filter(([, v]) => v / total >= 0.01);
    const other = total - shown.reduce((s, [, v]) => s + v, 0);
    const starts = [0, ...cumsum(shown.map(([, v]) => v))];
    const out = shown.map(([p, v], k) => ({ key: p, x: x(starts[k]), w: x(v), color: manifest.parties[p]?.color ?? "#999", share: v / total }));
    if (other > 0) out.push({ key: "other", x: x(starts[shown.length]), w: x(other), color: "#C3C8CD", share: other / total });
    return out;
  }, [el, manifest, width]);
  return (
    <svg width="100%" height={8} viewBox={`0 0 ${width} 8`} preserveAspectRatio="none" aria-hidden className="block">
      {segs.map((s) => (
        <rect key={s.key} x={s.x} y={0} width={Math.max(0, s.w - 1.2)} height={8} fill={s.color} />
      ))}
    </svg>
  );
}

function stopSummary(manifest: Manifest, year: number): string {
  const el = manifest.elections.find((e) => e.year === year)!;
  const entries = Object.entries(el.national).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return entries.map(([p, v]) => `${manifest.parties[p]?.short ?? p} ${fmtPct(v / el.nationalValid)}`).join(", ");
}

export function Timeline({ manifest }: { manifest: Manifest }) {
  const years = useMemo(() => sortYears(manifest.elections.map((e) => e.year)), [manifest]);
  const year = useAtlas((s) => s.year);
  const shownYear = useAtlas((s) => s.shownYear);
  const playing = useAtlas((s) => s.playing);
  const speed = useAtlas((s) => s.speed);
  const loop = useAtlas((s) => s.loop);
  const mode = useAtlas((s) => s.mode);
  const refYear = useAtlas((s) => s.refYear);
  const set = useAtlas((s) => s.set);
  const strip = useRef<HTMLDivElement>(null);
  const el = manifest.elections.find((e) => e.year === year);

  // Playback: advance only after the next election is fully loaded for the
  // current view; stop cleanly at the last election unless looping.
  useEffect(() => {
    if (!playing || year === null) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const next = stepYear(years, year, 1) ?? (loop ? years[0] : null);
      if (next === null) {
        set({ playing: false });
        return;
      }
      const st = useAtlas.getState();
      try {
        await preloadYear(manifest, next, st.boundary ?? manifest.boundary.default, st.camera?.bbox ?? null, st.camera?.zoom ?? 5);
      } catch {
        set({ playing: false });
        return;
      }
      if (!cancelled && useAtlas.getState().playing) set({ year: next });
    }, PLAYBACK_MS[speed]);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [playing, year, speed, loop, years, manifest, set]);

  const togglePlay = useCallback(() => {
    const s = useAtlas.getState();
    if (s.playing) return s.set({ playing: false });
    if (s.year === years[years.length - 1] && !s.loop) s.set({ year: years[0], playing: true });
    else s.set({ playing: true });
  }, [years]);

  const go = useCallback((y: number | null) => y !== null && set({ year: y, playing: false }), [set]);

  const yearAtPointer = (clientX: number) => {
    const r = strip.current?.getBoundingClientRect();
    if (!r) return null;
    const t = Math.min(0.9999, Math.max(0, (clientX - r.left) / r.width));
    return years[Math.floor(t * years.length)];
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (year === null) return;
    const map: Record<string, number | null> = {
      ArrowRight: stepYear(years, year, 1),
      ArrowUp: stepYear(years, year, 1),
      ArrowLeft: stepYear(years, year, -1),
      ArrowDown: stepYear(years, year, -1),
      Home: years[0],
      End: years[years.length - 1],
    };
    if (e.key in map) {
      e.preventDefault();
      go(map[e.key]);
    } else if (e.key === " ") {
      e.preventDefault();
      togglePlay();
    }
  };

  const loading = year !== null && shownYear !== year;

  return (
    <section aria-label="Election timeline" className="panel pointer-events-auto mx-auto flex w-full max-w-[880px] min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 p-3 sm:flex-nowrap" data-testid="timeline">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="Previous election" onClick={() => year !== null && go(stepYear(years, year, -1))} disabled={year === years[0]} className="grid size-8 place-items-center rounded-lg text-ink hover:bg-wash disabled:opacity-30">
            <SkipBack className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play through elections"}
            aria-pressed={playing}
            onClick={togglePlay}
            data-testid="play"
            className="grid size-10 place-items-center rounded-full bg-ink text-paper hover:bg-ink/85"
          >
            {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-[1px]" aria-hidden />}
          </button>
          <button type="button" aria-label="Next election" onClick={() => year !== null && go(stepYear(years, year, 1))} disabled={year === years[years.length - 1]} className="grid size-8 place-items-center rounded-lg text-ink hover:bg-wash disabled:opacity-30">
            <SkipForward className="size-4" aria-hidden />
          </button>
        </div>
        <div className="min-w-[92px]">
          <div className="flex items-center gap-1.5">
            <span className="text-[30px] leading-none font-extrabold tracking-[-0.03em] text-ink" data-testid="current-year" aria-live="polite">
              {year}
            </span>
            {loading && <LoaderCircle className="size-4 animate-spin text-ink-3" aria-label="Loading election" />}
          </div>
          <p className="mt-1 text-[11.5px] leading-tight text-ink-3">
            {el?.status === "preliminary" ? "Preliminary count" : "Final results"}
            <span className="block text-ink-2">{MODE_META[mode].label}</span>
          </p>
        </div>
      </div>

      <div className="min-w-0 flex-1 max-sm:basis-full">
        <div
          ref={strip}
          role="slider"
          tabIndex={0}
          aria-label="Election year"
          aria-valuemin={years[0]}
          aria-valuemax={years[years.length - 1]}
          aria-valuenow={year ?? undefined}
          aria-valuetext={year ? `${year}${el?.status === "preliminary" ? " (preliminary)" : ""}` : undefined}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            go(yearAtPointer(e.clientX));
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 1) return;
            const y = yearAtPointer(e.clientX);
            if (y !== year) go(y);
          }}
          className="grid cursor-pointer touch-none rounded-lg outline-offset-4 select-none"
          style={{ gridTemplateColumns: `repeat(${years.length}, minmax(0, 1fr))` }}
          data-testid="timeline-strip"
        >
          {years.map((y) => {
            const active = y === year;
            const e = manifest.elections.find((x) => x.year === y)!;
            const isRef = mode === "swing" && y === refYear;
            return (
              <Tooltip key={y}>
                <TooltipTrigger asChild>
                  <div className={cn("group relative flex flex-col gap-1.5 rounded-md px-1.5 py-1.5 transition-colors", active ? "bg-wash" : "hover:bg-wash/70")} data-year={y}>
                    <div className={cn("overflow-hidden rounded-[2px] transition-opacity", active ? "opacity-100" : "opacity-55 group-hover:opacity-90")}>
                      <StopBar manifest={manifest} year={y} width={120} />
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn("num text-[12.5px] leading-none", active ? "font-bold text-ink" : "font-medium text-ink-2")}>{y}</span>
                      {e.status === "preliminary" && <span className="text-[10px] leading-none font-semibold text-ink-3">prelim.</span>}
                      {isRef && <span className="text-[10px] leading-none font-semibold text-ink-3">vs</span>}
                    </div>
                    {active && <span aria-hidden className="absolute inset-x-1.5 -bottom-[3px] h-[2px] rounded-full bg-ink" />}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-56">
                  <p className="font-semibold">{y} national party vote</p>
                  <p className="opacity-80">{stopSummary(manifest, y)}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 max-sm:hidden">
        <Segmented<PlaybackSpeed>
          label="Playback speed"
          value={speed}
          onChange={(v) => set({ speed: v })}
          options={[
            { value: "slow", label: "0.5×" },
            { value: "normal", label: "1×" },
            { value: "fast", label: "2×" },
          ]}
        />
        <button type="button" onClick={() => set({ loop: !loop })} aria-pressed={loop} className={cn("text-[11.5px]", loop ? "font-semibold text-ink" : "text-ink-3 hover:text-ink-2")}>
          {loop ? "Looping" : "Loop off"}
        </button>
      </div>
    </section>
  );
}
