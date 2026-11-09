/**
 * Microsoft Clarity analytics. Enabled only when NEXT_PUBLIC_CLARITY_PROJECT_ID
 * is set at build time (e.g. in Cloudflare Pages → Settings → Environment
 * variables); otherwise every function here is a no-op. Nothing personal is
 * sent: only interface events and view settings (election, map mode, basemap).
 */
import Clarity from "@microsoft/clarity";

const RAW_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID?.trim() ?? "";
/** Clarity project IDs are short alphanumeric strings; anything else is ignored. */
export const CLARITY_PROJECT_ID = /^[a-z0-9]{6,32}$/i.test(RAW_ID) ? RAW_ID : "";
export const analyticsEnabled = CLARITY_PROJECT_ID !== "";

let started = false;

export function startAnalytics(): boolean {
  if (!analyticsEnabled || started || typeof window === "undefined") return started;
  Clarity.init(CLARITY_PROJECT_ID);
  started = true;
  return true;
}

export function trackEvent(name: string): void {
  if (!started) return;
  try {
    Clarity.event(name);
  } catch {
    /* analytics must never break the app */
  }
}

export function setAnalyticsTag(key: string, value: string | string[]): void {
  if (!started) return;
  try {
    Clarity.setTag(key, value);
  } catch {
    /* analytics must never break the app */
  }
}
