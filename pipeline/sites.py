"""Deduplicate matched venues into physical polling-place sites for one election.

A site is one physical location. Within an election the same building can
appear several times: as an advance and an election-day venue, in the results
of several electorates (voters may vote outside their home electorate), and
occasionally under two slightly different coordinate records. Coordinate
records are merged into one site when they are within ``MERGE_SAME_M`` metres,
or within ``MERGE_NEAR_M`` metres and their venue names are similar.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

import numpy as np
from scipy.spatial import cKDTree

from .common import IssueLog, norm_text, similarity, venue_name
from .coords import CoordRecord
from .results import SECTION_ADVANCE, ResultRow

MERGE_SAME_M = 15.0
MERGE_NEAR_M = 60.0
MERGE_NAME_SIM = 0.75


@dataclass
class Site:
    year: int
    index: int
    x: float
    y: float
    lat: float
    lng: float
    name: str
    address: str
    suburb: str
    home_electorate: str | None
    home_electorate_no: int | None
    types: set[str] = field(default_factory=set)
    electorates: Counter[str] = field(default_factory=Counter)  # electorate -> valid votes recorded there
    votes_adv: Counter[str] = field(default_factory=Counter)
    votes_ed: Counter[str] = field(default_factory=Counter)
    total_adv: int = 0
    total_ed: int = 0
    informal_adv: int = 0
    informal_ed: int = 0
    rows: list[ResultRow] = field(default_factory=list)
    coord_records: list[CoordRecord] = field(default_factory=list)
    location_source_year: int | None = None  # != year when inferred from another year's file
    match_methods: Counter[str] = field(default_factory=Counter)
    suppressed_rows: int = 0
    stable_id: str | None = None
    # Electorate (candidate) votes, by the candidate's party ('?' = unknown)
    cand_ed: Counter[str] = field(default_factory=Counter)
    cand_adv: Counter[str] = field(default_factory=Counter)
    cand_total_ed: int = 0
    cand_total_adv: int = 0
    # electorate name -> {"ed": Counter[candidate], "adv": Counter[candidate]}
    cand_detail: dict = field(default_factory=dict)

    @property
    def total(self) -> int:
        return self.total_adv + self.total_ed


class _UF:
    def __init__(self, n: int) -> None:
        self.p = list(range(n))

    def find(self, a: int) -> int:
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[max(ra, rb)] = min(ra, rb)


def build_sites(year: int, rows: list[ResultRow], records: list[CoordRecord], log: IssueLog) -> list[Site]:
    matched = [r for r in rows if r.kind == "venue" and r.coord_index is not None]
    used = sorted({r.coord_index for r in matched if r.coord_index is not None})
    if not used:
        return []
    pos = {ci: k for k, ci in enumerate(used)}
    xy = np.array([[records[ci].x, records[ci].y] for ci in used])
    uf = _UF(len(used))
    tree = cKDTree(xy)
    for a, b in sorted(tree.query_pairs(MERGE_NEAR_M)):
        d = float(np.hypot(*(xy[a] - xy[b])))
        ra, rb = records[used[a]], records[used[b]]
        if d <= MERGE_SAME_M or similarity(norm_text(venue_name(ra.address)), norm_text(venue_name(rb.address))) >= MERGE_NAME_SIM:
            uf.union(a, b)

    groups: dict[int, list[int]] = defaultdict(list)
    for k in range(len(used)):
        groups[uf.find(k)].append(k)

    rows_by_coord: dict[int, list[ResultRow]] = defaultdict(list)
    for r in matched:
        rows_by_coord[r.coord_index].append(r)  # type: ignore[index]

    sites: list[Site] = []
    for members in groups.values():
        cis = [used[k] for k in members]
        votes_per_ci = {ci: sum(r.total_valid for r in rows_by_coord[ci]) for ci in cis}
        # Dominant record: most votes, then prefer election-day records.
        dom = max(cis, key=lambda ci: (votes_per_ci[ci], records[ci].type != SECTION_ADVANCE, -ci))
        rec = records[dom]
        site = Site(
            year=year,
            index=-1,
            x=rec.x,
            y=rec.y,
            lat=rec.lat,
            lng=rec.lng,
            name=venue_name(rec.address) or rec.address,
            address=rec.address,
            suburb=rec.suburb,
            home_electorate=rec.electorate,
            home_electorate_no=rec.electorate_no,
            location_source_year=rec.year if rec.year != year else None,
        )
        site.coord_records = [records[ci] for ci in cis]
        for ci in cis:
            for r in rows_by_coord[ci]:
                site.rows.append(r)
                site.types.add(r.section)
                site.electorates[r.electorate] += r.total_valid
                site.match_methods[r.match_method or "?"] += 1
                if r.total_valid == 0:
                    site.suppressed_rows += 1
                if r.section == SECTION_ADVANCE:
                    site.votes_adv.update(r.votes)
                    site.total_adv += r.total_valid
                    site.informal_adv += r.informal
                else:
                    site.votes_ed.update(r.votes)
                    site.total_ed += r.total_valid
                    site.informal_ed += r.informal
        if site.location_source_year is not None:
            # The coordinate file's electorate belongs to another election's
            # boundaries; use the electorate where most votes were cast instead.
            site.home_electorate = site.electorates.most_common(1)[0][0]
            site.home_electorate_no = next((r.electorate_no for r in site.rows if r.electorate == site.home_electorate), None)
        if len(cis) > 1:
            spread = max(float(np.hypot(records[a].x - records[b].x, records[a].y - records[b].y)) for a in cis for b in cis)
            if spread > MERGE_SAME_M:
                log.add(
                    year,
                    "duplicate_polling_place",
                    "info",
                    f"Merged {len(cis)} coordinate records up to {spread:.0f} m apart into one site: {site.name!r}",
                    names=sorted({records[ci].address for ci in cis})[:5],
                )
        sites.append(site)

    sites.sort(key=lambda s: (-s.y, s.x))
    for i, s in enumerate(sites):
        s.index = i
    return sites
