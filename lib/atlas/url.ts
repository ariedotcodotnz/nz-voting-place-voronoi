/**
 * URL <-> view-state codec. Every shareable aspect of the view is encoded in
 * short query parameters so links survive static hosting (no server routes).
 */
import type { BoundaryMethod, VoteType } from "./types";

export const MAP_MODES = ["winner", "bloc", "party", "circles", "compare", "swing", "split"] as const;
export type VoteKindParam = "party" | "candidate";
export type MapMode = (typeof MAP_MODES)[number];
export type Basemap = "roadmap" | "satellite" | "hybrid";
export type Measure = "share" | "votes";
export type CircleSize = "votes" | "share" | "equal";
export type SwingTarget = { kind: "party" | "bloc"; id: string };

export interface UrlState {
  year: number | null;
  refYear: number | null;
  mode: MapMode;
  party: string;
  cmpA: string;
  partyB: string;
  circlesB: string | null;
  measure: Measure;
  voteType: VoteType;
  /** Party votes, or electorate (candidate) votes grouped by the candidate's party. */
  voteKind: VoteKindParam;
  boundary: BoundaryMethod | null;
  basemap: Basemap;
  scheme: string;
  topBloc: string;
  blocOverrides: Record<string, string | null>;
  swingTarget: SwingTarget;
  circleSize: CircleSize;
  selected: string | null;
  view: { lat: number; lng: number; zoom: number } | null;
  electorates: boolean;
}

export const DEFAULT_URL_STATE: UrlState = {
  year: null,
  refYear: null,
  mode: "winner",
  party: "green",
  cmpA: "labour",
  partyB: "national",
  circlesB: null,
  measure: "share",
  voteType: "all",
  voteKind: "party",
  boundary: null,
  basemap: "roadmap",
  scheme: "core",
  topBloc: "left",
  blocOverrides: {},
  swingTarget: { kind: "party", id: "labour" },
  circleSize: "votes",
  selected: null,
  view: null,
  electorates: false,
};

const ID_RE = /^[a-z0-9_-]{1,40}$/;

function num(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function id(v: string | null, fallback: string): string {
  return v && ID_RE.test(v) ? v : fallback;
}

export function parseUrlState(search: string): UrlState {
  const q = new URLSearchParams(search);
  const d = DEFAULT_URL_STATE;
  let view: UrlState["view"] = null;
  const vs = q.get("v");
  if (vs) {
    const [lat, lng, zoom] = vs.split(",").map(Number);
    if ([lat, lng, zoom].every(Number.isFinite) && lat >= -90 && lat <= 90 && zoom >= 2 && zoom <= 22) view = { lat, lng, zoom };
  }
  const overrides: Record<string, string | null> = {};
  for (const pair of (q.get("bo") ?? "").split(",").filter(Boolean)) {
    const [p, b] = pair.split(":");
    if (p && ID_RE.test(p) && b !== undefined && (b === "-" || ID_RE.test(b))) overrides[p] = b === "-" ? null : b;
  }
  const st = q.get("st");
  let swingTarget = d.swingTarget;
  if (st) {
    const [k, v] = st.split(":");
    if ((k === "p" || k === "b") && v && ID_RE.test(v)) swingTarget = { kind: k === "p" ? "party" : "bloc", id: v };
  }
  const cb = q.get("cb");
  return {
    year: num(q.get("y")),
    refYear: num(q.get("ref")),
    mode: pick(q.get("m"), MAP_MODES, d.mode),
    party: id(q.get("p"), d.party),
    cmpA: id(q.get("ca"), d.cmpA),
    partyB: id(q.get("pb"), d.partyB),
    circlesB: cb && ID_RE.test(cb) ? cb : null,
    measure: pick(q.get("ms"), ["share", "votes"] as const, d.measure),
    voteType: pick(q.get("vt"), ["all", "eday", "advance"] as const, d.voteType),
    voteKind: q.get("vk") === "c" ? "candidate" : "party",
    boundary: q.get("bm") ? pick(q.get("bm"), ["meshblock", "voronoi"] as const, "meshblock") : null,
    basemap: pick(q.get("map"), ["roadmap", "satellite", "hybrid"] as const, d.basemap),
    scheme: id(q.get("bs"), d.scheme),
    topBloc: id(q.get("tb"), d.topBloc),
    blocOverrides: overrides,
    swingTarget,
    circleSize: pick(q.get("cs"), ["votes", "share", "equal"] as const, d.circleSize),
    selected: q.get("sel") && /^[0-9a-z-]{1,40}$/i.test(q.get("sel") as string) ? q.get("sel") : null,
    view,
    electorates: q.get("el") === "1",
  };
}

/** Serialise only non-default values, in a stable order. */
export function serialiseUrlState(s: UrlState): string {
  const d = DEFAULT_URL_STATE;
  const q = new URLSearchParams();
  if (s.year !== null) q.set("y", String(s.year));
  if (s.mode !== d.mode) q.set("m", s.mode);
  if (s.party !== d.party) q.set("p", s.party);
  if (s.cmpA !== d.cmpA) q.set("ca", s.cmpA);
  if (s.partyB !== d.partyB) q.set("pb", s.partyB);
  if (s.circlesB) q.set("cb", s.circlesB);
  if (s.refYear !== null) q.set("ref", String(s.refYear));
  if (s.measure !== d.measure) q.set("ms", s.measure);
  if (s.voteType !== d.voteType) q.set("vt", s.voteType);
  if (s.voteKind !== d.voteKind) q.set("vk", "c");
  if (s.boundary) q.set("bm", s.boundary);
  if (s.basemap !== d.basemap) q.set("map", s.basemap);
  if (s.scheme !== d.scheme) q.set("bs", s.scheme);
  if (s.topBloc !== d.topBloc) q.set("tb", s.topBloc);
  const bo = Object.entries(s.blocOverrides)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, b]) => `${p}:${b ?? "-"}`)
    .join(",");
  if (bo) q.set("bo", bo);
  if (s.swingTarget.kind !== d.swingTarget.kind || s.swingTarget.id !== d.swingTarget.id) q.set("st", `${s.swingTarget.kind === "party" ? "p" : "b"}:${s.swingTarget.id}`);
  if (s.circleSize !== d.circleSize) q.set("cs", s.circleSize);
  if (s.selected) q.set("sel", s.selected);
  if (s.electorates) q.set("el", "1");
  if (s.view) q.set("v", `${s.view.lat.toFixed(4)},${s.view.lng.toFixed(4)},${s.view.zoom.toFixed(2)}`);
  const str = q.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  return str ? `?${str}` : "";
}
