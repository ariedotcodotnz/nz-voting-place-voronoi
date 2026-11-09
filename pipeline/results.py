"""Parsers for party-vote-by-voting-place result files.

Three layouts are supported:

* ``e9``          2008-2014  ``e9_part8_party_N.csv``
* ``votingplace`` 2017+      ``party-votes-by-voting-place-N.csv`` (adds
                              'Advance Voting Places' / 'Voting Places' sections
                              and, in Māori electorate files, general-electorate
                              sub-headings)
* ``xlsx``        2026       per-electorate workbooks, 'Party' sheet

Every row is kept. Rows that are not physical venues (special votes, overseas
votes, aggregated advance votes, '<6 votes' aggregates, mobile teams) are
categorised as non-geographic, so electorate totals still reconcile.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from pathlib import Path

from .common import IssueLog, read_text
from .parties import PartyRegistry

SECTION_ADVANCE = "advance"
SECTION_ELECTION_DAY = "election_day"

# Aggregated, non-geographic row labels (matched case-insensitively against the
# label column after stripping a trailing ' - <electorate>' suffix).
NONGEO_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("special_before", re.compile(r"^special votes before polling day", re.I)),
    ("special_on", re.compile(r"^special votes on polling day", re.I)),
    ("overseas_party_only", re.compile(r"^overseas (special )?votes (allowed )?for party only|^overseas votes allowed for party only", re.I)),
    ("overseas", re.compile(r"^overseas special votes", re.I)),
    ("party_only", re.compile(r"^votes allowed for party only", re.I)),
    ("advance_aggregate", re.compile(r"^ordinary votes before polling day", re.I)),
    ("hospital_aggregate", re.compile(r"^hospital votes$", re.I)),
    ("small_places", re.compile(r"(polling|voting) places where less than 6 votes", re.I)),
    ("postal", re.compile(r"^postal votes", re.I)),
]

# Rows that look like mobile / institutional voting teams. These are only
# classed as mobile if they fail to match a fixed coordinate record.
MOBILE_RE = re.compile(
    r"\bteams?\b|mobile|pop.?up|care homes?|rest homes?|\bprisons?\b|police cells|various (locations?|sites)|^taken in\b|defence force team|\bavp\d",
    re.I,
)

NONGEO_LABELS = {
    "special_before": "Special votes before polling day",
    "special_on": "Special votes on polling day",
    "overseas": "Overseas special votes (incl. Defence Force)",
    "overseas_party_only": "Overseas votes for party only",
    "party_only": "Votes allowed for party only",
    "advance_aggregate": "Ordinary advance votes (not reported by venue)",
    "hospital_aggregate": "Hospital votes",
    "small_places": "Voting places with fewer than 6 votes (aggregated)",
    "postal": "Postal votes",
    "mobile": "Mobile, hospital, care-home and prison teams",
    "unmatched": "Venue rows that could not be located",
}


@dataclass
class ResultRow:
    year: int
    electorate_no: int
    electorate: str
    section: str
    suburb: str
    address: str  # label with the suburb removed
    label: str  # the row label exactly as in the file
    subheading: str | None
    votes: dict[str, int]
    total_valid: int
    informal: int
    source: str
    kind: str = "venue"  # venue | nongeo
    category: str | None = None  # NONGEO category when kind == nongeo
    looks_mobile: bool = False
    # Filled in by matching
    coord_index: int | None = None
    match_method: str | None = None
    match_score: float | None = None


@dataclass
class ElectorateResult:
    year: int
    number: int
    name: str
    kind: str  # general | maori
    parties: list[str]
    totals: dict[str, int]
    total_valid: int
    informal: int
    source: str
    preliminary: bool = False
    rows: list[ResultRow] = field(default_factory=list)


def _to_int(cell: object, ctx: str, year: int, log: IssueLog) -> int:
    if cell is None:
        return 0
    s = str(cell).strip().replace(",", "")
    if s == "":
        return 0
    if re.fullmatch(r"-?\d+", s):
        v = int(s)
        if v < 0:
            log.add(year, "negative_votes", "error", f"Negative vote count {v} at {ctx}; kept as 0 for calculation", value=v, at=ctx)
            return 0
        return v
    if re.fullmatch(r"-?\d+\.0+", s):
        log.add(year, "numeric_type", "warning", f"Vote count {s!r} written as a decimal at {ctx}", value=s, at=ctx)
        return int(float(s))
    raise ValueError(f"Non-integer vote cell {s!r} at {ctx}")


def classify_nongeo(label: str) -> str | None:
    base = re.sub(r"\s+-\s+.*$", "", label.strip())
    for cat, rx in NONGEO_PATTERNS:
        if rx.search(base) or rx.search(label):
            return cat
    return None


def _check_row_sum(row: ResultRow, log: IssueLog) -> None:
    s = sum(row.votes.values())
    if s != row.total_valid:
        log.add(
            row.year,
            "row_total_mismatch",
            "warning",
            f"Party votes sum to {s} but 'Total Valid Party Votes' is {row.total_valid} ({row.label!r}, {row.source})",
            sum=s,
            total=row.total_valid,
            at=row.source,
        )


def parse_party_csv(path: Path, year: int, registry: PartyRegistry, maori: set[str], log: IssueLog) -> ElectorateResult:
    text, encoding = read_text(path)
    if encoding == "cp1252":
        log.add(year, "encoding", "info", f"{path.name} decoded as Windows-1252", file=path.name)
    rows = list(csv.reader(io.StringIO(text)))
    m = re.match(r"^(.*?)\s+(\d+)\s*$", rows[1][0].strip())
    if not m:
        raise ValueError(f"{path}: cannot read electorate name/number from {rows[1][:2]!r}")
    name, number = m.group(1).strip(), int(m.group(2))
    header = [c.strip() for c in rows[2]]
    try:
        i_total = next(i for i, h in enumerate(header) if h.lower().startswith("total valid party votes"))
        i_inf = next(i for i, h in enumerate(header) if h.lower().startswith("informal party votes"))
    except StopIteration as exc:
        raise ValueError(f"{path}: header lacks total/informal columns") from exc
    party_cols: list[tuple[int, str]] = []
    for i in range(2, i_total):
        if not header[i]:
            log.add(year, "missing_party_identifier", "error", f"{path.name}: empty party header in column {i}", file=path.name)
            continue
        party_cols.append((i, registry.resolve(header[i], year, log)))

    er = ElectorateResult(year, number, name, "maori" if name in maori else "general", [p for _, p in party_cols], {}, 0, 0, path.name)
    section = SECTION_ELECTION_DAY
    suburb = ""
    subheading: str | None = None
    found_total = False
    for lineno, raw in enumerate(rows[3:], start=4):
        cells = [c.strip() for c in raw]
        if not any(cells):
            continue
        nonempty = [c for c in cells if c]
        ctx = f"{path.name}:{lineno}"
        if len(nonempty) == 1 and not re.match(r"^-?\d", nonempty[0]):
            # Section header, or a general-electorate sub-heading inside a Māori
            # electorate file (column 1 in 2017+, column 2 in 2008-2014).
            lab = nonempty[0]
            if re.fullmatch(r"(?i)advance voting places", lab):
                section, suburb, subheading = SECTION_ADVANCE, "", None
            elif re.fullmatch(r"(?i)(election day )?voting places", lab):
                section, suburb, subheading = SECTION_ELECTION_DAY, "", None
            else:
                subheading, suburb = lab, ""
            continue
        if cells[0].lower().startswith("electorate party valid votes"):
            break
        label = cells[1] if len(cells) > 1 else ""
        if len(cells) <= i_inf:
            if not found_total:
                log.add(year, "malformed_row", "warning", f"Row with {len(cells)} cells skipped at {ctx}: {cells[:3]!r}", at=ctx)
            continue
        try:
            votes = {pid: _to_int(cells[i], ctx, year, log) for i, pid in party_cols}
            total_valid = _to_int(cells[i_total], ctx, year, log)
            informal = _to_int(cells[i_inf], ctx, year, log)
        except ValueError as exc:
            log.add(year, "numeric_type", "error", str(exc), at=ctx)
            continue
        if not cells[0] and re.search(r"(?i)\btotal\s*$", label):
            er.totals, er.total_valid, er.informal = votes, total_valid, informal
            found_total = True
            break
        if cells[0]:
            suburb = cells[0]
        row = ResultRow(year, number, name, section, suburb if cells[0] or label else "", label, label, subheading, votes, total_valid, informal, ctx)
        cat = classify_nongeo(label) if not cells[0] else None
        if cat:
            row.kind, row.category, row.suburb = "nongeo", cat, ""
        row.looks_mobile = bool(MOBILE_RE.search(label) or MOBILE_RE.search(suburb))
        _check_row_sum(row, log)
        er.rows.append(row)
    if not found_total:
        log.add(year, "missing_total", "error", f"{path.name}: electorate total row not found", file=path.name)
    return er


def parse_party_xlsx(path: Path, year: int, registry: PartyRegistry, maori: set[str], log: IssueLog) -> ElectorateResult:
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if "Party" not in wb.sheetnames:
        raise ValueError(f"{path}: no 'Party' sheet")
    rows = list(wb["Party"].iter_rows(values_only=True))
    title = str(rows[0][0] or "")
    m = re.match(r"^\s*(\d+)\s+(.*?)\s+-\s+Party Vote Details", title)
    if not m:
        raise ValueError(f"{path}: unrecognised title {title[:80]!r}")
    number, name = int(m.group(1)), m.group(2).strip()
    preliminary = "preliminary" in title.lower()
    header = [str(c).strip() if c is not None else None for c in rows[0]]
    i_total = next(i for i, h in enumerate(header) if h and h.lower().startswith("total valid party votes"))
    i_inf = next(i for i, h in enumerate(header) if h and h.lower().startswith("informal party votes"))
    party_cols: list[tuple[int, str]] = []
    for i in range(1, i_total):
        if header[i] is None:
            continue  # spacer column
        party_cols.append((i, registry.resolve(header[i], year, log)))
    er = ElectorateResult(year, number, name, "maori" if name in maori else "general", [p for _, p in party_cols], {}, 0, 0, path.name, preliminary)
    section = SECTION_ELECTION_DAY
    found_total = False
    for lineno, row in enumerate(rows[1:], start=2):
        lab = str(row[0]).strip() if row[0] is not None else ""
        if not lab:
            continue
        ctx = f"{path.name}:Party!{lineno}"
        up = lab.upper()
        if up == "ADVANCE VOTING PLACES":
            section = SECTION_ADVANCE
            continue
        if up in ("VOTING PLACES", "ELECTION DAY VOTING PLACES"):
            section = SECTION_ELECTION_DAY
            continue
        if lab.startswith("Source:") or lab.startswith("Note:"):
            continue
        if all(c in (None, "") for c in row[1:]):
            log.add(year, "malformed_row", "info", f"Label-only row ignored at {ctx}: {lab[:60]!r}", at=ctx)
            continue
        try:
            votes = {pid: _to_int(row[i], ctx, year, log) for i, pid in party_cols}
            total_valid = _to_int(row[i_total], ctx, year, log)
            informal = _to_int(row[i_inf], ctx, year, log)
        except ValueError as exc:
            log.add(year, "numeric_type", "error", str(exc), at=ctx)
            continue
        if up.endswith(" TOTAL"):
            er.totals, er.total_valid, er.informal = votes, total_valid, informal
            found_total = True
            continue
        parts = [p.strip() for p in lab.split(",")]
        suburb = parts[0] if len(parts) > 1 else ""
        address = ", ".join(parts[1:]) if len(parts) > 1 else lab
        r = ResultRow(year, number, name, section, suburb, address, lab, None, votes, total_valid, informal, ctx)
        cat = classify_nongeo(lab)
        if cat:
            r.kind, r.category = "nongeo", cat
        r.looks_mobile = bool(MOBILE_RE.search(lab))
        _check_row_sum(r, log)
        er.rows.append(r)
    if not found_total:
        log.add(year, "missing_total", "error", f"{path.name}: electorate TOTAL row not found", file=path.name)
    return er


def reconcile(er: ElectorateResult, log: IssueLog) -> None:
    """Check that every row (venue and non-geographic) sums to the official
    electorate total, party by party."""
    if not er.totals:
        return
    for pid in er.parties:
        s = sum(r.votes.get(pid, 0) for r in er.rows)
        if s != er.totals.get(pid, 0):
            log.add(
                er.year,
                "electorate_total_mismatch",
                "warning",
                f"{er.name}: rows sum to {s} {pid} votes but the electorate total row says {er.totals.get(pid, 0)}",
                electorate=er.name,
                party=pid,
                rows_sum=s,
                total=er.totals.get(pid, 0),
            )
    s_total = sum(r.total_valid for r in er.rows)
    if s_total != er.total_valid:
        log.add(er.year, "electorate_total_mismatch", "warning", f"{er.name}: row totals sum to {s_total} but the electorate total is {er.total_valid}", electorate=er.name)
