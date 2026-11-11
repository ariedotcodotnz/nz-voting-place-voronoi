"use client";

import { MessageSquareWarning, Minus, Plus, Maximize } from "lucide-react";
import { useMap } from "@vis.gl/react-google-maps";
import { useAtlas } from "@/lib/atlas/store";
import { NZ_BOUNDS } from "../map/mapStyles";
import { cn } from "@/lib/utils";
import type { Manifest } from "@/lib/atlas/types";
import { ReportLink } from "./ReportLink";

export function MapButtons({ manifest }: { manifest: Manifest }) {
  const map = useMap();
  const btn = "grid size-9 place-items-center text-ink hover:bg-wash focus-visible:z-10";
  return (
    <div className="panel pointer-events-auto flex shrink-0 flex-col self-end overflow-hidden max-sm:hidden">
      <button type="button" className={btn} aria-label="Zoom in" onClick={() => map?.setZoom((map.getZoom() ?? 5) + 1)}>
        <Plus className="size-4" aria-hidden />
      </button>
      <button type="button" className={cn(btn, "border-y border-rule")} aria-label="Zoom out" onClick={() => map?.setZoom((map.getZoom() ?? 5) - 1)}>
        <Minus className="size-4" aria-hidden />
      </button>
      <button type="button" className={btn} aria-label="Show all of New Zealand" title="Show all of New Zealand" onClick={() => useAtlas.getState().requestFlyTo({ bbox: [NZ_BOUNDS.west, NZ_BOUNDS.south, NZ_BOUNDS.east, NZ_BOUNDS.north] })}>
        <Maximize className="size-4" aria-hidden />
      </button>
      <ReportLink manifest={manifest} className={cn(btn, "border-t border-rule")} label="Report a problem">
        <MessageSquareWarning className="size-4" aria-hidden />
      </ReportLink>
    </div>
  );
}
