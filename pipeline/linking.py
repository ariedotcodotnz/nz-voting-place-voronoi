"""Link physical sites across elections into stable locations.

Candidate pairs are sites from *different* elections within ``MAX_LINK_M``.
Each pair gets a confidence class from distance and venue-name similarity:

* ``exact``     ≤ 30 m and similar name (≥ 0.6)
* ``high``      ≤ 30 m (any name) · ≤ 100 m and name ≥ 0.75 · ≤ 300 m and name ≥ 0.92
* ``probable``  ≤ 100 m and name ≥ 0.45 · ≤ 200 m and name ≥ 0.8

Pairs are merged greedily (best first) with the constraint that a stable
location never contains two sites from the same election, so ambiguous
matches cannot silently combine different venues. Within each stable location
the pairwise confidence of every pair of elections is recorded; a pair that is
only connected through intermediate elections is marked ``chained``.

Sites whose location was inferred from another election's coordinate file
(2011) are flagged ``address-inferred`` for links to that source election.
"""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np
from scipy.spatial import cKDTree

from .common import IssueLog, norm_text, similarity
from .sites import Site

MAX_LINK_M = 300.0
CONF_RANK = {"exact": 0, "high": 1, "probable": 2}


def classify(d: float, s: float) -> str | None:
    if d <= 30 and s >= 0.6:
        return "exact"
    if d <= 30 or (d <= 100 and s >= 0.75) or (d <= 300 and s >= 0.92):
        return "high"
    if (d <= 100 and s >= 0.45) or (d <= 200 and s >= 0.8):
        return "probable"
    return None


def _name_key(s: Site) -> str:
    return norm_text(s.name)


def _stable_id(x: float, y: float, taken: set[str]) -> str:
    base = f"{int(x // 10):06d}-{int(y // 10):06d}"
    sid, n = base, 1
    while sid in taken:
        n += 1
        sid = f"{base}-{n}"
    taken.add(sid)
    return sid


def link_sites(all_sites: dict[int, list[Site]], log: IssueLog) -> dict[str, dict]:
    flat: list[Site] = [s for y in sorted(all_sites) for s in all_sites[y]]
    if not flat:
        return {}
    xy = np.array([[s.x, s.y] for s in flat])
    names = [_name_key(s) for s in flat]
    tree = cKDTree(xy)
    pairs = []
    for a, b in tree.query_pairs(MAX_LINK_M):
        if flat[a].year == flat[b].year:
            continue
        d = float(np.hypot(*(xy[a] - xy[b])))
        s = similarity(names[a], names[b])
        c = classify(d, s)
        if c:
            pairs.append((CONF_RANK[c], d, -s, a, b, c))
    pairs.sort()

    parent = list(range(len(flat)))
    years: list[set[int]] = [{s.year} for s in flat]

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    rejected = 0
    for _, d, _, a, b, c in pairs:
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        if years[ra] & years[rb]:
            rejected += 1
            continue
        parent[rb] = ra
        years[ra] |= years[rb]

    clusters: dict[int, list[int]] = defaultdict(list)
    for i in range(len(flat)):
        clusters[find(i)].append(i)

    taken: set[str] = set()
    out: dict[str, dict] = {}
    for members in sorted(clusters.values(), key=lambda m: min(flat[i].year for i in m) * 1e7 + min(flat[i].x for i in m)):
        members.sort(key=lambda i: flat[i].year)
        first = flat[members[0]]
        sid = _stable_id(first.x, first.y, taken)
        latest = flat[members[-1]]
        conf: dict[str, str] = {}
        for ai in range(len(members)):
            for bi in range(ai + 1, len(members)):
                sa, sb = flat[members[ai]], flat[members[bi]]
                d = math.hypot(sa.x - sb.x, sa.y - sb.y)
                c = classify(d, similarity(names[members[ai]], names[members[bi]])) or "chained"
                if sb.location_source_year == sa.year or sa.location_source_year == sb.year:
                    c = "address-inferred" if c in ("exact", "high") else c
                conf[f"{sa.year}-{sb.year}"] = c
        for i in members:
            flat[i].stable_id = sid
        out[sid] = {
            "id": sid,
            "name": latest.name,
            "suburb": latest.suburb,
            "lat": round(latest.lat, 6),
            "lng": round(latest.lng, 6),
            "years": {str(flat[i].year): flat[i].index for i in members},
            "confidence": conf,
        }
    log.add(None, "historical_matching", "info", f"{len(out)} stable locations from {len(flat)} election-specific sites; {rejected} candidate links rejected because they would merge two venues of one election")
    return out
