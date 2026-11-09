"use client";

import { useId, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { scaleLinear } from "d3";
import { useEncoding } from "../useEncoding";
import { keys, peek, useResourceVersion } from "@/lib/atlas/data";
import { useAtlas } from "@/lib/atlas/store";
import { circleRadiusPx, legendValues, MIN_RADIUS_PX } from "@/lib/atlas/circles";
import { partyColor, partyLabel, type LegendSpec } from "@/lib/atlas/encoding";
import { fmtInt, fmtPct } from "@/lib/atlas/format";
import type { YearData } from "@/lib/atlas/stats";
import type { Manifest } from "@/lib/atlas/types";
import { cn } from "@/lib/utils";
import { Swatch } from "./common";
import { MODE_META } from "./ControlBar";

function GradientBar({ interpolator, domain, format, diverging = false }: { interpolator: (t: number) => string; domain: [number, number]; format: "pct" | "int" | "pp"; diverging?: boolean }) {
  const id = `g${useId().replace(/:/g, "")}`;
  const W = 232;
  const x = scaleLinear().domain(domain).range([0, W]);
  const ticks = diverging ? [domain[0], domain[0] / 2, 0, domain[1] / 2, domain[1]] : x.ticks(4);
  const fmt = (v: number) => (format === "pct" ? fmtPct(v, 0) : format === "pp" ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}` : fmtInt(v));
  const stops = Array.from({ length: 11 }, (_, k) => k / 10);
  return (
    <svg width={W + 16} height={34} role="img" aria-label={`Colour scale from ${fmt(domain[0])} to ${fmt(domain[1])}${format === "pct" ? " or more" : ""}`} className="block overflow-visible">
      <defs>
        <linearGradient id={id}>
          {stops.map((t) => (
            <stop key={t} offset={`${t * 100}%`} stopColor={interpolator(diverging ? t * 2 - 1 : t)} />
          ))}
        </linearGradient>
      </defs>
      <g transform="translate(8,0)">
        <rect width={W} height={10} rx={2} fill={`url(#${id})`} />
        {ticks.map((t) => (
          <g key={t} transform={`translate(${x(t)},0)`}>
            <line y1={10} y2={14} stroke="var(--ink-3)" strokeWidth={1} />
            <text y={26} textAnchor="middle" className="num fill-ink-2 text-[10.5px]">
              {fmt(t)}
              {t === domain[1] && format === "pct" ? "+" : ""}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function CircleLegend({ manifest, yd }: { manifest: Manifest; yd: YearData }) {
  const zoom = useAtlas((s) => s.camera?.zoom ?? 6);
  const size = useAtlas((s) => s.circleSize);
  const scale = useAtlas((s) => s.circleScale);
  const party = useAtlas((s) => s.party);
  const partyB = useAtlas((s) => s.circlesB);
  if (size === "equal") {
    return <p className="text-[12.5px] leading-snug text-ink-2">Every polling place gets the same dot, coloured by its leading party, so large rural catchments carry no extra visual weight.</p>;
  }
  const maxV = size === "votes" ? (yd.file.partyStats[party]?.maxVotes ?? 1000) * (zoom < 8.5 ? 40 : 1) : (yd.file.partyStats[party]?.maxShare ?? 0.5);
  const values = legendValues(maxV, size);
  const radii = values.map((v) => circleRadiusPx(v, zoom, size, scale));
  const R = Math.max(8, ...radii);
  return (
    <div className="flex items-end gap-3">
      <svg width={2 * R + 4} height={2 * R + 4} aria-hidden className="shrink-0">
        {values.map((v, k) => (
          <circle key={v} cx={R + 2} cy={2 * R + 2 - radii[k]} r={Math.max(MIN_RADIUS_PX, radii[k])} fill="none" stroke="var(--ink-2)" strokeWidth={1} />
        ))}
      </svg>
      <div className="flex flex-col gap-0.5 pb-0.5">
        {[...values].reverse().map((v) => (
          <span key={v} className="num text-[11.5px] text-ink-2">
            {size === "votes" ? `${fmtInt(v)} votes` : `${fmtPct(v, 0)} share`}
          </span>
        ))}
        <span className="mt-1 flex items-center gap-1.5 text-[12px] text-ink">
          <Swatch color={partyColor(manifest, party)} ring /> {partyLabel(manifest, party)}
          {partyB && (
            <>
              <Swatch color={partyColor(manifest, partyB)} ring className="ml-2" /> {partyLabel(manifest, partyB)}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function LegendBody({ spec, manifest, yd }: { spec: LegendSpec; manifest: Manifest; yd: YearData }) {
  switch (spec.kind) {
    case "categorical":
      return (
        <ul className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
          {spec.items.map((it) => (
            <li key={it.key} className="contents">
              <Swatch color={it.color} ring className="size-3" />
              <span className="truncate text-[12.5px] text-ink">{it.label}</span>
              <span className="num text-right text-[11.5px] text-ink-3">{fmtInt(it.count)}</span>
            </li>
          ))}
          {spec.extras.map((it) => (
            <li key={it.label} className="contents">
              <Swatch color={it.color} ring className="size-3" />
              <span className="truncate text-[12px] text-ink-2">{it.label}</span>
              <span className="num text-right text-[11.5px] text-ink-3">{fmtInt(it.count)}</span>
            </li>
          ))}
        </ul>
      );
    case "sequential":
      return (
        <div>
          <GradientBar interpolator={spec.interpolator} domain={spec.domain} format={spec.format} />
          <Extras extras={spec.extras} />
        </div>
      );
    case "diverging":
      return (
        <div>
          <div className="flex justify-between px-2 text-[11.5px] font-medium text-ink-2">
            <span>{spec.negLabel}</span>
            <span>{spec.posLabel}</span>
          </div>
          <GradientBar interpolator={spec.interpolator} domain={spec.domain} format={spec.format} diverging />
          {spec.format === "pp" && <p className="-mt-1 px-2 text-[11px] text-ink-3">Percentage points</p>}
          <Extras extras={spec.extras} />
        </div>
      );
    case "circles":
      return <CircleLegend manifest={manifest} yd={yd} />;
  }
}

function Extras({ extras }: { extras: { label: string; color: string }[] }) {
  if (!extras.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
      {extras.map((e) => (
        <span key={e.label} className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
          <Swatch color={e.color} ring /> {e.label}
        </span>
      ))}
    </div>
  );
}

export function Legend({ manifest }: { manifest: Manifest }) {
  useResourceVersion();
  const shownYear = useAtlas((s) => s.shownYear);
  const mode = useAtlas((s) => s.mode);
  const circleSize = useAtlas((s) => s.circleSize);
  const party = useAtlas((s) => s.party);
  const circlesB = useAtlas((s) => s.circlesB);
  // Collapsed by default on phones, where the map has little room.
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);
  const yd = shownYear !== null ? peek<YearData>(keys.year(shownYear)) : undefined;
  const enc = useEncoding(manifest, yd);
  if (!yd || !enc) return null;
  const circleTitle = circleSize === "equal" ? "Leading party, one equal dot per polling place" : `${partyLabel(manifest, party)}${circlesB ? ` and ${partyLabel(manifest, circlesB)}` : ""} ${circleSize === "votes" ? "votes" : "vote share"} (circle area)`;
  const title = enc.legend.kind === "circles" ? circleTitle : "title" in enc.legend ? enc.legend.title : MODE_META[mode].label;
  return (
    <section aria-label="Map legend" className="panel pointer-events-auto w-full shrink-0 p-3 sm:w-[268px]" data-testid="legend">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start justify-between gap-2 text-left">
        <span className="text-[13px] leading-snug font-semibold text-ink">{title}</span>
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-ink-3 transition-transform", !open && "-rotate-90")} aria-hidden />
      </button>
      {open && (
        <div className="mt-2">
          {enc.legend.kind === "categorical" && <p className="mb-1.5 text-[11px] text-ink-3">Polling places led, {yd.year}</p>}
          <LegendBody spec={enc.legend} manifest={manifest} yd={yd} />
          {enc.notes.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-1.5 border-t border-rule pt-2">
              {enc.notes.map((n) => (
                <li key={n} className="flex gap-1.5 text-[11.5px] leading-snug text-ink-2">
                  <Info className="mt-[1px] size-3 shrink-0 text-ink-3" aria-hidden />
                  {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
