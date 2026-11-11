"use client";

import { failedKeys, keys, peek } from "@/lib/atlas/data";
import { partyLabel } from "@/lib/atlas/encoding";
import { useAtlas, type AtlasState } from "@/lib/atlas/store";
import type { YearData } from "@/lib/atlas/stats";
import type { Manifest } from "@/lib/atlas/types";
import { trackEvent } from "@/lib/analytics";
import { REPORT_FORM_URL, reportDetails, reportUrl } from "@/lib/report";

/** What the map is showing, in a few words for whoever reads the report. */
function describeView(manifest: Manifest, s: AtlasState): string {
  const subject =
    s.mode === "swing"
      ? s.swingTarget.kind === "party"
        ? partyLabel(manifest, s.swingTarget.id)
        : (manifest.blocs.blocs[s.swingTarget.id]?.label ?? s.swingTarget.id)
      : s.mode === "party" || s.mode === "split"
        ? partyLabel(manifest, s.party)
        : s.mode === "compare"
          ? `${partyLabel(manifest, s.cmpA)} v ${partyLabel(manifest, s.partyB)}`
          : null;
  return [s.shownYear ?? s.year, s.mode, subject, `${s.voteKind === "candidate" ? "electorate" : "party"} vote`, s.basemap].filter((x) => x !== null && x !== "").join(", ");
}

function currentReportUrl(manifest: Manifest): string {
  const s = useAtlas.getState();
  const yd = s.shownYear !== null ? peek<YearData>(keys.year(s.shownYear)) : undefined;
  const i = yd && s.selected ? yd.stableIndex.get(s.selected) : undefined;
  return reportUrl(
    reportDetails({
      link: window.location.href,
      view: describeView(manifest, s),
      place: s.selected ? `${i !== undefined && yd ? yd.file.sites.name[i] : "unknown"} (${s.selected})` : null,
      userAgent: navigator.userAgent,
      screen: `${window.innerWidth}×${window.innerHeight} @${Math.round(window.devicePixelRatio * 100) / 100}x`,
      dataBuilt: manifest.generatedAt.slice(0, 10),
      failed: failedKeys(),
      cookie: document.cookie,
    }),
  );
}

/** Opens the problem-report form in a new tab, prefilled with the current view.
 *  The address is worked out at the moment of the click, so it is never stale. */
export function ReportLink({ manifest, className, children, label }: { manifest: Manifest; className?: string; children: React.ReactNode; label?: string }) {
  const fill = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
    try {
      e.currentTarget.href = currentReportUrl(manifest);
    } catch {
      e.currentTarget.href = REPORT_FORM_URL; // an empty form still beats no form
    }
  };
  return (
    <a
      href={REPORT_FORM_URL}
      target="_blank"
      rel="noreferrer"
      className={className}
      aria-label={label}
      title={label}
      data-testid="report-link"
      // Also on auxclick/contextmenu so middle-click and "open in new tab" get the details.
      onClick={(e) => {
        fill(e);
        trackEvent("report_problem");
      }}
      onAuxClick={fill}
      onContextMenu={fill}
    >
      {children}
    </a>
  );
}
