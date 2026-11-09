"use client";

import { useEffect, useMemo, useState } from "react";
import { TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { keys, loadLabels, useResource } from "@/lib/atlas/data";
import { declutter, type LabelCandidate } from "@/lib/atlas/labels";
import type { LabelKind, Manifest } from "@/lib/atlas/types";

/** Zoom range in which a label may appear. Localities with more polling
 *  places (busier, larger places) appear earlier. */
export function labelZoomRange(kind: LabelKind, weight: number): [number, number] {
  if (kind === "region") return [0, 5.4]; // whole-country view only; cities take over from 5.4
  if (kind === "city") return [5.4, 13.5];
  const min = weight >= 12 ? 9 : weight >= 5 ? 10 : weight >= 2 ? 11 : 12;
  return [min, 30];
}

const STYLE: Record<LabelKind, { size: number; weight: number }> = {
  region: { size: 12.5, weight: 500 },
  city: { size: 14.5, weight: 700 },
  locality: { size: 12, weight: 500 },
};

interface Label extends LabelCandidate {
  kind: LabelKind;
}

const INK: [number, number, number, number] = [20, 32, 43, 255];
const INK_2: [number, number, number, number] = [60, 72, 84, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const FONT_SETTINGS = { sdf: true, fontSize: 64, buffer: 12, radius: 16, cutoff: 0.22 };

function textMeasurer(fontFamily: string) {
  const ctx = document.createElement("canvas").getContext("2d");
  const cache = new Map<string, number>();
  return (text: string, size: number, weight: number) => {
    const k = `${weight}|${size}|${text}`;
    let w = cache.get(k);
    if (w === undefined) {
      if (ctx) {
        ctx.font = `${weight} ${size}px ${fontFamily}`;
        w = ctx.measureText(text).width;
      } else {
        w = text.length * size * 0.55;
      }
      cache.set(k, w);
    }
    return w;
  };
}

/**
 * Place names drawn by deck.gl ABOVE the election overlay (Google's own
 * labels are baked into the basemap and therefore sit underneath it).
 * Overlaps are removed with a greedy, priority-ordered declutter: cities
 * first, then regions, then localities by how many polling places they have.
 */
export function usePlaceLabelLayers(manifest: Manifest, zoom: number, satellite: boolean, enabled: boolean): Layer[] {
  const res = useResource(enabled ? keys.labels : null, () => loadLabels(manifest).promise);
  const rows = res?.value?.labels;
  const [font, setFont] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // The glyph atlas is rasterised once, so wait for the web font first.
    document.fonts.ready.then(() => live && setFont(getComputedStyle(document.body).fontFamily));
    return () => {
      live = false;
    };
  }, []);

  const measure = useMemo(() => (font ? textMeasurer(font) : null), [font]);
  const all = useMemo<Label[]>(
    () =>
      (rows ?? []).map(([text, lat, lng, kind, weight]) => ({
        text,
        lat,
        lng,
        kind,
        priority: kind === "city" ? 1e6 : kind === "region" ? 5e5 : weight,
        size: STYLE[kind].size,
        weight: STYLE[kind].weight,
      })),
    [rows],
  );

  // Declutter at the floor of a quarter-zoom step: zooming further in only
  // spreads labels apart, so nothing overlaps until the next step.
  const bucket = Math.floor(zoom * 4) / 4;
  const visible = useMemo(() => {
    if (!measure) return [];
    const inRange = all.filter((l) => {
      const [lo, hi] = labelZoomRange(l.kind, l.kind === "locality" ? l.priority : 0);
      return bucket >= lo && bucket < hi;
    });
    return declutter(inRange, bucket, measure);
  }, [all, bucket, measure]);

  return useMemo(() => {
    if (!enabled || !font || !rows) return [];
    const common = {
      fontFamily: font,
      characterSet: "auto" as const,
      fontSettings: FONT_SETTINGS,
      outlineWidth: 7,
      outlineColor: satellite ? ([20, 32, 43, 230] as [number, number, number, number]) : ([255, 255, 255, 235] as [number, number, number, number]),
      getPosition: (d: Label) => [d.lng, d.lat] as [number, number],
      getText: (d: Label) => d.text,
      getSize: (d: Label) => d.size,
      sizeUnits: "pixels" as const,
      billboard: true,
      pickable: false,
    };
    return [
      new TextLayer<Label>({
        ...common,
        id: "place-labels-region",
        data: visible.filter((l) => l.kind === "region"),
        fontWeight: 500,
        getColor: satellite ? WHITE : INK_2,
      }),
      new TextLayer<Label>({
        ...common,
        id: "place-labels-city",
        data: visible.filter((l) => l.kind === "city"),
        fontWeight: 700,
        getColor: satellite ? WHITE : INK,
      }),
      new TextLayer<Label>({
        ...common,
        id: "place-labels-local",
        data: visible.filter((l) => l.kind === "locality"),
        fontWeight: 500,
        getColor: satellite ? WHITE : INK,
      }),
    ] as Layer[];
  }, [enabled, font, rows, visible, satellite]);
}
