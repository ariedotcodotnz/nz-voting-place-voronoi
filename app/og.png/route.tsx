import { ImageResponse } from "next/og";
import { ELECTION_YEARS, SITE_NAME } from "@/lib/site";
import { OG_IMAGE } from "./image";

// Rendered once at build time into out/og.png (static export).
export const dynamic = "force-static";

/** Link-preview card, in the atlas's ink-on-paper style (colour is reserved for data). */
export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#FFFFFF", color: "#14202B", padding: "72px 80px" }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#4B5864" }}>{SITE_NAME}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em" }}>New Zealand general elections by polling place</div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 32, color: "#4B5864" }}>Party and electorate votes at every polling place, on a map</div>
        </div>
        <div style={{ display: "flex", gap: 30, fontSize: 28, fontWeight: 700, color: "#6F7B86", borderTop: "2px solid #DFE3E7", paddingTop: 24 }}>
          {ELECTION_YEARS.map((y) => (
            <span key={y}>{y}</span>
          ))}
        </div>
      </div>
    ),
    { width: OG_IMAGE.width, height: OG_IMAGE.height },
  );
}
