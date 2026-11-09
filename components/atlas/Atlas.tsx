"use client";

import { useEffect, useRef, useState } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import { AtlasMap } from "./map/AtlasMap";
import { Splash } from "./AtlasLoader";
import { useUrlSync } from "./useUrlSync";
import { SetupMessage } from "./panels/SetupMessage";
import { TitleBlock } from "./panels/TitleBlock";
import { ControlBar } from "./panels/ControlBar";
import { Legend } from "./panels/Legend";
import { Timeline } from "./panels/Timeline";
import { DetailsPanel } from "./panels/DetailsPanel";
import { HoverTooltip } from "./panels/HoverTooltip";
import { MapButtons } from "./panels/MapButtons";
import { MethodDialog } from "./panels/MethodDialog";
import { keys, loadManifest, useResource } from "@/lib/atlas/data";
import { useAtlas } from "@/lib/atlas/store";
import { nearestYear } from "@/lib/atlas/stats";
import type { Manifest } from "@/lib/atlas/types";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

export default function Atlas() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const manifestRes = useResource(keys.manifest, () => loadManifest().promise);
  const manifest = manifestRes?.value;
  const [authFailed, setAuthFailed] = useState(false);
  const year = useAtlas((s) => s.year);
  useUrlSync(Boolean(manifest) && year !== null);

  useEffect(() => {
    // Google Maps calls this global when the key is rejected.
    window.gm_authFailure = () => setAuthFailed(true);
    return () => {
      delete window.gm_authFailure;
    };
  }, []);

  // Resolve the requested election (deep link) against what actually exists.
  useEffect(() => {
    if (!manifest) return;
    const s = useAtlas.getState();
    const years = manifest.elections.map((e) => e.year);
    const patch: Partial<typeof s> = {};
    const y = s.year !== null && years.includes(s.year) ? s.year : s.year !== null ? nearestYear(years, s.year) : years[years.length - 1];
    if (y !== s.year) patch.year = y;
    if (s.refYear !== null && !years.includes(s.refYear)) patch.refYear = nearestYear(years, s.refYear);
    if (s.refYear === null) patch.refYear = years[Math.max(0, years.indexOf(y as number) - 1)] ?? null;
    if (!s.boundary) patch.boundary = manifest.boundary.default;
    if (!manifest.parties[s.party]) patch.party = "green";
    if (!manifest.parties[s.partyB]) patch.partyB = "national";
    if (!manifest.parties[s.cmpA]) patch.cmpA = "labour";
    if (!manifest.blocs.schemes.some((x) => x.id === s.scheme)) patch.scheme = manifest.blocs.schemes[0].id;
    if (Object.keys(patch).length) s.set(patch);
  }, [manifest]);

  if (!apiKey) return <SetupMessage reason="missing" />;
  if (manifestRes?.status === "error") return <SetupMessage reason="data" />;
  if (!manifest || year === null) return <Splash />;

  return (
    <APIProvider apiKey={apiKey} libraries={[]} region="NZ" language="en-NZ">
      <AtlasShell manifest={manifest} />
      {authFailed && <SetupMessage reason="invalid" />}
    </APIProvider>
  );
}

function AtlasShell({ manifest }: { manifest: Manifest }) {
  const selected = useAtlas((s) => s.selected);
  const controls = useRef<HTMLDivElement>(null);
  const [controlsBottom, setControlsBottom] = useState(120);
  // The details panel starts just below the (variable-height) control bar.
  useEffect(() => {
    const el = controls.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setControlsBottom(el.getBoundingClientRect().bottom));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="atlas" style={{ ["--controls-bottom" as string]: `${controlsBottom}px` }}>
      <AtlasMap manifest={manifest} />
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="flex items-start justify-between gap-3 p-3 sm:p-4">
          <TitleBlock manifest={manifest} />
          <div ref={controls}>
            <ControlBar manifest={manifest} />
          </div>
        </div>
        <div className="min-h-0 flex-1" />
        <div className={cn("flex flex-col items-stretch gap-2 p-3 sm:flex-row sm:items-end sm:p-4", selected && "sm:pr-[412px]")}>
          <Legend manifest={manifest} />
          <Timeline manifest={manifest} />
          <MapButtons />
        </div>
      </div>
      <DetailsPanel manifest={manifest} />
      <HoverTooltip manifest={manifest} />
      <MethodDialog manifest={manifest} />
    </div>
  );
}
