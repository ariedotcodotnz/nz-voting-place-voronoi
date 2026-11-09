"use client";

/**
 * Asset loading and caching. Every asset is fetched at most once per session;
 * hashed file names (from the manifest) make them immutable, so the browser and
 * Cloudflare can cache them indefinitely. Nothing here talks to a backend —
 * recolouring and re-aggregation happen entirely in the browser.
 */
import { useSyncExternalStore } from "react";
import { decodeGeometryFile, viewportIntersects, type BBox } from "./geometry";
import { buildYearData, type YearData } from "./stats";
import type { BoundaryMethod, CatchmentFeature, ChunkRef, EncodedGeometryFile, LabelsFile, Manifest, ReportFile, ResultsFile, SearchFile, SitesFile } from "./types";

export const DATA_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data/`;

type Status = "loading" | "ready" | "error";
export interface Resource<T> {
  status: Status;
  value?: T;
  error?: Error;
  promise: Promise<T>;
}

const entries = new Map<string, Resource<unknown>>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function request<T>(key: string, loader: () => Promise<T>): Resource<T> {
  const existing = entries.get(key) as Resource<T> | undefined;
  if (existing) return existing;
  const entry: Resource<T> = { status: "loading", promise: Promise.resolve() as unknown as Promise<T> };
  entry.promise = loader().then(
    (value) => {
      entry.status = "ready";
      entry.value = value;
      notify();
      return value;
    },
    (error: unknown) => {
      entry.status = "error";
      entry.error = error instanceof Error ? error : new Error(String(error));
      notify();
      throw entry.error;
    },
  );
  entry.promise.catch(() => undefined);
  entries.set(key, entry as Resource<unknown>);
  return entry;
}

export function peek<T>(key: string): T | undefined {
  const e = entries.get(key) as Resource<T> | undefined;
  return e?.status === "ready" ? e.value : undefined;
}

/** Subscribe a component to the resource cache (re-renders when anything loads). */
export function useResourceVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

export function useResource<T>(key: string | null, loader: () => Promise<T>): Resource<T> | null {
  useResourceVersion();
  if (key === null) return null;
  return request(key, loader);
}

async function fetchJSON<T>(rel: string, init?: RequestInit): Promise<T> {
  const res = await fetch(DATA_BASE + rel, init);
  if (!res.ok) throw new Error(`Failed to load ${rel}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/* --------------------------------------------------------------------- */

export const keys = {
  manifest: "manifest",
  year: (y: number) => `year:${y}`,
  lo: (y: number, m: BoundaryMethod) => `lo:${y}:${m}`,
  chunk: (file: string) => `chunk:${file}`,
  electorates: (y: number) => `electorates:${y}`,
  sites: "sites",
  search: "search",
  report: "report",
  labels: "labels",
};

export const loadManifest = () => request(keys.manifest, () => fetchJSON<Manifest>("manifest.json", { cache: "no-cache" }));

function election(manifest: Manifest, year: number) {
  const e = manifest.elections.find((x) => x.year === year);
  if (!e) throw new Error(`Election ${year} is not in the manifest`);
  return e;
}

export const loadYear = (manifest: Manifest, year: number) =>
  request<YearData>(keys.year(year), async () => buildYearData(await fetchJSON<ResultsFile>(election(manifest, year).files.results)));

export const loadLo = (manifest: Manifest, year: number, method: BoundaryMethod) =>
  request<CatchmentFeature[]>(keys.lo(year, method), async () => {
    const f = election(manifest, year).files[method];
    if (!f) throw new Error(`No ${method} catchments for ${year}`);
    return decodeGeometryFile(await fetchJSON<EncodedGeometryFile>(f.lo), "lo");
  });

export const loadChunk = (chunk: ChunkRef) => request<CatchmentFeature[]>(keys.chunk(chunk.file), async () => decodeGeometryFile(await fetchJSON<EncodedGeometryFile>(chunk.file), chunk.file));

export const loadElectorates = (manifest: Manifest, year: number) =>
  request<CatchmentFeature[]>(keys.electorates(year), async () => {
    const f = election(manifest, year).files.electorates;
    if (!f) return [];
    return decodeGeometryFile(await fetchJSON<EncodedGeometryFile>(f), "electorates");
  });

export const loadSites = (manifest: Manifest) => request<SitesFile>(keys.sites, () => fetchJSON<SitesFile>(manifest.files.sites));
export const loadSearch = (manifest: Manifest) => request<SearchFile>(keys.search, () => fetchJSON<SearchFile>(manifest.files.search));
export const loadLabels = (manifest: Manifest) =>
  request<LabelsFile>(keys.labels, async () => (manifest.files.labels ? fetchJSON<LabelsFile>(manifest.files.labels) : { labels: [] }));
export const loadReport = (manifest: Manifest) => request<ReportFile>(keys.report, () => fetchJSON<ReportFile>(manifest.files.report));

/** Detailed geometry is used from this zoom level; below it the national
 *  simplified layer is sufficient (≤1 px error). */
export const HI_ZOOM = 9.5;

export function chunksFor(manifest: Manifest, year: number, method: BoundaryMethod, viewport: BBox | null, zoom: number): ChunkRef[] {
  if (!viewport || zoom < HI_ZOOM) return [];
  const f = manifest.elections.find((e) => e.year === year)?.files[method];
  if (!f) return [];
  return f.hi.filter((c) => viewportIntersects(viewport, c.bbox));
}

/** Resolve when everything needed to draw `year` in the current view is cached
 *  (used by playback so transitions never show a half-loaded election). */
export async function preloadYear(manifest: Manifest, year: number, method: BoundaryMethod, viewport: BBox | null, zoom: number): Promise<void> {
  await Promise.all([loadYear(manifest, year).promise, loadLo(manifest, year, method).promise, ...chunksFor(manifest, year, method, viewport, zoom).map((c) => loadChunk(c).promise)]);
}
