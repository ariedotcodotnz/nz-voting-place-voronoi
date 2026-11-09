"use client";

import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay, type GoogleMapsOverlayProps } from "@deck.gl/google-maps";

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
    const attach = () => {
      o = new GoogleMapsOverlay({ interleaved: true, ...latest.current });
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
    return () => {
      listener?.remove();
      overlay.current = null;
      o?.finalize();
    };
  }, [map]);

  return null;
}
