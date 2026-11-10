import { afterEach, describe, expect, it, vi } from "vitest";
import { failedKeys, peek, request } from "@/lib/atlas/data";

describe("resource cache", () => {
  afterEach(() => vi.useRealTimers());

  it("retries a failed load after a back-off instead of failing all session", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const loader = () => (++calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve("loaded"));

    await expect(request("retry-test", loader).promise).rejects.toThrow("offline");
    expect(failedKeys()).toContain("retry-test");
    // Within the back-off the failed entry is returned as is.
    expect(request("retry-test", loader).status).toBe("error");
    expect(calls).toBe(1);

    vi.advanceTimersByTime(1000);
    await expect(request("retry-test", loader).promise).resolves.toBe("loaded");
    expect(calls).toBe(2);
    expect(peek("retry-test")).toBe("loaded");
    expect(failedKeys()).not.toContain("retry-test");
  });
});
