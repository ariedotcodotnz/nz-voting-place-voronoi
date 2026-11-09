"""Place-name labels drawn by the web app above the election overlay.

Localities come from the Electoral Commission's "voting place suburb" field
across all elections; regions and cities from config/regions.json. Spelling
variants of one place (with/without macrons, "Mount"/"Mt") are merged, while
same-named places in different towns stay separate (clustered by distance).
The macronised spelling is preferred, then the most recent one.

Output rows: [name, lat, lng, kind, weight] where kind is region | city |
locality and weight orders labels when they collide (higher wins).
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from .common import CONFIG_DIR, fold, load_json

SAME_PLACE_KM = 6.0
EXCLUDE = re.compile(r"(?i)^taken in\b|\bteam\b|various|electorate\b|^\s*$")


# Historical spellings that are the same place as a current official name.
ALIASES = {"wanganui": "whanganui"}


def _key(name: str) -> str:
    k = re.sub(r"[^a-z0-9 ]+", " ", fold(name))
    k = " ".join(ALIASES.get(t, t) for t in k.split())
    k = re.sub(r"\bmount\b", "mt", k)
    k = re.sub(r"\bsaint\b", "st", k)
    return "".join(k.split())  # spacing variants ("Harbour View" / "Harbourview") are one place


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    dlat = math.radians(b[0] - a[0])
    dlng = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371.0 * math.hypot(dlat, dlng)


def build_labels(results_by_year: dict[int, dict[str, Any]]) -> list[list[Any]]:
    """results_by_year: year -> results payload (as written to public/data)."""
    points: dict[str, list[tuple[float, float, str, int]]] = defaultdict(list)
    for year, r in results_by_year.items():
        s = r["sites"]
        for name, lat, lng in zip(s["suburb"], s["lat"], s["lng"]):
            if not name or EXCLUDE.search(name):
                continue
            points[_key(name)].append((lat, lng, name.strip(), year))

    out: list[list[Any]] = []
    for pts in points.values():
        # Greedy clustering: same name within SAME_PLACE_KM of a cluster's centre.
        clusters: list[list[tuple[float, float, str, int]]] = []
        for p in sorted(pts, key=lambda q: (q[0], q[1])):
            for c in clusters:
                cy = float(np.median([q[0] for q in c]))
                cx = float(np.median([q[1] for q in c]))
                if _km((cy, cx), (p[0], p[1])) <= SAME_PLACE_KM:
                    c.append(p)
                    break
            else:
                clusters.append([p])
        for c in clusters:
            variants = Counter(q[2] for q in c)
            latest = max(q[3] for q in c)
            name = max(
                variants,
                key=lambda v: (any(ord(ch) > 127 for ch in v), max(q[3] for q in c if q[2] == v) == latest, variants[v]),
            )
            sites_per_year = Counter(q[3] for q in c)
            weight = round(sum(sites_per_year.values()) / max(1, len(sites_per_year)), 2)  # mean polling places per election
            out.append([name, round(float(np.median([q[0] for q in c])), 5), round(float(np.median([q[1] for q in c])), 5), "locality", weight])

    curated = []
    for r in load_json(CONFIG_DIR / "regions.json")["regions"]:
        w, s, e, n = r["bbox"]
        lat, lng = r.get("labelAt", [(s + n) / 2, (w + e) / 2])
        curated.append([r.get("label", r["name"]), round(lat, 5), round(lng, 5), r["kind"], 1000.0 if r["kind"] == "city" else 500.0])
    # A locality that is the same place as a curated city label is dropped.
    cities = [(_key(c[0]), (c[1], c[2])) for c in curated if c[3] == "city"]
    out = [row for row in out if not any(_key(row[0]) == k and _km(pos, (row[1], row[2])) <= 8 for k, pos in cities)]
    out.extend(curated)
    out.sort(key=lambda x: -x[4])
    return out


def update_labels(out_dir: Path) -> str:
    """Rebuild labels from already-generated results files and point the
    manifest at them (no geometry work)."""
    from .export import AssetWriter, dumps

    manifest = load_json(out_dir / "manifest.json")
    results = {e["year"]: load_json(out_dir / e["files"]["results"]) for e in manifest["elections"]}
    for old in out_dir.glob("labels.*.json"):
        old.unlink()
    rel = AssetWriter(out_dir).write("labels", {"labels": build_labels(results)})
    manifest["files"]["labels"] = rel
    (out_dir / "manifest.json").write_text(dumps(manifest), encoding="utf-8")
    return rel
