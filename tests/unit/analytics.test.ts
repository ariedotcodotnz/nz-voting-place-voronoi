import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  document.getElementById("clarity-script")?.remove();
  delete (window as unknown as { clarity?: unknown }).clarity;
});

async function load(id: string | undefined) {
  if (id !== undefined) vi.stubEnv("NEXT_PUBLIC_CLARITY_PROJECT_ID", id);
  document.head.appendChild(document.createElement("script")); // Clarity inserts before the first script
  return import("@/lib/analytics");
}

describe("Microsoft Clarity", () => {
  it("does nothing without a project ID", async () => {
    const a = await load(undefined);
    expect(a.analyticsEnabled).toBe(false);
    expect(a.startAnalytics()).toBe(false);
    expect(() => a.trackEvent("timeline_play")).not.toThrow();
    expect(document.getElementById("clarity-script")).toBeNull();
  });

  it("ignores a malformed project ID", async () => {
    const a = await load("abc/../evil?x=");
    expect(a.analyticsEnabled).toBe(false);
  });

  it("loads the Clarity tag once and queues events and tags", async () => {
    const a = await load("abc123xyz9");
    expect(a.startAnalytics()).toBe(true);
    a.startAnalytics();
    const scripts = document.querySelectorAll("#clarity-script");
    expect(scripts).toHaveLength(1);
    expect((scripts[0] as HTMLScriptElement).src).toContain("https://www.clarity.ms/tag/abc123xyz9");
    a.trackEvent("timeline_play");
    a.setAnalyticsTag("election", "2023");
    const queue = (window as unknown as { clarity: { q: unknown[][] } }).clarity.q.map((args) => Array.from(args));
    expect(queue).toContainEqual(["event", "timeline_play"]);
    expect(queue).toContainEqual(["set", "election", "2023"]);
  });
});
