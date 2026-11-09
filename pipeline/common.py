"""Shared helpers: paths, text decoding, address normalisation, issue logging."""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CONFIG_DIR = ROOT / "config"
OUT_DIR = ROOT / "public" / "data"
BUILD_DIR = ROOT / "build" / "pipeline"  # intermediate artefacts (gitignored)
REPORT_DIR = ROOT / "reports"

# Metric CRS for all geometric work, and browser CRS.
CRS_METRIC = "EPSG:2193"  # NZGD2000 / New Zealand Transverse Mercator 2000
CRS_WGS84 = "EPSG:4326"

# Plausible New Zealand extent, including the Chatham Islands (which straddle 180°).
NZ_LAT_RANGE = (-53.0, -29.0)


def lng_in_nz(lng: float) -> bool:
    return 165.0 <= lng <= 180.0 or -180.0 <= lng <= -175.5


def load_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def decode_bytes(raw: bytes) -> tuple[str, str]:
    """Decode a source file, detecting the encodings actually present in the
    Electoral Commission files (UTF-16 LE with BOM, UTF-8 with/without BOM,
    and Windows-1252 for a handful of 2008 files). Returns (text, encoding)."""
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16"), "utf-16"
    try:
        return raw.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        return raw.decode("cp1252"), "cp1252"


def read_text(path: Path) -> tuple[str, str]:
    return decode_bytes(path.read_bytes())


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

_ABBREVIATIONS = {
    "st": "street",
    "str": "street",
    "rd": "road",
    "ave": "avenue",
    "av": "avenue",
    "cnr": "corner",
    "crn": "corner",
    "mt": "mount",
    "dr": "drive",
    "cres": "crescent",
    "pl": "place",
    "tce": "terrace",
    "hwy": "highway",
    "sh": "state highway",
    "nth": "north",
    "sth": "south",
    "ctr": "centre",
    "center": "centre",
    "hq": "headquarters",
    "pde": "parade",
    "esp": "esplanade",
    "bldg": "building",
    "lvl": "level",
    "ste": "suite",
    "and": "and",
}


def fold(s: str) -> str:
    """Lower-case, strip macrons/diacritics and typographic quotes."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().replace("’", "'").replace("‘", "'").replace("–", "-").replace("—", "-")


def norm_text(s: str | None) -> str:
    """Normalise an address/venue string for comparison."""
    if not s:
        return ""
    s = fold(s).replace("&", " and ")
    s = re.sub(r"'", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    tokens = [_ABBREVIATIONS.get(t, t) for t in s.split()]
    return " ".join(tokens)


def norm_name(s: str | None) -> str:
    """Normalise a party or electorate name (no abbreviation expansion)."""
    if not s:
        return ""
    s = fold(s).replace("&", " and ")
    s = re.sub(r"'", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


_NUM_RE = re.compile(r"\b\d+[a-z]?\b")


def street_numbers(normed: str) -> set[str]:
    return set(_NUM_RE.findall(normed))


def similarity(a: str, b: str) -> float:
    """Similarity in [0,1] between two *normalised* strings.

    Combines a sequence ratio with a token-set ratio, and heavily penalises
    conflicting street numbers (so '10 Main Street' never matches '100 Main
    Street')."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    seq = SequenceMatcher(None, a, b, autojunk=False).ratio()
    ta, tb = set(a.split()), set(b.split())
    inter = len(ta & tb)
    tok = inter / max(1, min(len(ta), len(tb)))
    tok_all = inter / max(1, len(ta | tb))
    score = max(seq, 0.5 * tok + 0.5 * tok_all)
    na, nb = street_numbers(a), street_numbers(b)
    if na and nb and not (na & nb):
        score *= 0.6
    return score


def venue_name(address: str) -> str:
    """First comma-separated component of an address — normally the venue name
    (e.g. 'Freemans Bay School' from 'Freemans Bay School, 95 Wellington Street')."""
    return address.split(",")[0].strip() if address else ""


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", norm_name(s))


# ---------------------------------------------------------------------------
# Issue log — every data-quality decision is recorded, never silently applied.
# ---------------------------------------------------------------------------


@dataclass
class Issue:
    year: int | None
    category: str
    severity: str  # info | warning | error
    message: str
    detail: dict[str, Any] = field(default_factory=dict)


class IssueLog:
    def __init__(self) -> None:
        self.issues: list[Issue] = []

    def add(self, year: int | None, category: str, severity: str, message: str, **detail: Any) -> None:
        self.issues.append(Issue(year, category, severity, message, detail))

    def by_year(self) -> dict[Any, list[Issue]]:
        out: dict[Any, list[Issue]] = defaultdict(list)
        for i in self.issues:
            out[i.year].append(i)
        return out

    def counts(self, year: int | None = None) -> dict[str, int]:
        out: dict[str, int] = defaultdict(int)
        for i in self.issues:
            if year is None or i.year == year:
                out[f"{i.severity}:{i.category}"] += 1
        return dict(out)

    def to_json(self) -> list[dict[str, Any]]:
        return [
            {"year": i.year, "category": i.category, "severity": i.severity, "message": i.message, **({"detail": i.detail} if i.detail else {})}
            for i in self.issues
        ]
