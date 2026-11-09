"""Stage 1: read every configured election, join results to coordinates and
build election-specific physical sites."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .common import CONFIG_DIR, DATA_DIR, IssueLog, load_json
from .coords import CoordRecord, read_coordinate_csv, read_places_json
from .match import CoordIndex
from .parties import PartyRegistry
from .candidates import aggregate_candidates, join_candidates, load_affiliation_override
from .results import ElectorateResult, parse_candidate_csv, parse_candidate_xlsx, parse_party_csv, parse_party_xlsx, reconcile
from .sites import Site, build_sites


@dataclass
class Election:
    year: int
    config: dict
    electorates: list[ElectorateResult] = field(default_factory=list)
    coords: list[CoordRecord] = field(default_factory=list)  # match pool (may include fallback years)
    own_coords: int = 0
    sites: list[Site] = field(default_factory=list)
    places_meta: dict | None = None
    candidate_electorates: list[ElectorateResult] = field(default_factory=list)
    preliminary: bool = False
    stats: dict = field(default_factory=dict)

    @property
    def parties(self) -> list[str]:
        seen: dict[str, None] = {}
        for e in self.electorates:
            for p in e.parties:
                seen.setdefault(p, None)
        return list(seen)


def load_election_config(data_dir: Path = DATA_DIR) -> tuple[list[dict], set[str], IssueLog]:
    log = IssueLog()
    cfg = load_json(CONFIG_DIR / "elections.json")
    elections = {e["year"]: e for e in cfg["elections"]}
    # Auto-detect year folders that are not configured.
    for d in sorted(data_dir.iterdir()):
        if not re.fullmatch(r"\d{4}", d.name):
            continue
        y = int(d.name)
        if y in elections:
            continue
        files = {p.name for p in d.iterdir()}
        guess: dict | None = None
        if any(f.startswith("party-votes-by-voting-place-") for f in files):
            coord = next((f for f in sorted(files) if "coordinates" in f.lower()), None)
            guess = {"format": "votingplace", "party_glob": "party-votes-by-voting-place-*.csv", "coordinates": {"kind": "csv", "file": coord, "crs": "EPSG:4326"} if coord else {"kind": "none"}, "advance_by_venue": True}
        elif any(f.startswith("e9_part8_party_") for f in files):
            coord = next((f for f in sorted(files) if "ordinates" in f.lower()), None)
            guess = {"format": "e9", "party_glob": "e9_part8_party_*.csv", "coordinates": {"kind": "csv", "file": coord, "crs": "EPSG:4326"} if coord else {"kind": "none"}, "advance_by_venue": False}
        elif any(f.endswith(".xlsx") for f in files):
            guess = {"format": "xlsx", "party_glob": "*.xlsx", "coordinates": {"kind": "places-json", "file": "places.json"} if "places.json" in files else {"kind": "none"}, "advance_by_venue": True}
        if guess:
            guess.update({"year": y, "status": "final", "autodetected": True})
            elections[y] = guess
            log.add(y, "config", "warning", f"data/{y} is not in config/elections.json; auto-detected format {guess['format']!r}. Review and add it to the config.")
        else:
            log.add(y, "missing_election", "warning", f"data/{y} exists but no recognised result files were found")
    for y, e in elections.items():
        if not (data_dir / str(y)).is_dir():
            log.add(y, "missing_election", "error", f"Election {y} is configured but data/{y} does not exist; it is skipped")
    present = sorted(y for y in elections if (data_dir / str(y)).is_dir())
    return [elections[y] for y in present], set(cfg.get("maori_electorates", [])), log


def ingest(registry: PartyRegistry, log: IssueLog, configs: list[dict], maori: set[str], data_dir: Path = DATA_DIR) -> dict[int, Election]:
    elections: dict[int, Election] = {}
    own_coords: dict[int, list[CoordRecord]] = {}

    # Pass 1: results + own coordinates
    for cfg in configs:
        y = cfg["year"]
        el = Election(y, cfg)
        ydir = data_dir / str(y)
        files = sorted(ydir.glob(cfg["party_glob"]), key=lambda p: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p.name)])
        if not files:
            log.add(y, "missing_election", "error", f"No party result files matching {cfg['party_glob']} in data/{y}")
            continue
        for f in files:
            er = parse_party_xlsx(f, y, registry, maori, log) if cfg["format"] == "xlsx" else parse_party_csv(f, y, registry, maori, log)
            reconcile(er, log)
            el.electorates.append(er)
        cglob = cfg.get("candidate_glob")
        if cglob:
            cfiles = sorted(ydir.glob(cglob), key=lambda p: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p.name)])
            for f in cfiles:
                ce = parse_candidate_xlsx(f, y, registry, maori, log) if cfg["format"] == "xlsx" else parse_candidate_csv(f, y, registry, maori, log)
                reconcile(ce, log)
                el.candidate_electorates.append(ce)
            if not cfiles:
                log.add(y, "candidates", "warning", f"No candidate-vote files matching {cglob} in data/{y}")
        el.preliminary = cfg.get("status") == "preliminary" or any(e.preliminary for e in el.electorates)
        numbers = [e.number for e in el.electorates]
        dupes = [n for n, c in Counter(numbers).items() if c > 1]
        if dupes:
            log.add(y, "duplicate_electorate", "error", f"Electorate numbers appear in more than one file: {dupes}")
        c = cfg.get("coordinates", {})
        if c.get("kind") == "csv":
            own_coords[y] = read_coordinate_csv(ydir / c["file"], y, c.get("crs", "EPSG:4326"), log)
        elif c.get("kind") == "places-json":
            recs, meta = read_places_json(ydir / c["file"], y, log)
            own_coords[y] = recs
            el.places_meta = meta
        else:
            own_coords[y] = []
            if c.get("note"):
                log.add(y, "coordinates", "warning", c["note"])
        elections[y] = el

    # Pass 2: match. Stages, in order:
    #   1. the election's own coordinate file (exact + fuzzy);
    #   2. configured fallback files (exact + fuzzy if the election has no
    #      coordinates of its own, otherwise exact + same-electorate fuzzy >= 0.92);
    #   3. every other election's file, nearest in time first (exact address only).
    # Any location taken from another election's file is flagged as inferred.
    indexes: dict[int, CoordIndex] = {fy: CoordIndex(recs, [fy]) for fy, recs in own_coords.items() if recs}
    for y, el in elections.items():
        primary = [fy for fy in el.config.get("coordinates_fallback", []) if fy in indexes and fy != y]
        others = sorted((fy for fy in indexes if fy != y and fy not in primary), key=lambda fy: (abs(fy - y), fy))
        has_own = bool(own_coords.get(y))
        stages: list[tuple[int, bool, bool, float]] = []  # (year, allow_fuzzy, local_only, local_threshold)
        if has_own:
            stages.append((y, True, False, 0.88))
        stages += [(fy, True, has_own, 0.88 if not has_own else 0.92) for fy in primary]
        stages += [(fy, False, False, 1.0) for fy in others]
        offsets: dict[int, int] = {}
        pool: list[CoordRecord] = []
        for fy, *_ in stages:
            offsets[fy] = len(pool)
            pool.extend(own_coords[fy])
        el.coords = pool
        el.own_coords = len(own_coords.get(y, []))
        venue_rows = [r for e in el.electorates for r in e.rows if r.kind == "venue"]
        methods: Counter[str] = Counter()
        for r in venue_rows:
            ci, method = None, "none"
            for fy, fuzzy_ok, local_only, thr in stages:
                ci_local, method, score = indexes[fy].match(r, log, allow_fuzzy=fuzzy_ok, local_only=local_only, local_threshold=thr)
                if ci_local is not None:
                    ci = offsets[fy] + ci_local
                    break
                if method == "ambiguous":
                    break
            if ci is not None:
                r.coord_index, r.match_method, r.match_score = ci, method, round(score, 3)
                if pool[ci].year != y:
                    r.match_method = f"{method}:inferred-from-{pool[ci].year}"
                methods[r.match_method] += 1
                continue
            r.kind = "nongeo"
            if method == "ambiguous":
                r.category = "unmatched"
                methods["ambiguous"] += 1
            elif r.looks_mobile:
                r.category = "mobile"
                methods["mobile"] += 1
            else:
                r.category = "unmatched"
                methods["unmatched"] += 1
                log.add(
                    y,
                    "unmatched_location",
                    "warning",
                    f"No coordinates for {r.label!r} ({r.electorate}, {r.section}); {r.total_valid} valid votes kept in electorate totals but not mapped",
                    at=r.source,
                    votes=r.total_valid,
                )
        inferred = [r for r in venue_rows if r.match_method and "inferred-from" in r.match_method]
        if inferred and has_own:
            log.add(y, "inferred_location", "info", f"{len(inferred)} venue rows located from another election's coordinate file by address match", examples=[f"{r.label} <- {pool[r.coord_index].source}" for r in inferred[:8]])  # type: ignore[index]
        fuzzy = [r for r in venue_rows if r.match_method and r.match_method.startswith("fuzzy")]
        for r in fuzzy:
            log.add(y, "fuzzy_match", "info", f"Fuzzy address match ({r.match_score}): {r.label!r} -> {pool[r.coord_index].address!r}", at=r.source)  # type: ignore[index]
        if el.candidate_electorates:
            override = load_affiliation_override(data_dir / str(y) / "candidate-parties.csv", log, y)
            join_candidates(y, el.electorates, el.candidate_electorates, registry, log, override)
            unknown = sum(1 for ce in el.candidate_electorates for c in ce.parties if not ce.party_of.get(c))  # type: ignore[attr-defined]
            if unknown:
                log.add(y, "candidate_affiliations", "warning", f"{unknown} candidates have no party affiliation in the source files; their votes are shown by name only and not attributed to a party", note=el.config.get("candidate_note"))
        el.sites = build_sites(y, [r for e in el.electorates for r in e.rows], pool, log)
        aggregate_candidates(el.sites, el.electorates)
        used = {r.coord_index for e in el.electorates for r in e.rows if r.coord_index is not None}
        unused_own = [c for i, c in enumerate(pool) if c.year == y and i not in used]
        if unused_own:
            log.add(y, "coordinates_without_results", "info", f"{len(unused_own)} coordinate records have no matching result row (e.g. venues that took no votes or are listed under different text)", examples=[c.address for c in unused_own[:8]])
        all_rows = [r for e in el.electorates for r in e.rows]
        mapped_votes = sum(r.total_valid for r in all_rows if r.kind == "venue")
        total_votes = sum(e.total_valid for e in el.electorates)
        cat_votes: Counter[str] = Counter()
        for r in all_rows:
            if r.kind == "nongeo":
                cat_votes[r.category or "?"] += r.total_valid
        el.stats = {
            "electorates": len(el.electorates),
            "result_rows": len(all_rows),
            "venue_rows": len(venue_rows),
            "match_methods": dict(methods),
            "coordinate_records": el.own_coords,
            "sites": len(el.sites),
            "valid_votes_total": total_votes,
            "valid_votes_mapped": mapped_votes,
            "valid_votes_by_nongeo_category": dict(cat_votes),
            "mapped_share": round(mapped_votes / total_votes, 4) if total_votes else 0,
            "candidate_votes_total": sum(ce.total_valid for ce in el.candidate_electorates),
            "candidate_votes_mapped": sum(s.cand_total_ed + s.cand_total_adv for s in el.sites),
        }
    return elections
