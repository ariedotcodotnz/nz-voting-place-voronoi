"use client";

import { useMemo, useState } from "react";
import { line, scaleLinear, scalePoint } from "d3";
import { fmtPct } from "@/lib/atlas/format";
import type { LinkConfidence, Manifest, PartyId } from "@/lib/atlas/types";
import { cn } from "@/lib/utils";

export interface HistoryPoint {
  year: number;
  /** party -> share; undefined when the location had no polling place that year */
  shares: Record<PartyId, number> | null;
  total: number;
  confidence: LinkConfidence | "self" | null;
}

const W = 340;
const H = 168;
const M = { t: 10, r: 10, b: 22, l: 34 };

/** Party-vote share at one physical location across elections. Elections
 *  without a polling place here are shown as gaps, never interpolated. */
export function HistoryChart({ manifest, points, current, initialParties }: { manifest: Manifest; points: HistoryPoint[]; current: number; initialParties: PartyId[] }) {
  const [enabled, setEnabled] = useState<Set<PartyId>>(() => new Set(initialParties));
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const candidates = useMemo(() => {
    const best = new Map<PartyId, number>();
    for (const p of points) for (const [k, v] of Object.entries(p.shares ?? {})) best.set(k, Math.max(best.get(k) ?? 0, v));
    return [...best.entries()].filter(([, v]) => v >= 0.02).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [points]);
  const years = points.map((p) => p.year);
  const x = scalePoint<number>().domain(years).range([M.l, W - M.r]).padding(0.3);
  const ymax = Math.max(0.1, ...points.flatMap((p) => [...enabled].map((k) => p.shares?.[k] ?? 0)));
  const y = scaleLinear().domain([0, Math.min(1, ymax * 1.08)]).nice(4).range([H - M.b, M.t]);
  const lowConf = (p: HistoryPoint) => p.confidence === "probable" || p.confidence === "chained";
  const hp = points.find((p) => p.year === hoverYear);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Party vote share at this location by election" onMouseLeave={() => setHoverYear(null)}>
        {y.ticks(4).map((t) => (
          <g key={t} transform={`translate(0,${y(t)})`}>
            <line x1={M.l} x2={W - M.r} stroke="var(--rule)" strokeWidth={1} />
            <text x={M.l - 6} dy="0.32em" textAnchor="end" className="num fill-ink-3 text-[10px]">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {points.map((p) => (
          <g key={p.year}>
            {!p.shares && <rect x={(x(p.year) ?? 0) - 9} y={M.t} width={18} height={H - M.b - M.t} fill="var(--wash)" />}
            {p.year === current && <line x1={x(p.year)} x2={x(p.year)} y1={M.t} y2={H - M.b} stroke="var(--ink)" strokeWidth={1} strokeOpacity={0.35} />}
            <text x={x(p.year)} y={H - 6} textAnchor="middle" className={cn("num text-[10px]", p.year === current ? "fill-ink font-semibold" : "fill-ink-3")}>
              {p.year}
            </text>
            <rect x={(x(p.year) ?? 0) - x.step() / 2} y={0} width={x.step()} height={H} fill="transparent" onMouseEnter={() => setHoverYear(p.year)} />
          </g>
        ))}
        {[...enabled].map((pid) => {
          const color = manifest.parties[pid]?.color ?? "#888";
          const path = line<HistoryPoint>()
            .defined((p) => p.shares !== null && p.shares[pid] !== undefined)
            .x((p) => x(p.year) ?? 0)
            .y((p) => y(p.shares?.[pid] ?? 0))(points);
          return (
            <g key={pid}>
              {path && <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}
              {points.map((p) =>
                p.shares && p.shares[pid] !== undefined ? (
                  <circle key={p.year} cx={x(p.year)} cy={y(p.shares[pid])} r={3.2} fill={lowConf(p) ? "var(--paper)" : color} stroke={lowConf(p) ? color : "var(--paper)"} strokeWidth={lowConf(p) ? 1.5 : 1} />
                ) : null,
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 min-h-[34px] text-[11.5px] text-ink-2" aria-live="polite">
        {hp ? (
          hp.shares ? (
            <p>
              <span className="font-semibold text-ink">{hp.year}</span>{" "}
              {[...enabled]
                .filter((k) => hp.shares?.[k] !== undefined)
                .map((k) => `${manifest.parties[k]?.short ?? k} ${fmtPct(hp.shares![k])}`)
                .join(", ")}
              {lowConf(hp) && " (location match is uncertain, not directly comparable)"}
            </p>
          ) : (
            <p>
              <span className="font-semibold text-ink">{hp.year}</span> No polling place at this location.
            </p>
          )
        ) : (
          <p className="text-ink-3">Shaded years had no polling place here. Hollow points mark uncertain location matches.</p>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label="Parties shown in the chart">
        {candidates.map((pid) => {
          const on = enabled.has(pid);
          return (
            <button
              key={pid}
              type="button"
              aria-pressed={on}
              onClick={() => setEnabled((s) => {
                const n = new Set(s);
                if (n.has(pid)) n.delete(pid);
                else n.add(pid);
                return n;
              })}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] text-[11.5px]", on ? "border-ink/20 bg-paper text-ink" : "border-transparent bg-wash text-ink-3")}
            >
              <span className="size-2 rounded-full" style={{ background: on ? manifest.parties[pid]?.color : "var(--ink-3)" }} aria-hidden />
              {manifest.parties[pid]?.short ?? pid}
            </button>
          );
        })}
      </div>
    </div>
  );
}
