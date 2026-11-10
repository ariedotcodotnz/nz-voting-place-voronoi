import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, renderHook } from "@testing-library/react";
import { failedKeys, peek, request, useResourceVersion } from "@/lib/atlas/data";

/** The pattern MapContents uses: request once from an effect whose
 *  dependencies do not change, then read the cache while rendering. */
function useRequestedOnce(key: string, loader: () => Promise<string>) {
  useResourceVersion();
  useEffect(() => {
    request(key, loader);
  }, [key, loader]);
  return peek<string>(key);
}

describe("resource cache", () => {
  afterEach(() => vi.useRealTimers());

  it("retries a failed load by itself, so a consumer that requested it once still gets it", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const loader = () => (++calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve("loaded"));
    const { result } = renderHook(() => useRequestedOnce("retry-consumer", loader));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBeUndefined();
    expect(failedKeys()).toContain("retry-consumer");
    expect(calls).toBe(1);

    // No further request() from the consumer: the cache retries after its back-off.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(calls).toBe(2);
    expect(result.current).toBe("loaded");
    expect(failedKeys()).not.toContain("retry-consumer");
  });

  it("keeps reporting the failure while a retry is in flight, and backs off further", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let finish: (v: string) => void = () => undefined;
    const loader = () => {
      calls++;
      if (calls <= 2) return Promise.reject(new Error("offline"));
      return new Promise<string>((res) => (finish = res));
    };
    await expect(request("retry-backoff", loader).promise).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(1000); // second attempt fails
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1999); // back-off is now 2 s
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1); // third attempt starts and is still loading
    expect(calls).toBe(3);
    expect(failedKeys()).toContain("retry-backoff");
    finish("loaded");
    await vi.advanceTimersByTimeAsync(0);
    expect(peek("retry-backoff")).toBe("loaded");
    expect(failedKeys()).not.toContain("retry-backoff");
  });
});
