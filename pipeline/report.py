"""Processing report: a Markdown document for maintainers plus a JSON summary
the web app shows in its 'Data & method' panel."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .common import IssueLog
from .parties import PartyRegistry
from .results import NONGEO_LABELS


def _pct(a: float, b: float) -> str:
    return f"{100 * a / b:.1f}%" if b else "–"


def write_report(elections: dict, log: IssueLog, geometry: dict, stable: dict, registry: PartyRegistry, excluded_islands: list, out_dir: Path) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    years = sorted(elections)
    summary: dict[str, Any] = {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "elections": [], "geometry": geometry, "excludedIslands": excluded_islands}
    md: list[str] = [
        "# Processing report",
        "",
        f"Generated {summary['generatedAt']} by `npm run data` (`python -m pipeline build`).",
        "",
        "Every row in every source file is accounted for: venue rows are mapped to a physical site; everything else",
        "(special, overseas, aggregated advance, mobile-team and unlocatable rows) is kept in electorate and national",
        "totals but not drawn on the map. Nothing is silently deleted.",
        "",
        "## Summary by election",
        "",
        "| Election | Status | Electorates | Result rows | Venue rows | Sites | Valid votes | Mapped to sites | Unlocated venue votes |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for y in years:
        el = elections[y]
        st = el.stats
        unl = st["valid_votes_by_nongeo_category"].get("unmatched", 0)
        md.append(
            f"| {y} | {'preliminary' if el.preliminary else 'final'} | {st['electorates']} | {st['result_rows']:,} | {st['venue_rows']:,} | {st['sites']:,} | {st['valid_votes_total']:,} | {st['valid_votes_mapped']:,} ({_pct(st['valid_votes_mapped'], st['valid_votes_total'])}) | {unl:,} |"
        )
        unmatched = sorted((i for i in log.issues if i.year == y and i.category == "unmatched_location"), key=lambda i: -i.detail.get("votes", 0))
        counts = log.counts(y)
        summary["elections"].append(
            {
                "year": y,
                "status": "preliminary" if el.preliminary else "final",
                "stats": st,
                "issueCounts": counts,
                "unmatched": [{"message": i.message, "votes": i.detail.get("votes", 0)} for i in unmatched[:40]],
                "notes": [i.message for i in log.issues if i.year == y and i.category in ("coordinates", "config", "missing_election", "inferred_location", "meshblock_split")],
            }
        )
    md += ["", "### Votes not drawn on the map, by category", ""]
    cats = sorted({c for y in years for c in elections[y].stats["valid_votes_by_nongeo_category"]})
    md.append("| Election | " + " | ".join(NONGEO_LABELS.get(c, c) for c in cats) + " |")
    md.append("|---|" + "---|" * len(cats))
    for y in years:
        d = elections[y].stats["valid_votes_by_nongeo_category"]
        md.append(f"| {y} | " + " | ".join(f"{d.get(c, 0):,}" for c in cats) + " |")

    md += ["", "### How result rows were located", ""]
    for y in years:
        mm = elections[y].stats["match_methods"]
        md.append(f"- **{y}**: " + ", ".join(f"{k} {v:,}" for k, v in sorted(mm.items(), key=lambda kv: -kv[1])))

    md += ["", "## Historical matching", ""]
    md.append(f"{len(stable):,} stable physical locations were identified across {len(years)} elections.")
    md.append("")
    md.append("| Pair | exact | high | probable | address-inferred | chained |")
    md.append("|---|---|---|---|---|---|")
    link_summary = []
    for a, b in zip(years, years[1:]):
        c: Counter[str] = Counter()
        for s in stable.values():
            v = s["confidence"].get(f"{a}-{b}")
            if v:
                c[v] += 1
        link_summary.append({"pair": f"{a}-{b}", **c})
        md.append(f"| {a}→{b} | {c['exact']} | {c['high']} | {c['probable']} | {c['address-inferred']} | {c['chained']} |")
    summary["linking"] = {"stableLocations": len(stable), "pairs": link_summary}

    md += ["", "## Catchment geometry", "", "| Election / method | Polygons invalid | Overlap km² | Gap km² | Land km² | Invalid after simplification (lo/hi) |", "|---|---|---|---|---|---|"]
    for k, g in geometry.items():
        md.append(f"| {k} | {g['invalid_polygons']} | {g['overlap_km2']} | {g['gap_km2']} | {g['union_area_km2']:,} | {g.get('invalid_after_simplify_lo', '–')}/{g.get('invalid_after_simplify_hi', '–')} |")
    if excluded_islands:
        md += ["", "Remote land excluded from catchments (no polling place within 150 km in any election):", ""]
        for e in excluded_islands:
            md.append(f"- {e['name']}: {e['polygons']} polygon(s), {e['area_km2']} km²")

    unclassified = [p for p in registry.parties.values() if not p.classified and p.raw_names and not p.candidate_only]
    summary["unclassifiedParties"] = [{"id": p.id, "name": p.name} for p in unclassified]
    md += ["", "## Parties", ""]
    md.append(f"{sum(1 for p in registry.parties.values() if p.raw_names)} party identifiers in use; {len(unclassified)} unclassified.")
    for p in unclassified:
        md.append(f"- **Unclassified**: {p.name} → `{p.id}`")

    md += ["", "## Issues by category", "", "| Election | Severity | Category | Count |", "|---|---|---|---|"]
    counts: Counter[tuple] = Counter((str(i.year or "all"), i.severity, i.category) for i in log.issues)
    for (y, sev, cat), n in sorted(counts.items()):
        md.append(f"| {y} | {sev} | {cat} | {n} |")
    summary["issueCounts"] = {f"{y}|{sev}|{cat}": n for (y, sev, cat), n in counts.items()}

    md += ["", "## Unlocated venue rows (largest first)", ""]
    for y in years:
        rows = sorted((i for i in log.issues if i.year == y and i.category == "unmatched_location"), key=lambda i: -i.detail.get("votes", 0))
        if not rows:
            continue
        md.append(f"### {y} ({len(rows)} rows)")
        md.append("")
        for i in rows[:30]:
            md.append(f"- {i.message}")
        if len(rows) > 30:
            md.append(f"- … and {len(rows) - 30} more (see reports/issues.json)")
        md.append("")

    (out_dir / "processing-report.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    (out_dir / "issues.json").write_text(json.dumps(log.to_json(), ensure_ascii=False, indent=1), encoding="utf-8")
    return summary
