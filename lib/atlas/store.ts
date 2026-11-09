"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { DEFAULT_URL_STATE, type MapMode, type UrlState } from "./url";

export type ScaleMode = "fixed" | "year" | "custom";
export type PlaybackSpeed = "slow" | "normal" | "fast";

export const PLAYBACK_MS: Record<PlaybackSpeed, number> = { slow: 3200, normal: 2000, fast: 1100 };

export interface HoverInfo {
  x: number;
  y: number;
  /** site index in the current election, or a cluster of indices */
  index: number;
  cluster?: number[];
  layer: string;
}

export interface AtlasState extends UrlState {
  // Transient UI state (not in the URL)
  hover: HoverInfo | null;
  playing: boolean;
  speed: PlaybackSpeed;
  loop: boolean;
  scaleMode: ScaleMode;
  scaleMax: number;
  shadeMargin: boolean;
  circleScale: number;
  circleOpacity: number;
  cluster: boolean;
  overlayOpacity: number;
  /** Draw place names above the election overlay. */
  placeLabels: boolean;
  swingMinConfidence: "high" | "probable";
  panel: null | "settings" | "method" | "blocs";
  flyTo: { bbox?: [number, number, number, number]; lat?: number; lng?: number; zoom?: number; nonce: number } | null;
  /** Current map viewport [w,s,e,n] and zoom (updated when the map settles). */
  camera: { bbox: [number, number, number, number]; zoom: number } | null;
  /** Election currently drawn (lags `year` until its data has loaded). */
  shownYear: number | null;
  set: (patch: Partial<AtlasState>) => void;
  setMode: (mode: MapMode) => void;
  select: (stableId: string | null) => void;
  requestFlyTo: (t: Omit<NonNullable<AtlasState["flyTo"]>, "nonce">) => void;
}

export const useAtlas = create<AtlasState>((set) => ({
  ...DEFAULT_URL_STATE,
  hover: null,
  playing: false,
  speed: "normal",
  loop: false,
  scaleMode: "fixed",
  scaleMax: 0.6,
  shadeMargin: false,
  circleScale: 1,
  circleOpacity: 0.72,
  cluster: true,
  overlayOpacity: 0.78,
  placeLabels: true,
  swingMinConfidence: "high",
  panel: null,
  flyTo: null,
  camera: null,
  shownYear: null,
  set: (patch) => set(patch),
  setMode: (mode) => set({ mode, hover: null }),
  select: (stableId) => set({ selected: stableId }),
  requestFlyTo: (t) => set({ flyTo: { ...t, nonce: Date.now() + Math.random() } }),
}));

export function urlSlice(s: AtlasState): UrlState {
  return {
    year: s.year,
    refYear: s.refYear,
    mode: s.mode,
    party: s.party,
    cmpA: s.cmpA,
    partyB: s.partyB,
    circlesB: s.circlesB,
    measure: s.measure,
    voteType: s.voteType,
    boundary: s.boundary,
    basemap: s.basemap,
    scheme: s.scheme,
    topBloc: s.topBloc,
    blocOverrides: s.blocOverrides,
    swingTarget: s.swingTarget,
    circleSize: s.circleSize,
    selected: s.selected,
    view: s.view,
    electorates: s.electorates,
  };
}

/** Control-panel view of the store: everything except high-frequency fields
 *  (hover, camera, view), so panels don't re-render while the mouse moves. */
export function useControls() {
  return useAtlas(
    useShallow((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { hover, camera, view, flyTo, ...rest } = s;
      return rest;
    }),
  );
}
