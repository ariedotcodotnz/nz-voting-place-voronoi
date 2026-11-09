"use client";

import { useEffect } from "react";
import { startAnalytics } from "@/lib/analytics";

/** Loads Microsoft Clarity in the browser when a project ID is configured. */
export function Analytics() {
  useEffect(() => {
    startAnalytics();
  }, []);
  return null;
}
