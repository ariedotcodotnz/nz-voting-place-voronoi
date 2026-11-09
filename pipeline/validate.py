"""Integrity checks on generated assets (public/data).

These guard the *pipeline's* output: any failure means the app could show
something wrong, so `python -m pipeline build` exits non-zero. Problems in the
*source* data are reported in reports/processing-report.md instead.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from .common import NZ_LAT_RANGE, OUT_DIR, load_json, lng_in_nz


def _decode_ring_len(ring: list[int]) -> int:
    return len(ring) // 2


def validate_outputs(out_dir: Path = OUT_DIR, require_geometry: bool = True) -> list[str]:
    problems: list[str] = []
    mpath = out_dir / "manifest.json"
    if not mpath.exists():
        return ["manifest.json missing"]
    manifest = load_json(mpath)
    parties = manifest["parties"]
    years = [e["year"] for e in manifest["elections"]]
    if years != sorted(set(years)):
        problems.append(f"Election years not unique/sorted: {years}")
    if not years:
        problems.append("No elections in manifest")

    for scheme in manifest["blocs"]["schemes"]:
        for m in scheme["membership"]:
            if m["bloc"] not in manifest["blocs"]["blocs"]:
                problems.append(f"Bloc scheme {scheme['id']}: unknown bloc {m['bloc']}")

    for e in manifest["elections"]:
        y = e["year"]
        r: dict[str, Any] = load_json(out_dir / e["files"]["results"])
        P = len(r["parties"])
        for pid in r["parties"]:
            if pid not in parties:
                problems.append(f"{y}: party {pid} missing from manifest.parties")
        if len(set(r["parties"])) != P:
            problems.append(f"{y}: duplicate party ids")
        sites = r["sites"]
        n = len(sites["name"])
        for key in ("id", "address", "suburb", "lat", "lng", "home", "types", "located", "electorates"):
            if len(sites[key]) != n:
                problems.append(f"{y}: sites.{key} has {len(sites[key])} entries, expected {n}")
        ids = [i for i in sites["id"] if i is not None]
        if len(ids) != n:
            problems.append(f"{y}: {n - len(ids)} sites without a stable id")
        if len(set(ids)) != len(ids):
            problems.append(f"{y}: stable ids repeated within one election")
        for i, (lat, lng) in enumerate(zip(sites["lat"], sites["lng"])):
            if not (NZ_LAT_RANGE[0] <= lat <= NZ_LAT_RANGE[1] and lng_in_nz(lng)):
                problems.append(f"{y}: site {i} has invalid coordinate {lat},{lng}")
        v = r["votes"]
        for kind, tot in (("e", "te"), ("a", "ta")):
            arr = v.get(kind)
            if arr is None:
                continue
            if len(arr) != n or len(v[tot]) != n:
                problems.append(f"{y}: votes.{kind} length mismatch")
                continue
            for i, row in enumerate(arr):
                if len(row) != P:
                    problems.append(f"{y}: votes.{kind}[{i}] has {len(row)} parties, expected {P}")
                    break
                if any((not isinstance(x, int)) or x < 0 for x in row):
                    problems.append(f"{y}: votes.{kind}[{i}] contains a negative or non-integer value")
                    break
                if sum(row) != v[tot][i]:
                    problems.append(f"{y}: votes.{kind}[{i}] sums to {sum(row)} but total is {v[tot][i]}")
                    break
        if not e["advanceByVenue"] and v.get("a") is not None:
            problems.append(f"{y}: advance votes present although advanceByVenue is false")
        # Shares must be well-formed
        for i in range(n):
            tot = v["te"][i] + (v["ta"][i] if v.get("ta") else 0)
            if tot:
                share = max((v["e"][i][k] + (v["a"][i][k] if v.get("a") else 0)) / tot for k in range(P))
                if not (0 <= share <= 1):
                    problems.append(f"{y}: impossible share {share} at site {i}")
        # Electorate accounting: mapped + non-geographic == official total
        nat = [0] * P
        for el in r["electorates"]:
            if el["mapped"] + sum(el["nongeo"].values()) != el["totalValid"]:
                problems.append(f"{y}: {el['name']} mapped {el['mapped']} + non-geographic {sum(el['nongeo'].values())} != total {el['totalValid']}")
            if sum(el["totals"]) != el["totalValid"]:
                problems.append(f"{y}: {el['name']} party totals sum {sum(el['totals'])} != total valid {el['totalValid']}")
            for k in range(P):
                nat[k] += el["totals"][k]
        if nat != r["national"]["totals"]:
            problems.append(f"{y}: national totals do not equal the sum of electorate totals")
        mapped_sites = sum(v["te"]) + (sum(v["ta"]) if v.get("ta") else 0)
        mapped_el = sum(el["mapped"] for el in r["electorates"])
        if mapped_sites != mapped_el:
            problems.append(f"{y}: site totals {mapped_sites} != electorate mapped totals {mapped_el}")
        for i, pairs in enumerate(sites["electorates"]):
            for ei, _ in pairs:
                if not 0 <= ei < len(r["electorates"]):
                    problems.append(f"{y}: site {i} refers to unknown electorate {ei}")

        if not require_geometry:
            continue
        for method in ("meshblock", "voronoi"):
            if method not in e["files"]:
                problems.append(f"{y}: no {method} catchments")
                continue
            lo = load_json(out_dir / e["files"][method]["lo"])
            seen = [f[0] for f in lo["features"]]
            if len(seen) != len(set(seen)):
                problems.append(f"{y} {method} lo: duplicate site features")
            missing_lo = n - len(set(seen))
            if missing_lo > max(5, 0.01 * n):
                problems.append(f"{y} {method} lo: {missing_lo} sites without a polygon")
            hi_ids: list[int] = []
            for ch in e["files"][method]["hi"]:
                d = load_json(out_dir / ch["file"])
                for f in d["features"]:
                    hi_ids.append(f[0])
                    for poly in f[1]:
                        for ring in poly:
                            if _decode_ring_len(ring) < 4 or len(ring) % 2:
                                problems.append(f"{y} {method}: degenerate ring for site {f[0]}")
                w, s, ea, nn = ch["bbox"]
                if any(math.isnan(x) for x in ch["bbox"]) or s > nn:
                    problems.append(f"{y} {method}: bad chunk bbox {ch['bbox']}")
            if len(hi_ids) != len(set(hi_ids)):
                problems.append(f"{y} {method} hi: a site appears in more than one chunk")
            if any(not 0 <= i < n for i in hi_ids):
                problems.append(f"{y} {method} hi: feature refers to a site index out of range")
            missing = n - len(set(hi_ids))
            if missing > max(5, 0.01 * n):
                problems.append(f"{y} {method} hi: {missing} sites without a polygon")
    if "labels" in manifest["files"]:
        labels = load_json(out_dir / manifest["files"]["labels"])["labels"]
        for row in labels:
            name, lat, lng, kind, weight = row
            if not name or kind not in ("region", "city", "locality") or not (NZ_LAT_RANGE[0] <= lat <= NZ_LAT_RANGE[1] and lng_in_nz(lng)):
                problems.append(f"labels: bad row {row}")
                break
    sites_doc = load_json(out_dir / manifest["files"]["sites"])
    for sid, s in sites_doc["sites"].items():
        if len(s["years"]) != len(set(s["years"])):
            problems.append(f"stable site {sid}: repeated year")
    return problems
