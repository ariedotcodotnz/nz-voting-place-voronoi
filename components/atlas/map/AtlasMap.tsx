"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map as GoogleMap, useMap, type MapCameraChangedEvent } from "@vis.gl/react-google-maps";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { DeckOverlay } from "./DeckOverlay";
import { basemapStyles, NZ_BOUNDS } from "./mapStyles";
import { usePlaceLabelLayers } from "./placeLabels";
import { useEncoding } from "../useEncoding";
import { chunksFor, keys, loadChunk, loadElectorates, loadLo, loadYear, peek, useResourceVersion } from "@/lib/atlas/data";
import { padBBox } from "@/lib/atlas/geometry";
import { useAtlas } from "@/lib/atlas/store";
import { leader, resolveVoteType, share, siteRow, clusterPoints, type YearData } from "@/lib/atlas/stats";
import { circleRadiusPx, clusterCellDeg, MIN_RADIUS_PX } from "@/lib/atlas/circles";
import { toRGBA, type RGBA } from "@/lib/atlas/color";
import { partyColor } from "@/lib/atlas/encoding";
import type { BoundaryMethod, CatchmentFeature, Manifest } from "@/lib/atlas/types";

const FADE_MS = 700;
const INK: RGBA = [20, 32, 43, 255];
const WHITE: RGBA = [255, 255, 255, 255];

interface CirclePoint {
  lng: number;
  lat: number;
  value: number;
  color: RGBA;
  index: number;
  members: number[];
  party: string;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Catchment features for one election: national simplified geometry, with
 *  detailed geometry substituted for every chunk loaded in the viewport. */
function useCatchments(manifest: Manifest, year: number | null, method: BoundaryMethod): CatchmentFeature[] | null {
  useResourceVersion();
  const camera = useAtlas((s) => s.camera);
  const lo = year !== null ? peek<CatchmentFeature[]>(keys.lo(year, method)) : undefined;
  const chunks = year !== null && camera ? chunksFor(manifest, year, method, padBBox(camera.bbox, 0.15), camera.zoom) : [];
  useEffect(() => {
    chunks.forEach((c) => loadChunk(c));
  });
  const loaded = chunks.filter((c) => peek(keys.chunk(c.file)));
  const sig = loaded.map((c) => c.file).join("|");
  return useMemo(() => {
    if (!lo) return null;
    if (!loaded.length) return lo;
    const hi = loaded.flatMap((c) => peek<CatchmentFeature[]>(keys.chunk(c.file)) ?? []);
    const hiIdx = new Set(hi.map((f) => f.properties.i));
    return lo.filter((f) => !hiIdx.has(f.properties.i)).concat(hi);
    // `sig` captures which chunks are loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lo, sig]);
}

export function AtlasMap({ manifest }: { manifest: Manifest }) {
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || undefined;
  const basemap = useAtlas((s) => s.basemap);
  const placeLabels = useAtlas((s) => s.placeLabels);
  const set = useAtlas((s) => s.set);
  const styles = useMemo(() => basemapStyles(placeLabels), [placeLabels]);
  const initialView = useMemo(() => useAtlas.getState().view, []);
  const [liveZoom, setLiveZoom] = useState(initialView?.zoom ?? 5.5);
  const raf = useRef<number | null>(null);

  const onCameraChanged = useCallback((ev: MapCameraChangedEvent) => {
    const z = ev.detail.zoom;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setLiveZoom(z));
  }, []);

  const onIdle = useCallback(
    (ev: { map: google.maps.Map }) => {
      const m = ev.map;
      const b = m.getBounds();
      const c = m.getCenter();
      const z = m.getZoom();
      if (!b || !c || z === undefined) return;
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      set({ camera: { bbox: [sw.lng(), sw.lat(), ne.lng(), ne.lat()], zoom: z }, view: { lat: c.lat(), lng: c.lng(), zoom: z } });
    },
    [set],
  );

  return (
    <GoogleMap
      className="absolute inset-0"
      mapId={mapId}
      mapTypeId={basemap}
      styles={mapId ? undefined : styles}
      {...(initialView ? { defaultCenter: { lat: initialView.lat, lng: initialView.lng }, defaultZoom: initialView.zoom } : { defaultBounds: { ...NZ_BOUNDS, padding: 24 } })}
      gestureHandling="greedy"
      disableDefaultUI
      clickableIcons={false}
      keyboardShortcuts
      minZoom={4}
      maxZoom={18}
      backgroundColor="#E8EBEE"
      onCameraChanged={onCameraChanged}
      onIdle={onIdle}
      reuseMaps
    >
      <MapContents manifest={manifest} zoom={liveZoom} />
    </GoogleMap>
  );
}

function MapContents({ manifest, zoom }: { manifest: Manifest; zoom: number }) {
  const map = useMap();
  useResourceVersion();
  const year = useAtlas((s) => s.year);
  const boundary = useAtlas((s) => s.boundary) ?? manifest.boundary.default;
  const mode = useAtlas((s) => s.mode);
  const basemap = useAtlas((s) => s.basemap);
  const overlayOpacity = useAtlas((s) => s.overlayOpacity);
  const showElectorates = useAtlas((s) => s.electorates);
  const selected = useAtlas((s) => s.selected);
  const party = useAtlas((s) => s.party);
  const circlesB = useAtlas((s) => s.circlesB);
  const circleSize = useAtlas((s) => s.circleSize);
  const circleScale = useAtlas((s) => s.circleScale);
  const circleOpacity = useAtlas((s) => s.circleOpacity);
  const cluster = useAtlas((s) => s.cluster);
  const voteType = useAtlas((s) => s.voteType);
  const flyTo = useAtlas((s) => s.flyTo);
  const placeLabels = useAtlas((s) => s.placeLabels);
  const set = useAtlas((s) => s.set);
  const select = useAtlas((s) => s.select);

  // ---- Election transition: keep drawing the previous election until the
  // next one is loaded, then crossfade (visual only — labels and statistics
  // switch to the new election immediately and never show interpolated values).
  const [view, setView] = useState<{ shown: number | null; prev: number | null; transition: number }>({ shown: null, prev: null, transition: 0 });
  const [fade, setFade] = useState(1);
  const { shown, prev } = view;
  useEffect(() => {
    if (year === null) return;
    loadYear(manifest, year);
    loadLo(manifest, year, boundary);
  }, [manifest, year, boundary]);
  const ready = year !== null && Boolean(peek(keys.year(year))) && Boolean(peek(keys.lo(year, boundary)));
  const drawn = useRef<{ year: number | null; boundary: BoundaryMethod }>({ year: null, boundary });

  // 1. Switch the drawn election once its data is ready.
  useEffect(() => {
    if (!ready || year === null) return;
    const d = drawn.current;
    if (d.year === year && d.boundary === boundary) return;
    const animate = d.year !== null && d.year !== year && !prefersReducedMotion();
    const from = d.year;
    drawn.current = { year, boundary };
    set({ shownYear: year });
    setView((v) => ({ shown: year, prev: animate ? from : null, transition: v.transition + 1 }));
  }, [ready, year, boundary, set]);

  // 2. Animate the crossfade for each transition.
  useEffect(() => {
    if (view.prev === null) {
      setFade(1);
      return;
    }
    setFade(0);
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now: number) {
      const t = Math.min(1, (now - start) / FADE_MS);
      setFade(t);
      if (t < 1) frame = requestAnimationFrame(tick);
      else setView((v) => ({ ...v, prev: null }));
    });
    return () => cancelAnimationFrame(frame);
  }, [view.transition, view.prev]);

  const ydShown = shown !== null ? peek<YearData>(keys.year(shown)) : undefined;
  const ydPrev = prev !== null ? peek<YearData>(keys.year(prev)) : undefined;
  const dataShown = useCatchments(manifest, shown, boundary);
  const dataPrev = useCatchments(manifest, prev, boundary);
  const encShown = useEncoding(manifest, ydShown);
  const encPrev = useEncoding(manifest, ydPrev);

  useEffect(() => {
    if (showElectorates && shown !== null) loadElectorates(manifest, shown);
  }, [manifest, shown, showElectorates]);
  const electorateFeatures = showElectorates && shown !== null ? peek<CatchmentFeature[]>(keys.electorates(shown)) : undefined;

  // ---- Fly-to requests from search, details panel, etc.
  useEffect(() => {
    if (!map || !flyTo) return;
    if (flyTo.bbox) {
      const [w, s, e, n] = flyTo.bbox;
      map.fitBounds({ west: w, south: s, east: e, north: n }, 48);
      if (flyTo.zoom) {
        const listener = google.maps.event.addListenerOnce(map, "idle", () => {
          if ((map.getZoom() ?? 0) > (flyTo.zoom as number)) map.setZoom(flyTo.zoom as number);
        });
        return () => listener.remove();
      }
    } else if (flyTo.lat !== undefined && flyTo.lng !== undefined) {
      map.panTo({ lat: flyTo.lat, lng: flyTo.lng });
      if (flyTo.zoom) map.setZoom(flyTo.zoom);
    }
  }, [map, flyTo]);

  const satellite = basemap !== "roadmap";
  // Over imagery the fills are lighter and every boundary gets a white outline,
  // so the satellite view stays readable.
  const baseOpacity = satellite ? overlayOpacity * 0.78 : overlayOpacity;
  const strokeOn = zoom >= 9 || satellite;

  const circlePoints = useMemo((): CirclePoint[] => {
    if (mode !== "circles" || !ydShown || !encShown) return [];
    const vt = resolveVoteType(ydShown, voteType);
    if (!vt) return [];
    const pts: CirclePoint[] = [];
    const lats = ydShown.file.sites.lat;
    const lngs = ydShown.file.sites.lng;
    if (circleSize === "equal") {
      for (let i = 0; i < ydShown.n; i++) {
        const row = siteRow(ydShown, i, vt);
        const L = row ? leader(row.votes, row.total) : null;
        pts.push({ lng: lngs[i], lat: lats[i], value: 1, color: L && !L.tie ? toRGBA(partyColor(manifest, ydShown.parties[L.index])) : [142, 149, 156, 255], index: i, members: [i], party: L && !L.tie ? ydShown.parties[L.index] : "" });
      }
      return pts;
    }
    const parties = [party, ...(circlesB && circlesB !== party ? [circlesB] : [])];
    for (const p of parties) {
      const k = ydShown.partyIndex.get(p);
      if (k === undefined) continue;
      const color = toRGBA(partyColor(manifest, p));
      const raw = [];
      for (let i = 0; i < ydShown.n; i++) {
        const row = siteRow(ydShown, i, vt);
        if (!row || row.total <= 0) continue;
        const value = circleSize === "votes" ? row.votes[k] : share(row.votes[k], row.total);
        if (value > 0) raw.push({ lng: lngs[i], lat: lats[i], value, index: i });
      }
      const cell = circleSize === "votes" ? clusterCellDeg(zoom, cluster) : 0;
      const grouped = clusterPoints(raw, cell);
      for (const c of grouped) pts.push({ lng: c.lng, lat: c.lat, value: c.value, color, index: c.members.length === 1 ? c.members[0] : -1, members: c.members, party: p });
    }
    // Largest first so small circles stay visible on top.
    return pts.sort((a, b) => b.value - a.value);
    // zoom only matters through the clustering cell size
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ydShown, encShown, voteType, circleSize, party, circlesB, cluster, manifest, circleSize === "votes" ? clusterCellDeg(zoom, cluster) : 0]);

  const onHover = useCallback(
    (info: PickingInfo) => {
      const obj = info.object as CatchmentFeature | CirclePoint | undefined;
      if (map) map.setOptions({ draggableCursor: obj ? "pointer" : null });
      if (!obj) {
        set({ hover: null });
        return;
      }
      if ("geometry" in obj) set({ hover: { x: info.x, y: info.y, index: obj.properties.i, layer: "catchments" } });
      else set({ hover: { x: info.x, y: info.y, index: obj.index, cluster: obj.members.length > 1 ? obj.members : undefined, layer: `circles:${obj.party}` } });
    },
    [map, set],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
      const obj = info.object as CatchmentFeature | CirclePoint | undefined;
      if (!obj || !ydShown) {
        return;
      }
      if (!("geometry" in obj) && obj.members.length > 1) {
        useAtlas.getState().requestFlyTo({ lat: obj.lat, lng: obj.lng, zoom: Math.min(11, zoom + 2.5) });
        return;
      }
      const i = "geometry" in obj ? obj.properties.i : obj.index;
      select(ydShown.file.sites.id[i] ?? null);
    },
    [ydShown, select, zoom],
  );

  const layers = useMemo(() => {
    const out: Layer[] = [];
    const lineColor: RGBA = satellite ? [255, 255, 255, 190] : mode === "circles" ? [20, 32, 43, 60] : [255, 255, 255, 150];
    const catchLayer = (y: number, data: CatchmentFeature[], colors: RGBA[], opacity: number, interactive: boolean) =>
      new GeoJsonLayer<CatchmentFeature["properties"]>({
        id: `catchments-${y}-${boundary}`,
        data,
        filled: mode !== "circles",
        stroked: strokeOn || mode === "circles",
        getFillColor: (f) => colors[f.properties.i] ?? [200, 205, 210, 255],
        getLineColor: lineColor,
        lineWidthUnits: "pixels",
        getLineWidth: satellite ? 1 : 0.6,
        lineWidthMinPixels: mode === "circles" ? 0.5 : 0.4,
        opacity,
        pickable: interactive && mode !== "circles",
        autoHighlight: interactive && mode !== "circles",
        highlightColor: [255, 255, 255, 80],
        updateTriggers: { getFillColor: [colors], getLineColor: [satellite, mode] },
      });
    if (prev !== null && dataPrev && encPrev) out.push(catchLayer(prev, dataPrev, encPrev.colors, baseOpacity, false));
    if (shown !== null && dataShown && encShown) out.push(catchLayer(shown, dataShown, encShown.colors, prev !== null ? baseOpacity * fade : baseOpacity, true));

    if (electorateFeatures?.length) {
      out.push(
        new GeoJsonLayer({
          id: `electorates-${shown}`,
          data: electorateFeatures,
          filled: false,
          stroked: true,
          getLineColor: satellite ? [255, 255, 255, 235] : [20, 32, 43, 200],
          getLineWidth: 1.6,
          lineWidthUnits: "pixels",
          extensions: [new PathStyleExtension({ dash: true })],
          getDashArray: [6, 4],
          dashJustified: true,
          pickable: false,
        } as ConstructorParameters<typeof GeoJsonLayer>[0]),
      );
    }

    if (mode !== "circles" && ydShown && zoom >= 11.5) {
      out.push(
        new ScatterplotLayer<number>({
          id: "polling-places",
          data: Array.from({ length: ydShown.n }, (_, i) => i),
          getPosition: (i) => [ydShown.file.sites.lng[i], ydShown.file.sites.lat[i]],
          getRadius: 2.4,
          radiusUnits: "pixels",
          getFillColor: [20, 32, 43, 200],
          stroked: true,
          getLineColor: [255, 255, 255, 230],
          lineWidthMinPixels: 1,
          pickable: false,
        }),
      );
    }

    if (mode === "circles" && circlePoints.length) {
      out.push(
        new ScatterplotLayer<CirclePoint>({
          id: `circles-${shown}`,
          data: circlePoints,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: (d) => circleRadiusPx(d.value, zoom, circleSize, circleScale),
          radiusUnits: "pixels",
          radiusMinPixels: MIN_RADIUS_PX,
          getFillColor: (d) => [d.color[0], d.color[1], d.color[2], Math.round(circleOpacity * 255)],
          stroked: true,
          getLineColor: satellite ? [255, 255, 255, 255] : [255, 255, 255, 210],
          lineWidthUnits: "pixels",
          getLineWidth: 0.8,
          pickable: true,
          autoHighlight: true,
          highlightColor: [20, 32, 43, 90],
          updateTriggers: { getRadius: [zoom, circleSize, circleScale], getFillColor: [circleOpacity] },
        }),
      );
    }

    const selIndex = selected && ydShown ? ydShown.stableIndex.get(selected) : undefined;
    if (selIndex !== undefined && ydShown) {
      const feats = (dataShown ?? []).filter((f) => f.properties.i === selIndex);
      if (mode !== "circles" && feats.length) {
        out.push(new GeoJsonLayer({ id: "selected-halo", data: feats, filled: false, stroked: true, getLineColor: WHITE, getLineWidth: 5, lineWidthUnits: "pixels", pickable: false }));
        out.push(new GeoJsonLayer({ id: "selected-line", data: feats, filled: false, stroked: true, getLineColor: INK, getLineWidth: 2.2, lineWidthUnits: "pixels", pickable: false }));
      }
      out.push(
        new ScatterplotLayer({
          id: "selected-point",
          data: [selIndex],
          getPosition: (i: number) => [ydShown.file.sites.lng[i], ydShown.file.sites.lat[i]],
          getRadius: 5,
          radiusUnits: "pixels",
          getFillColor: INK,
          stroked: true,
          getLineColor: WHITE,
          lineWidthMinPixels: 2,
          pickable: false,
        }),
      );
    }
    return out;
  }, [boundary, mode, satellite, strokeOn, prev, dataPrev, encPrev, shown, dataShown, encShown, baseOpacity, fade, electorateFeatures, ydShown, zoom, circlePoints, circleSize, circleScale, circleOpacity, selected]);

  // Place names go last so they are drawn above every election layer.
  const labelLayers = usePlaceLabelLayers(manifest, zoom, satellite, placeLabels);
  const allLayers = useMemo(() => [...layers, ...labelLayers], [layers, labelLayers]);
  const overlayProps = useMemo(() => ({ layers: allLayers, onHover, onClick, pickingRadius: 2 }), [allLayers, onHover, onClick]);
  return <DeckOverlay {...overlayProps} />;
}
