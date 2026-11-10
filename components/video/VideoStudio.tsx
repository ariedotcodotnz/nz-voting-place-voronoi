"use client";

/**
 * Vertical (9:16) timeline video frames for social media, rendered for
 * frame-by-frame capture by scripts/make-videos.mjs.
 *
 * The map is drawn by a standalone deck.gl instance over a plain background
 * (no Google basemap), so every frame is deterministic and no map tiles are
 * recorded. Catchments, colours and statistics come from the same data and
 * encoding code as the atlas. Statistics cover polling places inside the
 * area's bounding box and always belong to a real election.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Deck, MapView, WebMercatorViewport, type Layer } from "@deck.gl/core";
import { GeoJsonLayer, TextLayer } from "@deck.gl/layers";
import { chunksFor, loadChunk, loadLabels, loadLo, loadManifest, loadYear } from "@/lib/atlas/data";
import { encode, partyColor, partyLabel, type EncodingSettings } from "@/lib/atlas/encoding";
import { declutter, type LabelCandidate } from "@/lib/atlas/labels";
import { resolveVoteType, siteRow, viewFor, type YearData } from "@/lib/atlas/stats";
import { DEFAULT_URL_STATE } from "@/lib/atlas/url";
import { fmtPct } from "@/lib/atlas/format";
import { frameKey, frameState, totalFrames, DEFAULT_TIMING, type FrameState } from "@/lib/video/schedule";
import type { CatchmentFeature, Manifest } from "@/lib/atlas/types";
import areasConfig from "@/config/videos.json";

const W = 1080;
const H = 1920;
const MAP = 1080;
const MAP_TOP = 330;
const PAD = 64;
const TITLE_SIZE = 86;
const BG = "#14202B";
const WATER = "#22323F";

type Area = { id: string; title: string; bbox: [number, number, number, number] };

interface Prepared {
  manifest: Manifest;
  years: number[];
  data: CatchmentFeature[][];
  colors: [number, number, number, number][][];
  stats: { parties: { id: string; share: number }[]; votes: number; advanceIncluded: boolean; unavailable: string | null }[];
  status: string[];
  labels: (LabelCandidate & { kind: string })[];
  font: string;
  titleSize: number;
  view: { longitude: number; latitude: number; zoom: number };
}

/** Resolved once the data is loaded and deck.gl's WebGL device is up. */
export interface VideoInfo {
  frames: number;
  fps: number;
  area: string;
  /** WebGL renderer string, e.g. "ANGLE (NVIDIA, ... Direct3D11 ...)". */
  gpu: string;
  /** True when WebGL runs on the CPU (SwiftShader, llvmpipe). */
  software: boolean;
  /** keys[f] identifies what frame f draws; equal keys are identical frames. */
  keys: string[];
}

declare global {
  interface Window {
    __video?: { ready: Promise<VideoInfo>; render: (frame: number) => Promise<void> };
  }
}

function params() {
  const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const areas = areasConfig.areas as Area[];
  const area = areas.find((a) => a.id === q.get("area")) ?? areas[0];
  return { area, mode: (q.get("mode") ?? "winner") as EncodingSettings["mode"], party: q.get("party") ?? "labour", voteKind: (q.get("vk") === "c" ? "candidate" : "party") as "party" | "candidate", site: q.get("site") ?? "" };
}

async function prepare(area: Area, mode: EncodingSettings["mode"], party: string, voteKind: "party" | "candidate"): Promise<Prepared> {
  const manifest = await loadManifest().promise;
  const years = manifest.elections.map((e) => e.year);
  const fit = new WebMercatorViewport({ width: MAP, height: MAP }).fitBounds(
    [
      [area.bbox[0], area.bbox[1]],
      [area.bbox[2], area.bbox[3]],
    ],
    { padding: 24 },
  );
  const view = { longitude: fit.longitude, latitude: fit.latitude, zoom: fit.zoom };
  const method = manifest.boundary.default;
  const settings: EncodingSettings = { ...DEFAULT_URL_STATE, mode, party, voteKind, swingMinConfidence: "high", scaleMode: "fixed", scaleMax: 0.6, shadeMargin: false, refYear: null, swingTarget: { kind: "party", id: party } };
  const inBox = (lng: number, lat: number) => lng >= area.bbox[0] && lng <= area.bbox[2] && lat >= area.bbox[1] && lat <= area.bbox[3];

  const data: CatchmentFeature[][] = [];
  const colors: Prepared["colors"] = [];
  const stats: Prepared["stats"] = [];
  const status: string[] = [];
  for (const y of years) {
    const [yd, lo] = await Promise.all([loadYear(manifest, y).promise, loadLo(manifest, y, method).promise]);
    const chunks = await Promise.all(chunksFor(manifest, y, method, area.bbox, 12).map((c) => loadChunk(c).promise));
    const hi = chunks.flat();
    const hiIdx = new Set(hi.map((f) => f.properties.i));
    data.push(lo.filter((f) => !hiIdx.has(f.properties.i)).concat(hi));
    const enc = encode(manifest, yd, settings, null, null);
    colors.push(enc.colors);
    // No data for this view (e.g. electorate votes in a year whose files don't
    // give candidates' parties): say why instead of showing an empty map as results.
    const unavailable = enc.voteType === null ? (enc.notes[0] ?? `Not available for ${y}.`) : null;
    status.push(yd.file.status === "preliminary" ? "Preliminary count" : "Final results");
    // Party (or electorate) vote at polling places inside the area.
    const vd: YearData | null = viewFor(yd, voteKind);
    const totals = new Map<string, number>();
    let sum = 0;
    if (vd) {
      const vt = resolveVoteType(vd, "all") ?? "all";
      for (let i = 0; i < vd.n; i++) {
        if (!inBox(yd.file.sites.lng[i], yd.file.sites.lat[i])) continue;
        const row = siteRow(vd, i, vt);
        if (!row) continue;
        row.votes.forEach((v, k) => totals.set(vd.parties[k], (totals.get(vd.parties[k]) ?? 0) + v));
        sum += row.total;
      }
    }
    stats.push({ parties: [...totals.entries()].map(([id, v]) => ({ id, share: sum ? v / sum : 0 })).sort((a, b) => b.share - a.share), votes: sum, advanceIncluded: yd.hasAdvance, unavailable });
  }

  await document.fonts.ready;
  const font = getComputedStyle(document.body).fontFamily;
  const ctx = document.createElement("canvas").getContext("2d");
  const measure = (text: string, size: number, weight: number) => {
    if (!ctx) return text.length * size * 0.55;
    ctx.font = `${weight} ${size}px ${font}`;
    return ctx.measureText(text).width;
  };
  const rows = (await loadLabels(manifest).promise).labels;
  const pad = 0.02;
  const cand = rows
    .filter(([, lat, lng, kind, w]) => kind !== "region" && lng > area.bbox[0] - pad && lng < area.bbox[2] + pad && lat > area.bbox[1] - pad && lat < area.bbox[3] + pad && (kind === "city" || w >= 2))
    .map(([text, lat, lng, kind, w]) => ({ text, lat, lng, kind, priority: kind === "city" ? 1e6 : w, size: kind === "city" ? 34 : 23, weight: kind === "city" ? 700 : 600 }));
  // Drop labels whose text would be cut off at the edge of the map frame.
  const vp = new WebMercatorViewport({ width: MAP, height: MAP, ...view });
  const inside = cand.filter((l) => {
    const [x, y] = vp.project([l.lng, l.lat]);
    const hw = measure(l.text, l.size, l.weight) / 2 + 14;
    return x - hw > 0 && x + hw < MAP && y - l.size > 0 && y + l.size < MAP;
  });
  const labels = declutter(inside, view.zoom, measure, 10, 6).slice(0, 26);
  // Keep the title on one line: a second line pushes the subtitle under the map.
  let titleSize = TITLE_SIZE;
  while (titleSize > 48 && measure(`How ${area.title} voted`, titleSize, 800) > W - 2 * PAD) titleSize -= 2;
  return { manifest, years, data, colors, stats, status, labels, font, titleSize, view };
}

export default function VideoStudio() {
  const p = useMemo(() => params(), []);
  const canvas = useRef<HTMLCanvasElement>(null);
  const deck = useRef<Deck<MapView> | null>(null);
  const [prep, setPrep] = useState<Prepared | null>(null);
  // Every render() call is a new request (n), so asking for the frame already
  // on screen still redraws and resolves instead of waiting forever.
  const [req, setReq] = useState({ frame: 0, n: 0 });
  const pending = useRef<(() => void) | null>(null);

  // Load everything, create deck, expose the capture API.
  useEffect(() => {
    let cancelled = false;
    let resolveReady: (v: VideoInfo) => void = () => undefined;
    let rejectReady: (e: Error) => void = () => undefined;
    const ready = new Promise<VideoInfo>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    window.__video = {
      ready,
      render: (f: number) =>
        new Promise<void>((res) => {
          pending.current = res;
          setReq((r) => ({ frame: f, n: r.n + 1 }));
        }),
    };
    prepare(p.area, p.mode, p.party, p.voteKind)
      .then((pr) => {
        if (cancelled) return;
        let gpu = "unknown";
        let software = false;
        deck.current = new Deck({
          canvas: canvas.current as HTMLCanvasElement,
          width: MAP,
          height: MAP,
          useDevicePixels: 1,
          views: new MapView({ repeat: false }),
          viewState: { ...pr.view, pitch: 0, bearing: 0 },
          controller: false,
          layers: [],
          // Report the GPU from deck's own device. Probing it with a second WebGL
          // context once deck's exists hung the first frame on Windows (D3D11).
          onDeviceInitialized: (device) => {
            gpu = device.info.renderer;
            software = device.info.gpuType === "cpu" || /swiftshader|llvmpipe|basic render|software/i.test(gpu);
          },
          // The device is created asynchronously: only report ready once it exists.
          onLoad: () => {
            const n = pr.years.length;
            const frames = totalFrames(n);
            const keys = Array.from({ length: frames }, (_, f) => frameKey(frameState(f, n)));
            resolveReady({ frames, fps: DEFAULT_TIMING.fps, area: p.area.id, gpu, software, keys });
          },
          onAfterRender: () => {
            const done = pending.current;
            if (done) {
              pending.current = null;
              // Let the browser paint the HTML overlay too before capture.
              requestAnimationFrame(() => requestAnimationFrame(() => done()));
            }
          },
        });
        setPrep(pr);
      })
      .catch((e: unknown) => rejectReady(e instanceof Error ? e : new Error(String(e))));
    return () => {
      cancelled = true;
      deck.current?.finalize();
      deck.current = null;
    };
  }, [p]);

  const state: FrameState | null = useMemo(() => (prep ? frameState(req.frame, prep.years.length) : null), [prep, req]);

  // Draw the map for the current frame.
  useEffect(() => {
    if (!prep || !state || !deck.current) return;
    const layers: Layer[] = prep.years.map((y, k) => {
      const opacity = (k === state.from ? 1 : k === state.to ? state.t : 0) * state.mapIn * 0.92;
      return new GeoJsonLayer<CatchmentFeature["properties"]>({
        id: `y${y}`,
        data: prep.data[k],
        // All elections stay mounted (hidden when not shown) so none is re-triangulated mid-video.
        visible: opacity > 0,
        opacity,
        filled: true,
        stroked: true,
        getFillColor: (f) => prep.colors[k][f.properties.i] ?? [80, 90, 100, 255],
        getLineColor: [255, 255, 255, 110],
        getLineWidth: 0.8,
        lineWidthUnits: "pixels",
        pickable: false,
      });
    });
    layers.push(
      new TextLayer<(typeof prep.labels)[number]>({
        id: "labels",
        data: prep.labels,
        getPosition: (d) => [d.lng, d.lat],
        getText: (d) => d.text,
        getSize: (d) => d.size,
        sizeUnits: "pixels",
        fontFamily: prep.font,
        fontWeight: 650,
        characterSet: "auto",
        fontSettings: { sdf: true, fontSize: 96, buffer: 16, radius: 20, cutoff: 0.2 },
        outlineWidth: 9,
        outlineColor: [20, 32, 43, 235],
        getColor: [255, 255, 255, 255],
        opacity: state.mapIn,
      }),
    );
    deck.current.setProps({ layers });
    deck.current.redraw("video-frame");
  }, [prep, state]);

  const ready = Boolean(prep && state);
  const y = ready ? prep!.years[state!.shown] : null;
  const st = ready ? prep!.stats[state!.shown] : null;
  const top = st ? st.parties.filter((x) => x.share > 0).slice(0, 5) : [];
  // "Other" is the rest of a real total; with no votes at all there is nothing to split.
  const other = st && st.votes > 0 ? Math.max(0, 1 - top.reduce((s, x) => s + x.share, 0)) : 0;
  const modeLine = p.mode === "winner" ? "Leading party at each polling place" : p.mode === "bloc" ? "Strongest bloc at each polling place" : `${prep ? partyLabel(prep.manifest, p.party) : ""} share at each polling place`;
  const voteWord = p.voteKind === "candidate" ? "electorate vote" : "party vote";

  // The canvas is always mounted so deck.gl can attach to it before data loads.
  return (
    <div style={{ width: W, height: H, background: BG, color: "#fff", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }} data-testid="video-stage">
      <header style={{ height: MAP_TOP, padding: `${PAD}px ${PAD}px 0`, boxSizing: "border-box" }}>
        <p style={{ fontSize: 28, fontWeight: 600, opacity: 0.62 }}>Party Vote Atlas</p>
        <h1 style={{ fontSize: prep?.titleSize ?? TITLE_SIZE, fontWeight: 800, lineHeight: 1.0, letterSpacing: "-0.03em", marginTop: 12, whiteSpace: "nowrap" }}>How {p.area.title} voted</h1>
        {prep && (
          <p style={{ fontSize: 32, opacity: 0.74, marginTop: 14 }}>
            {voteWord.charAt(0).toUpperCase() + voteWord.slice(1)} at every polling place, {prep.years[0]}–{prep.years[prep.years.length - 1]}
          </p>
        )}
      </header>

      <div style={{ width: MAP, height: MAP, background: WATER, flex: "none" }}>
        <canvas ref={canvas} width={MAP} height={MAP} style={{ width: MAP, height: MAP, display: "block" }} />
      </div>

      {ready && prep && state && st && (
        <section style={{ flex: 1, display: "flex", flexDirection: "column", padding: "34px 64px 40px", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <span style={{ fontSize: 132, fontWeight: 800, lineHeight: 0.82, letterSpacing: "-0.045em" }} data-testid="video-year">
              {y}
            </span>
            <span style={{ textAlign: "right", fontSize: 26, lineHeight: 1.3, opacity: 0.8 }}>
              {prep.status[state.shown]}
              <br />
              {modeLine}
            </span>
          </div>

          {st.unavailable ? (
            <p style={{ marginTop: 30, fontSize: 27, lineHeight: 1.35, opacity: 0.85 }} data-testid="video-unavailable">
              {st.unavailable}
            </p>
          ) : (
            <>
              <div style={{ display: "flex", height: 26, marginTop: 30, borderRadius: 6, overflow: "hidden", gap: 3 }} aria-label="Vote share in this area">
                {top.map((x) => (
                  <div key={x.id} style={{ width: `${x.share * 100}%`, background: partyColor(prep.manifest, x.id) }} />
                ))}
                {other > 0.002 && <div style={{ width: `${other * 100}%`, background: "#5B6773" }} />}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", columnGap: 26, rowGap: 6, marginTop: 16, fontSize: 27 }}>
                {top.slice(0, 4).map((x) => (
                  <span key={x.id} style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: partyColor(prep.manifest, x.id), display: "inline-block" }} />
                    <span style={{ fontWeight: 600 }}>{partyLabel(prep.manifest, x.id)}</span>
                    <span style={{ opacity: 0.78 }}>{fmtPct(x.share)}</span>
                  </span>
                ))}
              </div>
            </>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
            {prep.years.map((yy, k) => (
              <span key={yy} style={{ fontSize: 25, fontWeight: k === state.shown ? 800 : 500, opacity: k === state.shown ? 1 : k < state.shown ? 0.62 : 0.36, borderBottom: k === state.shown ? "4px solid #fff" : "4px solid transparent", paddingBottom: 5 }}>
                {yy}
              </span>
            ))}
          </div>

          <p style={{ marginTop: "auto", fontSize: 20, lineHeight: 1.4, opacity: state.outro && p.site ? 1 : 0.6 }}>
            {state.outro && p.site ? (
              <span style={{ fontSize: 30, fontWeight: 700 }}>Explore every polling place at {p.site}</span>
            ) : (
              <>
                Share of the {voteWord} cast at polling places in this area{st.advanceIncluded ? ", including advance votes" : ", election day only"}. Shapes are estimated catchments, not official boundaries. Data: Electoral Commission, Stats NZ, LINZ.
              </>
            )}
          </p>
        </section>
      )}
    </div>
  );
}
