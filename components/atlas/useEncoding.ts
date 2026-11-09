"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { encode, type Encoding, type EncodingSettings } from "@/lib/atlas/encoding";
import { keys, loadSites, loadYear, useResource } from "@/lib/atlas/data";
import { useAtlas } from "@/lib/atlas/store";
import type { YearData } from "@/lib/atlas/stats";
import type { Manifest } from "@/lib/atlas/types";

export function useEncodingSettings(): EncodingSettings {
  return useAtlas(
    useShallow((s) => ({
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
    })),
  );
}

/** Colour + value for every polling place of `yd` under the current settings. */
export function useEncoding(manifest: Manifest | undefined, yd: YearData | undefined): Encoding | null {
  const s = useEncodingSettings();
  const swing = s.mode === "swing";
  const refRes = useResource(manifest && swing && s.refYear ? keys.year(s.refYear) : null, () => loadYear(manifest as Manifest, s.refYear as number).promise);
  const sitesRes = useResource(manifest && swing ? keys.sites : null, () => loadSites(manifest as Manifest).promise);
  const ref = refRes?.value ?? null;
  const sites = sitesRes?.value ?? null;
  return useMemo(() => (manifest && yd ? encode(manifest, yd, s, ref, sites) : null), [manifest, yd, s, ref, sites]);
}
