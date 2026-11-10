"use client";

import { useEffect, useRef } from "react";
import { parseUrlState, serialiseUrlState } from "@/lib/atlas/url";
import { urlSlice, useAtlas } from "@/lib/atlas/store";

/** Two-way sync between the store and the query string. The URL is read once
 *  on mount (deep links) and then rewritten with replaceState, debounced, so
 *  the browser history is not flooded while panning. Back/forward re-applies. */
export function useUrlSync(ready: boolean) {
  const applied = useRef(false);
  useEffect(() => {
    // Apply the deep link once; the listener below must be added on every run,
    // because Strict Mode removes it in a cleanup before replaying the effect.
    if (!applied.current) {
      applied.current = true;
      useAtlas.getState().set(parseUrlState(window.location.search));
    }
    const onPop = () => {
      const state = parseUrlState(window.location.search);
      useAtlas.getState().set(state);
      // The map reads the view only when it is created, so move it explicitly.
      if (state.view) useAtlas.getState().requestFlyTo(state.view);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = "";
    const write = () => {
      const qs = serialiseUrlState(urlSlice(useAtlas.getState()));
      if (qs === last) return;
      last = qs;
      window.history.replaceState(null, "", `${window.location.pathname}${qs}${window.location.hash}`);
    };
    const unsub = useAtlas.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, 250);
    });
    write();
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [ready]);
}
