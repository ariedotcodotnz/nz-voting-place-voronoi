"use client";

import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay, type GoogleMapsOverlayProps } from "@deck.gl/google-maps";
import type { LayersList } from "@deck.gl/core";

/** Unused copies of the layers: deck.gl refuses layers another Deck has initialised. */
const freshLayers = (list: LayersList): LayersList => list.map((l) => (Array.isArray(l) ? freshLayers(l) : l ? l.clone({}) : l));

/**
 * Attaches one deck.gl overlay to the Google map. Layer changes go through
 * `setProps`, so switching elections, modes or basemaps never recreates the
 * map or the WebGL context. With a vector Map ID deck.gl renders interleaved
 * with the basemap; on raster maps (including satellite) it uses an aligned
 * overlay canvas.
 *
 * A fresh GoogleMapsOverlay is created per attachment: deck.gl reuses its
 * Deck instance across setMap(null)/setMap(map) and keeps it bound to the
 * first overlay pane, which breaks after a remount (e.g. React Strict Mode).
 */
export function DeckOverlay(props: GoogleMapsOverlayProps) {
  const map = useMap();
  const overlay = useRef<GoogleMapsOverlay | null>(null);
  const latest = useRef(props);

  useEffect(() => {
    latest.current = props;
    overlay.current?.setProps(props);
  }, [props]);

  useEffect(() => {
    if (!map) return;
    let o: GoogleMapsOverlay | null = null;
    const attach = (rebuilt = false) => {
      const props = latest.current;
      o = new GoogleMapsOverlay({ interleaved: true, ...props, ...(rebuilt && props.layers ? { layers: freshLayers(props.layers) } : {}) });
      o.setMap(map);
      overlay.current = o;
    };
    // deck.gl's own "renderingtype_changed" listener is never removed, so wait
    // for the rendering type here with a listener we can clean up.
    let listener: google.maps.MapsEventListener | null = null;
    if (map.getRenderingType() === google.maps.RenderingType.UNINITIALIZED) {
      listener = map.addListener("renderingtype_changed", () => {
        listener?.remove();
        listener = null;
        attach();
      });
    } else {
      attach();
    }

    // On raster maps (no Map ID, satellite) deck.gl draws on its own canvas and
    // ignores a lost WebGL context, so the colours would stay frozen or blank
    // until a reload. Browsers drop contexts after a GPU switch or driver reset,
    // or under memory pressure: start a fresh overlay instead. Vector maps
    // recover through Google's onContextRestored.
    const div = map.getDiv();
    let rebuild: ReturnType<typeof setTimeout> | null = null;
    let lastRebuild = 0;
    const onContextLost = () => {
      if (rebuild || map.getRenderingType() === google.maps.RenderingType.VECTOR) return;
      // At most one rebuild every 5 s, in case new contexts are lost too.
      const wait = Math.max(100, lastRebuild + 5000 - performance.now());
      rebuild = setTimeout(() => {
        rebuild = null;
        lastRebuild = performance.now();
        try {
          o?.finalize();
        } catch {
          /* tearing down a lost context can throw; the new overlay replaces it */
        }
        attach(true);
      }, wait);
    };
    // Capture: webglcontextlost does not bubble from deck's canvas.
    div.addEventListener("webglcontextlost", onContextLost, true);

    return () => {
      listener?.remove();
      div.removeEventListener("webglcontextlost", onContextLost, true);
      if (rebuild) clearTimeout(rebuild);
      overlay.current = null;
      o?.finalize();
    };
  }, [map]);

  return null;
}
