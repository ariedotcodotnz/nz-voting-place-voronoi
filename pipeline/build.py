"""End-to-end build: raw data -> public/data assets + processing report."""

from __future__ import annotations

import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

import numpy as np
import shapely

from . import catchments as C
from .common import CONFIG_DIR, OUT_DIR, REPORT_DIR, IssueLog, load_json, norm_name
from .export import AssetWriter, bbox_wgs, chunk_features, encode_features, to_wgs84
from .ingest import Election, ingest, load_election_config
from .candidates import candidates_payload
from .labels import build_labels
from .linking import link_sites
from .parties import PartyRegistry
from .report import write_report
from .results import NONGEO_LABELS, SECTION_ADVANCE
from .sites import Site

LOD_LO_TOLERANCE_M = 150.0
LOD_LO_MIN_PART_M2 = 200_000.0
LOD_HI_TOLERANCE_M = 8.0
HI_CHUNK_M = 75_000.0
ELECTORATE_TOLERANCE_M = 120.0
METHODS = ("meshblock", "voronoi")
DEFAULT_METHOD = "meshblock"


def _site_match_quality(s: Site) -> str:
    methods = set(s.match_methods)
    if any("inferred" in m for m in methods):
        return "inferred"
    if any(m.startswith("fuzzy") for m in methods):
        return "fuzzy"
    return "exact"


def _electorate_index(el: Election) -> dict[str, int]:
    return {norm_name(e.name): i for i, e in enumerate(el.electorates)}


def results_payload(el: Election, area: dict[str, np.ndarray]) -> dict[str, Any]:
    parties = el.parties
    eidx = _electorate_index(el)
    sites = el.sites
    adv_by_venue = bool(el.config.get("advance_by_venue"))

    def vec(c: Counter[str]) -> list[int]:
        return [int(c.get(p, 0)) for p in parties]

    home: list[int] = []
    for s in sites:
        i = eidx.get(norm_name(s.home_electorate or ""), -1)
        if i < 0 or el.electorates[i].kind != "general":
            gen = [(v, e) for e, v in s.electorates.most_common() if el.electorates[eidx[norm_name(e)]].kind == "general"]
            i = eidx[norm_name(gen[0][1])] if gen else eidx[norm_name(s.electorates.most_common(1)[0][0])]
        home.append(i)

    electorates = []
    for i, er in enumerate(el.electorates):
        mapped = sum(r.total_valid for r in er.rows if r.kind == "venue")
        nongeo: Counter[str] = Counter()
        for r in er.rows:
            if r.kind == "nongeo":
                nongeo[r.category or "unmatched"] += r.total_valid
        electorates.append(
            {
                "no": er.number,
                "name": er.name,
                "kind": er.kind,
                "totals": vec(Counter(er.totals)),
                "totalValid": er.total_valid,
                "informal": er.informal,
                "mapped": mapped,
                "nongeo": dict(nongeo),
            }
        )
    national = Counter()
    for er in el.electorates:
        national.update(er.totals)
    nongeo_party: dict[str, list[int]] = {}
    for er in el.electorates:
        for r in er.rows:
            if r.kind == "nongeo":
                cat = r.category or "unmatched"
                cur = nongeo_party.setdefault(cat, [0] * len(parties))
                for k, p in enumerate(parties):
                    cur[k] += r.votes.get(p, 0)
    return {
        "year": el.year,
        "date": el.config.get("date"),
        "status": "preliminary" if el.preliminary else "final",
        "advanceByVenue": adv_by_venue,
        "parties": parties,
        "sites": {
            "id": [s.stable_id for s in sites],
            "name": [s.name for s in sites],
            "address": [s.address for s in sites],
            "suburb": [s.suburb for s in sites],
            "lat": [round(s.lat, 6) for s in sites],
            "lng": [round(s.lng, 6) for s in sites],
            "home": home,
            "types": ["".join(t for t, k in (("A", SECTION_ADVANCE), ("E", "election_day")) if k in s.types) for s in sites],
            "located": [_site_match_quality(s) for s in sites],
            "locationYear": [s.location_source_year or el.year for s in sites],
            "zeroRows": [s.suppressed_rows for s in sites],
            "electorates": [[[eidx[norm_name(e)], int(v)] for e, v in s.electorates.most_common()] for s in sites],
            "areaKm2": {m: [round(float(a) / 1e6, 4) for a in area[m]] for m in area},
        },
        "votes": {
            "e": [vec(s.votes_ed) for s in sites],
            "a": [vec(s.votes_adv) for s in sites] if adv_by_venue else None,
            "te": [s.total_ed for s in sites],
            "ta": [s.total_adv for s in sites] if adv_by_venue else None,
            "ie": [s.informal_ed for s in sites],
            "ia": [s.informal_adv for s in sites] if adv_by_venue else None,
        },
        "partyStats": party_stats(el),
        "electorates": electorates,
        "national": {"totals": vec(national), "totalValid": sum(e.total_valid for e in el.electorates), "informal": sum(e.informal for e in el.electorates)},
        "nongeo": nongeo_party,
        "nongeoLabels": NONGEO_LABELS,
        "stats": el.stats,
        "candidates": candidates_payload(el.year, sites, el.electorates, adv_by_venue, eidx),
    }


PARTY_STATS_MIN_VOTES = 20


def party_stats(el: Election) -> dict[str, dict[str, float]]:
    """Distribution summaries used for colour-scale domains: the 98th
    percentile and maximum vote share (all votes, sites with at least
    PARTY_STATS_MIN_VOTES valid votes) and votes per site."""
    out: dict[str, dict[str, float]] = {}
    totals = np.array([s.total for s in el.sites], dtype=float)
    ok = totals >= PARTY_STATS_MIN_VOTES
    for p in el.parties:
        v = np.array([s.votes_ed.get(p, 0) + s.votes_adv.get(p, 0) for s in el.sites], dtype=float)
        sh = v[ok] / totals[ok] if ok.any() else np.array([0.0])
        out[p] = {
            "p98Share": round(float(np.percentile(sh, 98)), 4),
            "maxShare": round(float(sh.max()), 4),
            "p98Votes": int(np.percentile(v, 98)),
            "maxVotes": int(v.max()) if len(v) else 0,
        }
    return out


def maori_bbox(el: Election, er_index: int) -> list[float] | None:
    name = el.electorates[er_index].name
    pts = [(s.lng, s.lat) for s in el.sites if s.electorates.get(name, 0) >= 25]
    if len(pts) < 3:
        pts = [(s.lng, s.lat) for s in el.sites if s.electorates.get(name, 0) > 0]
    if not pts:
        return None
    a = np.array(pts)
    lo, hi = np.percentile(a, 2, axis=0), np.percentile(a, 98, axis=0)
    return [round(float(lo[0]), 4), round(float(lo[1]), 4), round(float(hi[0]), 4), round(float(hi[1]), 4)]


def validate_blocs(blocs: dict, registry: PartyRegistry, log: IssueLog) -> None:
    for scheme in blocs["schemes"]:
        for m in scheme["membership"]:
            if m["party"] not in registry.parties:
                log.add(None, "bloc_config", "error", f"Bloc scheme {scheme['id']!r} references unknown party {m['party']!r}")
            if m["bloc"] not in blocs["blocs"]:
                log.add(None, "bloc_config", "error", f"Bloc scheme {scheme['id']!r} references unknown bloc {m['bloc']!r}")


def run(skip_geometry: bool = False) -> dict[str, Any]:
    t0 = time.time()
    print("Reading election configuration…", flush=True)
    configs, maori, log = load_election_config()
    registry = PartyRegistry()
    print(f"Ingesting {len(configs)} elections: {[c['year'] for c in configs]}", flush=True)
    elections = ingest(registry, log, configs, maori)
    years = sorted(elections)
    for a, b in zip(years, years[1:]):
        if b - a > 3:
            log.add(None, "missing_election", "info", f"No data between {a} and {b} (gap of {b - a} years); the timeline shows only elections present")
    print("Linking sites across elections…", flush=True)
    stable = link_sites({y: e.sites for y, e in elections.items()}, log)
    blocs = load_json(CONFIG_DIR / "blocs.json")
    validate_blocs(blocs, registry, log)

    writer = AssetWriter(OUT_DIR)
    writer.reset()
    manifest_elections = []
    payloads: dict[int, dict[str, Any]] = {}
    geometry_quality: dict[str, Any] = {}

    geo = None
    if not skip_geometry:
        print("Preparing land mask and meshblocks…", flush=True)
        all_xy = np.array([[s.x, s.y] for e in elections.values() for s in e.sites])
        geo = C.load_geography(all_xy, log)

    for y in years:
        el = elections[y]
        print(f"[{y}] {len(el.sites)} sites", flush=True)
        xy = np.array([[s.x, s.y] for s in el.sites])
        files: dict[str, Any] = {}
        area: dict[str, np.ndarray] = {}
        bboxes: dict[int, list[float]] = {}
        if geo is not None:
            raw: dict[str, np.ndarray] = {
                "voronoi": C.voronoi_catchments(xy, geo),
                "meshblock": C.meshblock_catchments(xy, geo, y, log)[0],
            }
            for method in METHODS:
                geoms = raw[method]
                if not shapely.coverage_is_valid(geoms, gap_width=0.0):
                    # Meshblocks split by a local Voronoi leave shared edges with
                    # slightly different vertices; snap them so the catchments
                    # form an exact coverage before dissolving/simplifying.
                    before = shapely.area(geoms)
                    geoms = np.asarray(shapely.coverage_clean(geoms))
                    raw[method] = geoms
                    log.add(y, "coverage_clean", "info", f"{method}: catchment edges re-noded into an exact coverage (largest area change {float(np.abs(shapely.area(geoms) - before).max()):.1f} m²)")
                if method == "meshblock":
                    geoms, n_moved, a_moved = C.remove_exclaves(geoms, xy)
                    raw[method] = geoms
                    log.add(y, "exclaves", "info", f"meshblock: {n_moved} disconnected catchment fragments ({a_moved / 1e6:.1f} km²) merged into the neighbouring catchment with the longest shared border")
                ref =geo.mb_area if method == "meshblock" else geo.land_area
                chk = C.coverage_checks(geoms, ref)
                empty = np.flatnonzero(shapely.is_empty(geoms))
                for i in empty:
                    log.add(y, "empty_catchment", "warning", f"{method}: site {el.sites[i].name!r} has no land catchment (its coordinate may be offshore)")
                area[method] = shapely.area(geoms)
                lo = C.simplify_coverage(geoms, LOD_LO_TOLERANCE_M, LOD_LO_MIN_PART_M2)
                hi = C.simplify_coverage(geoms, LOD_HI_TOLERANCE_M)
                chk["invalid_after_simplify_lo"] = int((~shapely.is_valid(lo)).sum())
                chk["invalid_after_simplify_hi"] = int((~shapely.is_valid(hi)).sum())
                chk["simplified_overlap_km2_hi"] = round((float(shapely.area(hi).sum()) - float(shapely.area(shapely.coverage_union_all(hi)).sum())) / 1e6, 4)
                geometry_quality[f"{y}-{method}"] = chk
                for k in ("invalid_polygons", "invalid_after_simplify_lo", "invalid_after_simplify_hi"):
                    if chk[k]:
                        log.add(y, "invalid_polygons", "error", f"{method}: {chk[k]} invalid polygons ({k})")
                if abs(chk["overlap_km2"]) > 0.01 or abs(chk["gap_km2"]) > 0.01:
                    log.add(y, "geometry_overlap_gap", "warning", f"{method}: overlap {chk['overlap_km2']} km², gap {chk['gap_km2']} km²")
                lo_wgs = to_wgs84(lo)
                ids = list(range(len(lo)))
                lo_rel = writer.write(f"catchments/{y}/{method}-lo", {"v": 1, "scale": 100000, "year": y, "method": method, "lod": "lo", "features": encode_features(ids, lo_wgs)})
                hi_wgs = to_wgs84(hi)
                chunks = []
                for key, idx in sorted(chunk_features(geoms, HI_CHUNK_M).items()):
                    rel = writer.write(f"catchments/{y}/{method}-hi-{key}", {"v": 1, "scale": 100000, "year": y, "method": method, "lod": "hi", "features": encode_features(idx, hi_wgs[idx])})
                    chunks.append({"file": rel, "bbox": bbox_wgs(hi_wgs[idx]), "n": len(idx)})
                files[method] = {"lo": lo_rel, "hi": chunks}
            # Approximate electorate extents from meshblock catchments.
            payload_preview = results_payload(el, area)
            home = np.array(payload_preview["sites"]["home"])
            outl_ids, outl_geoms = [], []
            for ei, er in enumerate(el.electorates):
                if er.kind != "general":
                    continue
                members = np.flatnonzero(home == ei)
                if len(members) == 0:
                    continue
                outl_ids.append(ei)
                outl_geoms.append(shapely.coverage_union_all(raw["meshblock"][members]))
            outl = C.simplify_coverage(np.array(outl_geoms, dtype=object), ELECTORATE_TOLERANCE_M, LOD_LO_MIN_PART_M2)
            outl_wgs = to_wgs84(outl)
            bboxes = {ei: bbox_wgs(np.array([g])) for ei, g in zip(outl_ids, outl_wgs)}
            files["electorates"] = writer.write(f"electorates/{y}", {"v": 1, "scale": 100000, "year": y, "approximate": True, "features": encode_features(outl_ids, outl_wgs)})
        payload = results_payload(el, area)
        for ei, e in enumerate(payload["electorates"]):
            if e["kind"] == "general" and ei in bboxes:
                e["bbox"] = bboxes[ei]
            else:
                e["bbox"] = maori_bbox(el, ei)
        files["results"] = writer.write(f"results/{y}", payload)
        payloads[y] = payload
        manifest_elections.append(
            {
                "year": y,
                "date": el.config.get("date"),
                "status": payload["status"],
                "advanceByVenue": payload["advanceByVenue"],
                # "byParty": candidate votes attributable to parties; "namesOnly": affiliations missing
                "candidates": None if not payload["candidates"] else ("byParty" if payload["candidates"]["available"] else "namesOnly"),
                "sites": len(el.sites),
                "parties": payload["parties"],
                "national": {pid: v for pid, v in zip(payload["parties"], payload["national"]["totals"])},
                "nationalValid": payload["national"]["totalValid"],
                "files": files,
                "stats": el.stats,
                "source": el.places_meta,
            }
        )

    # Stable site index and search index
    sites_rel = writer.write("sites", {"sites": stable})
    labels_rel = writer.write("labels", {"labels": build_labels(payloads)})
    regions = load_json(CONFIG_DIR / "regions.json")
    suburbs: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for y in years:
        for s in elections[y].sites:
            if s.suburb:
                suburbs[s.suburb].append((s.lng, s.lat))
    suburb_list = []
    for name, pts in sorted(suburbs.items()):
        a = np.array(pts)
        suburb_list.append([name, round(float(np.median(a[:, 1])), 5), round(float(np.median(a[:, 0])), 5), len(pts)])
    electorate_names: dict[str, dict] = {}
    for m in manifest_elections:
        for e in load_json(OUT_DIR / m["files"]["results"])["electorates"]:
            entry = electorate_names.setdefault(e["name"], {"name": e["name"], "kind": e["kind"], "years": []})
            entry["years"].append(m["year"])
    search_rel = writer.write(
        "search",
        {
            "places": [[s["id"], s["name"], s["suburb"], s["lat"], s["lng"], sorted(int(y) for y in s["years"])] for s in stable.values()],
            "suburbs": suburb_list,
            "electorates": sorted(electorate_names.values(), key=lambda e: e["name"]),
            "regions": regions["regions"],
        },
    )
    party_vote_ids = {pid for e in elections.values() for pid in e.parties}
    parties_out = {
        pid: {
            "name": p.name,
            "short": p.short,
            "color": p.color,
            "notes": p.notes,
            "classified": p.classified,
            "candidateOnly": pid not in party_vote_ids,
            "ballotNames": {str(k): v for k, v in sorted(p.raw_names.items())},
        }
        for pid, p in registry.parties.items()
        if p.raw_names
    }
    report = write_report(elections, log, geometry_quality, stable, registry, geo.excluded_islands if geo else [], REPORT_DIR)
    report_rel = writer.write("report", report)
    party_scale: dict[str, dict[str, float]] = {}
    for y in years:
        for pid, st in party_stats(elections[y]).items():
            cur = party_scale.setdefault(pid, {"share": 0.0, "votes": 0})
            cur["share"] = max(cur["share"], st["p98Share"])
            cur["votes"] = max(cur["votes"], st["p98Votes"])
    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "partyScale": party_scale,
        "elections": manifest_elections,
        "parties": parties_out,
        "blocs": blocs,
        "boundary": {
            "default": DEFAULT_METHOD,
            "methods": {
                "meshblock": "Stats NZ 2026 meshblocks assigned to the nearest polling place, then dissolved. Follows roads, rivers and property lines; lakes and inlets stay water.",
                "voronoi": "Raw Voronoi (nearest-polling-place) cells clipped to the LINZ 1:50k coastline with lakes removed.",
            },
            "lod": {"loToleranceM": LOD_LO_TOLERANCE_M, "hiToleranceM": LOD_HI_TOLERANCE_M},
        },
        "files": {"sites": sites_rel, "search": search_rel, "report": report_rel, "labels": labels_rel},
    }
    writer.write("manifest", manifest, hashed=False)
    total = sum(writer.bytes_written.values())
    print(f"Wrote {len(writer.bytes_written)} files, {total / 1e6:.1f} MB to {OUT_DIR} in {time.time() - t0:.0f}s", flush=True)
    errors = [i for i in log.issues if i.severity == "error"]
    return {"errors": len(errors), "warnings": sum(1 for i in log.issues if i.severity == "warning"), "files": len(writer.bytes_written), "bytes": total}
