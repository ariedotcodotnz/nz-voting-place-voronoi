import { describe, expect, it, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Timeline } from "@/components/atlas/panels/Timeline";
import { PartyBars } from "@/components/atlas/charts/PartyBars";
import { searchIndex } from "@/components/atlas/panels/SearchBox";
import { useAtlas } from "@/lib/atlas/store";
import { manifest } from "./fixtures";

describe("Timeline", () => {
  beforeEach(() => useAtlas.getState().set({ year: 2020, playing: false, mode: "winner", loop: false }));

  const renderTimeline = () =>
    render(
      <TooltipProvider>
        <Timeline manifest={manifest} />
      </TooltipProvider>,
    );

  it("builds stops from the elections actually present", () => {
    renderTimeline();
    const strip = screen.getByRole("slider", { name: "Election year" });
    expect(strip).toHaveAttribute("aria-valuemin", "2017");
    expect(strip).toHaveAttribute("aria-valuemax", "2023");
    expect(strip.querySelectorAll("[data-year]")).toHaveLength(3);
    expect(screen.getByTestId("current-year")).toHaveTextContent("2020");
    expect(screen.getByText("prelim.")).toBeInTheDocument();
  });

  it("moves between elections with the keyboard and buttons", () => {
    renderTimeline();
    const strip = screen.getByRole("slider", { name: "Election year" });
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(useAtlas.getState().year).toBe(2023);
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(useAtlas.getState().year).toBe(2023); // stops at the last election
    fireEvent.keyDown(strip, { key: "Home" });
    expect(useAtlas.getState().year).toBe(2017);
    fireEvent.click(screen.getByRole("button", { name: "Next election" }));
    expect(useAtlas.getState().year).toBe(2020);
  });

  it("plays and pauses", () => {
    renderTimeline();
    const play = screen.getByTestId("play");
    fireEvent.click(play);
    expect(useAtlas.getState().playing).toBe(true);
    fireEvent.click(play);
    expect(useAtlas.getState().playing).toBe(false);
  });

  it("restarts from the first election when played at the end", () => {
    act(() => useAtlas.getState().set({ year: 2023 }));
    renderTimeline();
    fireEvent.click(screen.getByTestId("play"));
    expect(useAtlas.getState().year).toBe(2017);
    expect(useAtlas.getState().playing).toBe(true);
    act(() => useAtlas.getState().set({ playing: false }));
  });
});

describe("PartyBars", () => {
  it("ranks every party by share with votes", () => {
    render(<PartyBars manifest={manifest} parties={["labour", "national", "green"]} votes={[100, 300, 50]} total={450} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("NATIONAL");
    expect(rows[0]).toHaveTextContent("66.7%");
    expect(rows[0]).toHaveTextContent("300");
    expect(rows[2]).toHaveTextContent("GREEN");
  });
});

describe("search", () => {
  it("finds places, suburbs, electorates and regions ignoring macrons", () => {
    const r = searchIndex(
      {
        places: [["a", "Ōtāhuhu Primary School", "Ōtāhuhu", -36.9, 174.8, [2020, 2023]]],
        suburbs: [["Ōtāhuhu", -36.9, 174.8, 12]],
        electorates: [{ name: "Ōtāhuhu", kind: "general", years: [2026] }],
        regions: [{ name: "Auckland", kind: "region", bbox: [174, -37, 175, -36] }],
      },
      "otahuhu",
      2023,
    );
    expect(r.places).toHaveLength(1);
    expect(r.suburbs).toHaveLength(1);
    expect(r.electorates).toHaveLength(1);
    expect(r.regions).toHaveLength(0);
  });
});

describe("URL sync", () => {
  it("keeps handling back/forward under Strict Mode and moves the map", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { StrictMode } = await import("react");
    const { useUrlSync } = await import("@/components/atlas/useUrlSync");
    window.history.replaceState(null, "", "/?y=2017");
    renderHook(() => useUrlSync(false), { wrapper: StrictMode });
    expect(useAtlas.getState().year).toBe(2017);
    window.history.replaceState(null, "", "/?y=2014&v=-41.28650,174.77620,12.50");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(useAtlas.getState().year).toBe(2014);
    expect(useAtlas.getState().flyTo).toMatchObject({ lat: -41.2865, lng: 174.7762, zoom: 12.5 });
  });
});
