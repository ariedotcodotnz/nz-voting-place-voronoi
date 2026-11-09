"""Voting-place coordinate readers.

Supports the Electoral Commission coordinate CSVs (NZMG for 2008, WGS84 +
NZTM2000 thereafter, with slightly different column names each year) and the
vote.nz-style ``places.json`` used for 2026.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from pyproj import Transformer

from .common import NZ_LAT_RANGE, IssueLog, lng_in_nz, read_text
from .results import SECTION_ADVANCE, SECTION_ELECTION_DAY

_TO_NZTM = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
_NZMG_TO_NZTM = Transformer.from_crs("EPSG:27200", "EPSG:2193", always_xy=True)
_NZTM_TO_WGS = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)


@dataclass
class CoordRecord:
    year: int  # the election whose coordinate file this record came from
    electorate_no: int | None
    electorate: str | None
    type: str | None  # advance | election_day | both | None
    suburb: str
    address: str  # address without suburb
    full_label: str
    src_id: str | None
    lat: float
    lng: float
    x: float
    y: float
    source: str
    served: list[int] | None = None  # electorates served (places.json only)
    crs_note: str | None = None


def _find(header: list[str], *patterns: str) -> int | None:
    for i, h in enumerate(header):
        hl = h.lower()
        if all(p in hl for p in patterns):
            return i
    return None


def _valid_wgs(lat: float, lng: float) -> bool:
    return (
        not (math.isnan(lat) or math.isnan(lng))
        and NZ_LAT_RANGE[0] <= lat <= NZ_LAT_RANGE[1]
        and lng_in_nz(lng)
    )


def read_coordinate_csv(path: Path, year: int, crs: str, log: IssueLog) -> list[CoordRecord]:
    text, enc = read_text(path)
    rows = list(csv.reader(io.StringIO(text)))
    header = [h.strip().lstrip("﻿") for h in rows[0]]
    i_eno = _find(header, "electorate", "number")
    i_ename = _find(header, "electorate", "name")
    i_type = _find(header, "type")
    i_id = _find(header, "place", "id")
    i_sub = _find(header, "suburb")
    i_addr = _find(header, "address")
    i_lat = _find(header, "latitude")
    i_lng = _find(header, "longitude")
    i_e = _find(header, "easting")
    i_n = _find(header, "northing")
    if i_addr is None:
        raise ValueError(f"{path}: no address column in {header}")
    out: list[CoordRecord] = []
    for lineno, r in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in r):
            continue
        ctx = f"{path.name}:{lineno}"

        def g(i: int | None) -> str:
            return r[i].strip() if i is not None and i < len(r) else ""

        typ_raw = g(i_type).lower()
        typ = SECTION_ADVANCE if typ_raw.startswith("adv") else SECTION_ELECTION_DAY if typ_raw.startswith("election") else (SECTION_ELECTION_DAY if i_type is None else None)
        try:
            lat = float(g(i_lat)) if i_lat is not None and g(i_lat) else math.nan
            lng = float(g(i_lng)) if i_lng is not None and g(i_lng) else math.nan
            east = float(g(i_e)) if i_e is not None and g(i_e) else math.nan
            north = float(g(i_n)) if i_n is not None and g(i_n) else math.nan
        except ValueError:
            log.add(year, "invalid_coordinates", "error", f"Unparseable coordinate at {ctx}: {r!r}", at=ctx)
            continue
        note = None
        if crs == "EPSG:27200":
            if math.isnan(east) or math.isnan(north):
                log.add(year, "invalid_coordinates", "error", f"Missing NZMG coordinate at {ctx}", at=ctx)
                continue
            x, y = _NZMG_TO_NZTM.transform(east, north)
            lng, lat = _NZTM_TO_WGS.transform(x, y)
            note = "converted from NZMG (EPSG:27200)"
        else:
            if math.isnan(lat) or math.isnan(lng):
                if not (math.isnan(east) or math.isnan(north)):
                    lng, lat = _NZTM_TO_WGS.transform(east, north)
                    note = "derived from NZTM"
                else:
                    log.add(year, "invalid_coordinates", "error", f"Missing coordinates at {ctx}", at=ctx)
                    continue
            x, y = _TO_NZTM.transform(lng, lat)
            if not (math.isnan(east) or math.isnan(north)):
                d = math.hypot(x - east, y - north)
                if d > 50:
                    log.add(
                        year,
                        "coordinate_inconsistency",
                        "warning",
                        f"WGS84 and NZTM coordinates disagree by {d:.0f} m at {ctx}; WGS84 used",
                        at=ctx,
                        distance_m=round(d),
                    )
        if not _valid_wgs(lat, lng):
            log.add(year, "invalid_coordinates", "error", f"Coordinate outside New Zealand at {ctx}: {lat}, {lng}", at=ctx)
            continue
        eno = g(i_eno)
        out.append(
            CoordRecord(
                year=year,
                electorate_no=int(eno) if eno.isdigit() else None,
                electorate=g(i_ename) or None,
                type=typ,
                suburb=g(i_sub),
                address=g(i_addr),
                full_label=f"{g(i_sub)}, {g(i_addr)}",
                src_id=g(i_id) or None,
                lat=lat,
                lng=lng,
                x=x,
                y=y,
                source=ctx,
                crs_note=note,
            )
        )
    return out


def read_places_json(path: Path, year: int, log: IssueLog) -> tuple[list[CoordRecord], dict[str, object]]:
    """Read a vote.nz-style places.json.

    Each place is ``[id, home_electorate, "venue, address, suburb", lat, lng,
    [electorates served], <unused>, [[day_index, open, close], ...], <unused>]``
    where day indices count from ``election.advanceFrom`` and the index of
    election day marks an election-day venue."""
    doc = json.loads(read_text(path)[0])
    election = doc.get("election", {})
    adv_from = date.fromisoformat(election["advanceFrom"]) if "advanceFrom" in election else None
    eday = date.fromisoformat(election["day"]) if "day" in election else None
    eday_index = (eday - adv_from).days if adv_from and eday else None
    electorates = {int(e[0]): e[1] for e in doc.get("electorates", [])}
    out: list[CoordRecord] = []
    for k, p in enumerate(doc["places"]):
        ctx = f"{path.name}:places[{k}]"
        try:
            pid, home, label, lat, lng, served, _u1, hours = p[0], p[1], p[2], float(p[3]), float(p[4]), p[5], p[6], p[7]
        except (IndexError, TypeError, ValueError):
            log.add(year, "invalid_coordinates", "error", f"Malformed place record at {ctx}: {p!r}", at=ctx)
            continue
        if not _valid_wgs(lat, lng):
            log.add(year, "invalid_coordinates", "error", f"Coordinate outside New Zealand at {ctx}: {lat}, {lng}", at=ctx)
            continue
        days = {int(h[0]) for h in (hours or []) if isinstance(h, list) and h}
        typ = None
        if eday_index is not None and days:
            has_adv = any(d < eday_index for d in days)
            has_ed = eday_index in days
            typ = "both" if has_adv and has_ed else SECTION_ADVANCE if has_adv else SECTION_ELECTION_DAY if has_ed else None
        parts = [s.strip() for s in str(label).split(",")]
        suburb = parts[-1] if len(parts) > 1 else ""
        address = ", ".join(parts[:-1]) if len(parts) > 1 else str(label)
        x, y = _TO_NZTM.transform(lng, lat)
        out.append(
            CoordRecord(
                year=year,
                electorate_no=int(home) if home is not None else None,
                electorate=electorates.get(int(home)) if home is not None else None,
                type=typ,
                suburb=suburb,
                address=address,
                full_label=str(label),
                src_id=str(pid),
                lat=lat,
                lng=lng,
                x=x,
                y=y,
                source=ctx,
                served=[int(s) for s in served] if served else None,
            )
        )
    meta = {"source": doc.get("source"), "built": doc.get("built"), "mirrored": doc.get("mirrored"), "election": election, "hoursFrom": doc.get("hoursFrom")}
    return out, meta


def strip_suburb_tail(address: str, suburb: str) -> str:
    """Remove a trailing ', <suburb>' from an address if present."""
    if suburb and re.search(r",\s*" + re.escape(suburb) + r"\s*$", address, re.I):
        return re.sub(r",\s*" + re.escape(suburb) + r"\s*$", "", address, flags=re.I)
    return address
