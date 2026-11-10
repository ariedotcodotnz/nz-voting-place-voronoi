"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { encode, type Encoding, type EncodingSettings } from "@/lib/atlas/encoding";
import { keys, loadSites, loadYear, useResource } from "@/lib/atlas/data";
import { useAtlas, type AtlasState } from "@/lib/atlas/store";
import type { YearData } from "@/lib/atlas/stats";
import type { Manifest, SitesFile } from "@/lib/atlas/types";

/** Encodings shared between hook instances (e.g. an election's layer as it
 *  moves from "shown" to "previous"), so its colours stay identical objects. */
const cache = new WeakMap<YearData, Map<string, Encoding>>();
function cachedEncode(manifest: Manifest, yd: YearData, s: EncodingSettings, ref: YearData | null, sites: SitesFile | null): Encoding {
  const key = `${JSON.stringify(s)}|${ref?.year ?? ""}|${sites ? 1 : 0}`;
  let m = cache.get(yd);
  if (!m) cache.set(yd, (m = new Map()));
  let e = m.get(key);
  if (!e) {
    e = encode(manifest, yd, s, ref, sites);
    m.set(key, e);
    if (m.size > 24) m.delete(m.keys().next().value as string);
  }
  return e;
}

/** The store fields that determine the map's colours. */
export function encodingSettings(s: AtlasState): EncodingSettings {
  return {
    mode: s.mode,
    party: s.party,
    cmpA: s.cmpA,
    partyB: s.partyB,
    measure: s.measure,
    voteType: s.voteType,
    scheme: s.scheme,
    topBloc: s.topBloc,
    blocOverrides: s.blocOverrides,
    swingTarget: s.swingTarget,
    swingMinConfidence: s.swingMinConfidence,
    scaleMode: s.scaleMode,
    scaleMax: s.scaleMax,
    shadeMargin: s.shadeMargin,
    refYear: s.refYear,
    voteKind: s.voteKind,
  };
}

export function useEncodingSettings(): EncodingSettings {
  return useAtlas(useShallow(encodingSettings));
}

/** Colour + value for every polling place of `yd` under the current settings. */
export function useEncoding(manifest: Manifest | undefined, yd: YearData | undefined): Encoding | null {
  const s = useEncodingSettings();
  const swing = s.mode === "swing";
  const refRes = useResource(manifest && swing && s.refYear ? keys.year(s.refYear) : null, () => loadYear(manifest as Manifest, s.refYear as number).promise);
  const sitesRes = useResource(manifest && swing ? keys.sites : null, () => loadSites(manifest as Manifest).promise);
  const ref = refRes?.value ?? null;
  const sites = sitesRes?.value ?? null;
  return useMemo(() => (manifest && yd ? cachedEncode(manifest, yd, s, ref, sites) : null), [manifest, yd, s, ref, sites]);
}
