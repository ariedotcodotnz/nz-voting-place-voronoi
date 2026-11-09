import { describe, expect, it } from "vitest";
import { activeBlocs, describeBlocs, membershipFor } from "@/lib/atlas/blocs";
import type { BlocScheme } from "@/lib/atlas/types";
import { manifest } from "./fixtures";

const scheme: BlocScheme = {
  id: "t",
  label: "t",
  description: "",
  blocs: ["left", "right"],
  membership: [
    { party: "labour", bloc: "left" },
    { party: "tpm", bloc: "left", from: 2020 },
    { party: "national", bloc: "right" },
  ],
  explicitlyUnassigned: [{ party: "tpm", to: 2017, reason: "Supported National-led governments" }],
};

describe("bloc membership by year", () => {
  it("applies year ranges", () => {
    expect(membershipFor(scheme, 2017).has("tpm")).toBe(false);
    expect(membershipFor(scheme, 2020).get("tpm")).toBe("left");
  });
  it("lets user overrides move or unassign a party", () => {
    const m = membershipFor(scheme, 2023, { tpm: null, nzfirst: "right" });
    expect(m.has("tpm")).toBe(false);
    expect(m.get("nzfirst")).toBe("right");
  });
  it("explains why a party is unassigned", () => {
    const d = describeBlocs(scheme, 2014, ["labour", "national", "tpm"], membershipFor(scheme, 2014), manifest.blocs);
    expect(d.unassigned).toEqual([{ party: "tpm", reason: "Supported National-led governments" }]);
    expect(d.blocs.map((b) => b.id)).toEqual(["left", "right"]);
  });
  it("only shows blocs that have members on the ballot", () => {
    const m = membershipFor(scheme, 2023);
    expect(activeBlocs(scheme, m, ["labour", "green"], manifest.blocs)).toEqual(["left"]);
  });
  it("TOP-inclusive scheme puts TOP in a bloc; TOP-exclusive leaves it unassigned", () => {
    const [core, coreTop] = manifest.blocs.schemes;
    expect(membershipFor(core, 2023).has("top")).toBe(false);
    expect(membershipFor(coreTop, 2023).get("top")).toBe("left");
    expect(membershipFor(coreTop, 2023, { top: "centre" }).get("top")).toBe("centre");
  });
});
