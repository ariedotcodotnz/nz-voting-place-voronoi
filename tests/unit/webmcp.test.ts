import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { atlasTools, useWebMcp, type WebMcpTool } from "@/components/atlas/useWebMcp";
import { useAtlas } from "@/lib/atlas/store";
import { manifest } from "./fixtures";
import type { Manifest } from "@/lib/atlas/types";

const m = manifest as unknown as Manifest;
const tool = (name: string) => atlasTools(m).find((t) => t.name === name) as WebMcpTool;

/** A document.modelContext that enforces the spec's registerTool rules. */
function fakeModelContext() {
  const tools = new Map<string, WebMcpTool>();
  return {
    tools,
    registerTool(t: WebMcpTool, options: { signal?: AbortSignal } = {}) {
      if (tools.has(t.name)) return Promise.reject(new DOMException("duplicate", "InvalidStateError"));
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(t.name) || !t.description) return Promise.reject(new DOMException("invalid", "InvalidStateError"));
      JSON.stringify(t.inputSchema);
      if (options.signal?.aborted) return Promise.resolve();
      tools.set(t.name, t);
      options.signal?.addEventListener("abort", () => tools.delete(t.name));
      return Promise.resolve();
    },
  };
}

describe("WebMCP tools", () => {
  beforeEach(() => useAtlas.getState().set({ year: 2020, shownYear: 2020, mode: "winner", party: "green", voteKind: "party", selected: null }));
  afterEach(() => {
    delete (document as { modelContext?: unknown }).modelContext;
  });

  it("registers every tool once under Strict Mode and unregisters them on unmount", async () => {
    const mc = fakeModelContext();
    Object.defineProperty(document, "modelContext", { value: mc, configurable: true });
    const { unmount } = renderHook(() => useWebMcp(m), { wrapper: StrictMode });
    await new Promise((r) => setTimeout(r, 0));
    expect([...mc.tools.keys()].sort()).toEqual(["get_current_view", "get_national_result", "get_polling_place", "list_elections", "search_places", "show_on_map"]);
    unmount();
    expect(mc.tools.size).toBe(0);
  });

  it("does nothing in browsers without WebMCP", () => {
    expect(() => renderHook(() => useWebMcp(m))).not.toThrow();
  });

  it("marks only show_on_map as changing state, and keeps descriptions within Chrome's budgets", () => {
    for (const t of atlasTools(m)) {
      expect(t.annotations?.readOnlyHint).toBe(t.name !== "show_on_map");
      expect(t.description.length).toBeLessThanOrEqual(500);
    }
  });

  it("lists elections and reports official national shares", async () => {
    const list = (await tool("list_elections").execute({})) as { elections: { year: number; status: string }[] };
    expect(list.elections.map((e) => e.year)).toEqual([2017, 2020, 2023]);
    expect(list.elections[2].status).toBe("preliminary");
    const nat = (await tool("get_national_result").execute({ year: 2017 })) as { parties: { party: string; sharePct: number }[] };
    expect(nat.parties[0]).toMatchObject({ party: "labour", sharePct: 50 });
    expect(await tool("get_national_result").execute({ year: 1999 })).toHaveProperty("error");
  });

  it("changes the view, accepting party names, and rejects invalid input without changing anything", async () => {
    const show = tool("show_on_map");
    await show.execute({ year: 2017, mode: "party", party: "LABOUR", votes: "electorate" }); // a short name, matched case-insensitively
    expect(useAtlas.getState()).toMatchObject({ year: 2017, mode: "party", party: "labour", voteKind: "candidate" });
    expect(await show.execute({ mode: "pie" })).toHaveProperty("error");
    expect(await show.execute({ party: "Nonexistent" })).toHaveProperty("error");
    expect(useAtlas.getState()).toMatchObject({ year: 2017, mode: "party", party: "labour" });
  });
});
