"""Electorate (candidate) votes.

Candidate-vote files list the same venues as the party-vote files (minus the
party-only special-vote rows). Each candidate row is joined to its party row,
so it inherits the location already worked out for that venue. Candidates are
mapped to parties using the "Electorate Candidate Valid Votes / Party" table
printed at the end of each file. Where a file has no such table (the 2026
preliminary workbooks), an optional ``candidate-parties.csv`` in that election's
folder (columns: electorate, candidate, party) supplies it; otherwise
candidate votes are kept by candidate name only and are not attributed to any
party. Affiliations are never guessed from other elections.

Because voters can vote outside their electorate, one polling place can record
candidate votes for several electorates. For maps, candidate votes are summed
by the candidate's party so they can be compared with party votes.
"""

from __future__ import annotations

import csv
import io
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .common import IssueLog, norm_name, norm_text, read_text
from .parties import PartyRegistry
from .results import SECTION_ADVANCE, ElectorateResult
from .sites import Site


def load_affiliation_override(path: Path, log: IssueLog, year: int) -> dict[tuple[str, str], str]:
    """Optional data/<year>/candidate-parties.csv: electorate,candidate,party."""
    if not path.exists():
        return {}
    text, _ = read_text(path)
    out: dict[tuple[str, str], str] = {}
    for row in csv.DictReader(io.StringIO(text)):
        e, c, p = (row.get("electorate") or "").strip(), (row.get("candidate") or "").strip(), (row.get("party") or "").strip()
        if e and c and p:
            out[(norm_name(e), norm_name(c))] = p
    log.add(year, "candidate_affiliations", "info", f"{len(out)} candidate affiliations read from {path.name}")
    return out


def join_candidates(year: int, party_ers: list[ElectorateResult], cand_ers: list[ElectorateResult], registry: PartyRegistry, log: IssueLog, override: dict[tuple[str, str], str]) -> None:
    by_no = {e.number: e for e in party_ers}
    # Year-wide fallback: the same venue label located in another electorate's
    # party file (candidate files occasionally list a venue that the matching
    # party file does not). Only unambiguous labels are used.
    located: dict[str, set[int]] = defaultdict(set)
    for pe in party_ers:
        for r in pe.rows:
            if r.kind == "venue" and r.coord_index is not None:
                located[norm_text(r.label)].add(r.coord_index)
    for ce in cand_ers:
        pe = by_no.get(ce.number)
        if pe is None:
            log.add(year, "candidate_join", "error", f"Candidate file {ce.source} has no matching party-vote electorate {ce.number}")
            continue
        party_of: dict[str, str | None] = {}
        for cand, raw in ce.affiliations.items():
            raw = raw or override.get((norm_name(ce.name), norm_name(cand)))
            party_of[cand] = registry.resolve(raw, year, log, context="candidate") if raw else None
        ce.party_of = party_of  # type: ignore[attr-defined]
        index: dict[tuple[str, str], list] = defaultdict(list)
        for r in pe.rows:
            index[(r.section, norm_text(r.label))].append(r)
        seen: Counter[tuple[str, str]] = Counter()
        for cr in ce.rows:
            key = (cr.section, norm_text(cr.label))
            k = seen[key]
            seen[key] += 1
            matches = index.get(key, [])
            if k < len(matches):
                pr = matches[k]
                cr.kind, cr.category, cr.coord_index, cr.match_method = pr.kind, pr.category, pr.coord_index, pr.match_method
            elif len(located.get(key[1], ())) == 1 and not cr.looks_mobile:
                cr.kind, cr.category, cr.coord_index, cr.match_method = "venue", None, next(iter(located[key[1]])), "label-from-party-file"
                log.add(year, "candidate_join", "info", f"Candidate row {cr.label!r} ({ce.name}) is absent from that electorate's party file; located from the same venue in another electorate", at=cr.source)
            else:
                cr.kind, cr.category = "nongeo", "unmatched"
                log.add(year, "candidate_join", "warning", f"Candidate row {cr.label!r} ({ce.name}) has no matching party-vote row; kept in totals, not mapped", at=cr.source)
        pe.candidate = ce  # type: ignore[attr-defined]


def aggregate_candidates(sites: list[Site], party_ers: list[ElectorateResult]) -> None:
    """Attach candidate votes to sites (by party, and by candidate name per electorate)."""
    site_of: dict[int, Site] = {}
    for s in sites:
        for r in s.rows:
            if r.coord_index is not None:
                site_of[r.coord_index] = s
    for pe in party_ers:
        ce = getattr(pe, "candidate", None)
        if ce is None:
            continue
        for cr in ce.rows:
            if cr.kind != "venue" or cr.coord_index is None or cr.coord_index not in site_of:
                continue
            s = site_of[cr.coord_index]
            adv = cr.section == SECTION_ADVANCE
            by_party = s.cand_adv if adv else s.cand_ed
            for cand, v in cr.votes.items():
                by_party[ce.party_of.get(cand) or "?"] += v
            if adv:
                s.cand_total_adv += cr.total_valid
            else:
                s.cand_total_ed += cr.total_valid
            d = s.cand_detail.setdefault(ce.name, {"ed": Counter(), "adv": Counter()})
            d["adv" if adv else "ed"].update(cr.votes)


def candidates_payload(year: int, sites: list[Site], party_ers: list[ElectorateResult], adv_by_venue: bool, eidx: dict[str, int]) -> dict[str, Any] | None:
    cand_ers = [getattr(pe, "candidate", None) for pe in party_ers]
    if not any(cand_ers):
        return None
    available = all(ce is None or all(ce.party_of.get(c) for c in ce.parties) for ce in cand_ers)
    national: Counter[str] = Counter()
    for ce in cand_ers:
        if ce is None:
            continue
        for c, v in ce.totals.items():
            national[ce.party_of.get(c) or "?"] += v
    columns = [p for p, _ in national.most_common() if p != "?"]
    if "?" in national:
        columns.append("?")
    electorates: list[dict[str, Any] | None] = []
    for ce in cand_ers:
        if ce is None:
            electorates.append(None)
            continue
        totals = [ce.totals.get(c, 0) for c in ce.parties]
        order = sorted(range(len(totals)), key=lambda k: -totals[k])
        electorates.append(
            {
                "names": ce.parties,
                "parties": [ce.party_of.get(c) for c in ce.parties],
                "totals": totals,
                "totalValid": ce.total_valid,
                "informal": ce.informal,
                "winner": order[0] if totals else None,
                "majority": (totals[order[0]] - totals[order[1]]) if len(order) > 1 else None,
                "note": ce.note,
            }
        )
    site_detail = []
    for s in sites:
        entries = []
        for ename, d in sorted(s.cand_detail.items(), key=lambda kv: -(sum(kv[1]["ed"].values()) + sum(kv[1]["adv"].values()))):
            ce = next(c for c in cand_ers if c is not None and c.name == ename)
            entries.append([eidx[norm_name(ename)], [d["ed"].get(c, 0) for c in ce.parties], [d["adv"].get(c, 0) for c in ce.parties] if adv_by_venue else None])
        site_detail.append(entries)
    return {
        "available": available,
        "parties": columns,
        "e": [[s.cand_ed.get(p, 0) for p in columns] for s in sites],
        "a": [[s.cand_adv.get(p, 0) for p in columns] for s in sites] if adv_by_venue else None,
        "te": [s.cand_total_ed for s in sites],
        "ta": [s.cand_total_adv for s in sites] if adv_by_venue else None,
        "national": [national.get(p, 0) for p in columns],
        "electorates": electorates,
        "sites": site_detail,
    }
