"use client";

import { useEffect } from "react";
import { startAnalytics } from "@/lib/analytics";

/** Loads Microsoft Clarity in the browser when a project ID is configured. */
export function Analytics() {
  useEffect(() => {
    // The video page is for frame capture, not for visitors.
    if (window.location.pathname.startsWith("/video")) return;
    startAnalytics();
  }, []);
  return null;
}
