"use client";

import { useEffect } from "react";
import { analyticsEnabled, setAnalyticsTag, trackEvent } from "@/lib/analytics";
import { useAtlas, type AtlasState } from "@/lib/atlas/store";

/** Reports how the atlas is used (view settings as tags, key actions as
 *  events) to Microsoft Clarity. Does nothing when analytics is disabled. */
export function useAtlasAnalytics() {
  useEffect(() => {
    if (!analyticsEnabled) return;
    const tag = (s: AtlasState) => {
      if (s.year !== null) setAnalyticsTag("election", String(s.year));
      setAnalyticsTag("map_mode", s.mode);
      setAnalyticsTag("basemap", s.basemap);
      if (s.boundary) setAnalyticsTag("boundary", s.boundary);
    };
    tag(useAtlas.getState());
    return useAtlas.subscribe((s, prev) => {
      if (s.year !== prev.year || s.mode !== prev.mode || s.basemap !== prev.basemap || s.boundary !== prev.boundary) tag(s);
      if (s.mode !== prev.mode) trackEvent(`mode_${s.mode}`);
      if (s.playing && !prev.playing) trackEvent("timeline_play");
      if (s.selected && s.selected !== prev.selected) trackEvent("polling_place_selected");
      if (s.panel !== prev.panel && s.panel) trackEvent(`open_${s.panel}`);
    });
  }, []);
}
