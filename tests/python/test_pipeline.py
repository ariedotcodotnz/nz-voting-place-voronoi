"""Tests for the data pipeline. Synthetic inputs are written to tmp files;
the final test validates the real generated assets if they exist."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest
import shapely
from shapely import STRtree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from pipeline import catchments as C  # noqa: E402
from pipeline.common import IssueLog, decode_bytes, norm_text, similarity  # noqa: E402
from pipeline.coords import CoordRecord, read_coordinate_csv  # noqa: E402
from pipeline.linking import classify, link_sites  # noqa: E402
from pipeline.match import CoordIndex  # noqa: E402
from pipeline.parties import PartyRegistry  # noqa: E402
from pipeline.results import classify_nongeo, parse_party_csv, reconcile  # noqa: E402
from pipeline.sites import Site, build_sites  # noqa: E402

E9 = """Party and Electorate Candidate Votes Recorded at each polling place
"Testtown 7","Party Vote Details"
,,"Labour Party","National Party","Green Party","Total Valid Party Votes","Informal Party Votes"
"Northville","Northville School, 1 Main Road",50,40,10,100,1
,"Northville Hall, 20 Hall Street",5,15,0,20,0
"Southville","Southville Church, 3 Church Road",30,30,0,60,2
,"Polling places where less than 6 votes were taken",1,1,0,2,0
,"Ordinary Votes BEFORE polling day",100,90,10,200,1
,"Special Votes On polling day",10,10,5,25,0
,"Testtown Total",196,186,25,407,4
"""

MODERN_MAORI = """Party and Electorate Candidate Votes Recorded at each Voting Place
Te Testa 66,Party Vote Details
,,Labour Party,National Party,Te Pāti Māori,Total Valid Party Votes,Informal Party Votes
Advance Voting Places
Northville,"Northville School, 1 Main Road",10,2,8,20,0
Voting Places
Testtown
Northville,"Northville School, 1 Main Road",4,1,5,10,0
,"Hospital & Rest Homes Team - Taken in Testtown",1,0,1,2,0
,Special Votes BEFORE Polling Day - Te Testa,3,1,2,6,0
,Te Testa Total,18,4,16,38,0
"""


@pytest.fixture()
def registry() -> PartyRegistry:
    return PartyRegistry()


def write(tmp_path: Path, name: str, text: str, encoding: str = "utf-8-sig") -> Path:
    p = tmp_path / name
    p.write_bytes(text.encode(encoding))
    return p


# ---------------------------------------------------------------- parsing


def test_e9_parsing_and_reconciliation(tmp_path, registry):
    log = IssueLog()
    er = parse_party_csv(write(tmp_path, "e9_part8_party_7.csv", E9), 2008, registry, set(), log)
    assert (er.name, er.number, er.kind) == ("Testtown", 7, "general")
    assert er.parties == ["labour", "national", "green"]
    venues = [r for r in er.rows if r.kind == "venue"]
    assert [r.suburb for r in venues] == ["Northville", "Northville", "Southville"]  # suburb carried forward
    cats = sorted(r.category for r in er.rows if r.kind == "nongeo")
    assert cats == ["advance_aggregate", "small_places", "special_on"]
    assert er.totals == {"labour": 196, "national": 186, "green": 25}
    reconcile(er, log)
    assert not [i for i in log.issues if i.category == "electorate_total_mismatch"]


def test_reconcile_detects_inconsistent_totals(tmp_path, registry):
    log = IssueLog()
    bad = E9.replace(",\"Testtown Total\",196,186,25,407,4", ",\"Testtown Total\",197,186,25,408,4")
    er = parse_party_csv(write(tmp_path, "e9.csv", bad), 2008, registry, set(), log)
    reconcile(er, log)
    assert any(i.category == "electorate_total_mismatch" and i.detail.get("party") == "labour" for i in log.issues)


def test_modern_maori_file_sections_and_subheadings(tmp_path, registry):
    log = IssueLog()
    er = parse_party_csv(write(tmp_path, "party-votes-by-voting-place-66.csv", MODERN_MAORI), 2023, registry, {"Te Testa"}, log)
    assert er.kind == "maori"
    assert "tpm" in er.parties  # macronised alias resolved
    venue = [r for r in er.rows if r.kind == "venue"]
    assert [r.section for r in venue[:2]] == ["advance", "election_day"]
    assert venue[1].subheading == "Testtown"
    team = [r for r in er.rows if "Team" in r.label][0]
    assert team.looks_mobile
    reconcile(er, log)
    assert not [i for i in log.issues if i.category == "electorate_total_mismatch"]


def test_numeric_errors_and_negative_votes_are_reported(tmp_path, registry):
    log = IssueLog()
    text = E9.replace('"Northville Hall, 20 Hall Street",5,15,0,20,0', '"Northville Hall, 20 Hall Street",5,abc,0,20,0').replace("30,30,0,60,2", "30,-3,0,60,2")
    er = parse_party_csv(write(tmp_path, "e9.csv", text), 2008, registry, set(), log)
    cats = {i.category for i in log.issues}
    assert "numeric_type" in cats and "negative_votes" in cats
    assert not any(r.label.startswith("Northville Hall") for r in er.rows)  # unparseable row reported, not silently kept


def test_unknown_party_gets_generated_id(tmp_path, registry):
    log = IssueLog()
    text = E9.replace('"Green Party"', '"Brand New Party"')
    er = parse_party_csv(write(tmp_path, "e9.csv", text), 2008, registry, set(), log)
    assert "x_brandnewparty" in er.parties
    assert any(i.category == "unclassified_party" for i in log.issues)
    assert not registry.parties["x_brandnewparty"].classified


@pytest.mark.parametrize(
    "label,cat",
    [
        ("Special Votes BEFORE Polling Day - Auckland Central", "special_before"),
        ("Overseas Special Votes Including Defence Force - X", "overseas"),
        ("Overseas Special Votes for Party Only - X", "overseas_party_only"),
        ("Votes Allowed for Party Only", "party_only"),
        ("Ordinary Votes BEFORE polling day - Taken in Epsom", "advance_aggregate"),
        ("Voting places where less than 6 votes were taken", "small_places"),
        ("Postal Votes Received", "postal"),
        ("Northville School, 1 Main Road", None),
    ],
)
def test_nongeo_classification(label, cat):
    assert classify_nongeo(label) == cat


def test_decoding_detects_utf16_and_cp1252():
    assert decode_bytes("Māori".encode("utf-16"))[1] == "utf-16"
    assert decode_bytes("caf\xe9".encode("cp1252")) == ("café", "cp1252")
    assert decode_bytes("﻿Māori".encode("utf-8")) == ("Māori", "utf-8")


# ---------------------------------------------------------------- coordinates


def test_coordinate_validation(tmp_path):
    log = IssueLog()
    csv = (
        "Electorate Number #,Electorate Name,Type,Voting Place Suburb,Voting Place Address,WSG84 Latitude,WSG84 Longitude,NZTM Northing,NZTM Easting\n"
        '1,Testtown,Election Day,Northville,"Northville School, 1 Main Road",-41.2865,174.7762,5427000,1749000\n'
        '1,Testtown,Election Day,Nowhere,"Somewhere, 1 Road",51.5,-0.12,,\n'
        '1,Testtown,Advance,Chathams,"Council Building, Tuku Road",-43.9523,-176.5609,0,0\n'
        '1,Testtown,Election Day,Blank,"No coords",,,,\n'
    )
    recs = read_coordinate_csv(write(tmp_path, "coords.csv", csv, "utf-8"), 2017, "EPSG:4326", log)
    assert [r.suburb for r in recs] == ["Northville", "Chathams"]
    assert recs[1].type == "advance" and recs[1].lng < -176  # Chathams across 180° kept
    assert sum(1 for i in log.issues if i.category == "invalid_coordinates") == 2
    assert any(i.category == "coordinate_inconsistency" for i in log.issues)  # NZTM 0,0 disagrees


def test_nzmg_conversion_is_accurate(tmp_path):
    log = IssueLog()
    csv = 'Electorate Number #,Electorate Name,Polling Place ID,Polling Place Suburb,Polling Place Address,NZMG Easting,NZMG Northing\n1,Auckland Central,98,Auckland City,"Auckland High Court",2668377,6482102\n'
    (r,) = read_coordinate_csv(write(tmp_path, "c.csv", csv), 2008, "EPSG:27200", log)
    # Same venue in the 2014 file (NZTM2000): 1757941.612 E, 5920405.712 N
    assert math.hypot(r.x - 1757941.612, r.y - 5920405.712) < 5


# ---------------------------------------------------------------- matching


def rec(addr, suburb="Northville", elec="Testtown", x=1_750_000.0, y=5_430_000.0, typ="election_day", year=2023):
    return CoordRecord(year, 1, elec, typ, suburb, addr, f"{suburb}, {addr}", None, -41.0, 174.0, x, y, "test")


def row_for(address, suburb="Northville", electorate="Testtown", section="election_day", label=None):
    from pipeline.results import ResultRow

    return ResultRow(2023, 1, electorate, section, suburb, address, label or address, None, {}, 0, 0, "test")


def test_similarity_respects_street_numbers():
    assert similarity(norm_text("10 Main St"), norm_text("10 Main Street")) == 1.0
    assert similarity(norm_text("School, 10 Main Street"), norm_text("School, 100 Main Street")) < 0.7


def test_exact_and_fuzzy_matching():
    idx = CoordIndex([rec("Northville School Hall, 1 Main Road"), rec("Southville Church, 3 Church Road", suburb="Southville", x=1_760_000)], [2023])
    log = IssueLog()
    assert idx.match(row_for("Northville School Hall, 1 Main Rd"), log)[1] == "exact"  # abbreviation normalised
    ci, method, score = idx.match(row_for("Northville School, 1 Main Road"), log)
    assert ci == 0 and method == "fuzzy" and score >= 0.88


def test_ambiguous_join_is_not_guessed():
    idx = CoordIndex([rec("Community Hall, 1 Main Road", elec="A", x=1_750_000), rec("Community Hall, 1 Main Road", elec="B", x=1_790_000)], [2023])
    log = IssueLog()
    ci, method, _ = idx.match(row_for("Community Hall, 1 Main Road", electorate="C"), log)
    assert ci is None and method == "ambiguous"
    assert any(i.category == "ambiguous_join" for i in log.issues)
    # Electorate evidence resolves it
    assert idx.match(row_for("Community Hall, 1 Main Road", electorate="B"), log)[0] == 1


def test_mobile_rows_never_fuzzy_match():
    idx = CoordIndex([rec("Hospital, 1 Main Road")], [2023])
    r = row_for("Hospital Team 1", label="Hospital Team 1")
    r.looks_mobile = True
    assert idx.match(r, IssueLog())[0] is None


# ---------------------------------------------------------------- sites & linking


def test_duplicate_venues_merge_but_neighbours_do_not():
    records = [
        rec("Northville School, 1 Main Road", typ="advance", x=1_750_000, y=5_430_000),
        rec("Northville School, 1 Main Road", typ="election_day", x=1_750_005, y=5_430_000),
        rec("Fire Station, 9 Other Road", x=1_750_050, y=5_430_000),
    ]
    rows = []
    for k, (r, sec) in enumerate(zip(records, ["advance", "election_day", "election_day"])):
        row = row_for(r.address, section=sec)
        row.coord_index, row.votes, row.total_valid, row.match_method = k, {"labour": 10 + k}, 10 + k, "exact"
        rows.append(row)
    sites = build_sites(2023, rows, records, IssueLog())
    assert len(sites) == 2
    merged = next(s for s in sites if len(s.coord_records) == 2)
    assert merged.types == {"advance", "election_day"}
    assert merged.total_adv == 10 and merged.total_ed == 11


def mksite(year, idx, x, y, name):
    return Site(year, idx, x, y, -41.0, 174.0, name, name, "", None, None)


def test_link_confidence_classes():
    assert classify(10, 0.9) == "exact"
    assert classify(10, 0.1) == "high"
    assert classify(80, 0.5) == "probable"
    assert classify(250, 0.5) is None


def test_linking_never_merges_two_sites_of_one_election():
    s2020 = [mksite(2020, 0, 0, 0, "Northville School")]
    s2023 = [mksite(2023, 0, 5, 0, "Northville School"), mksite(2023, 1, 20, 0, "Northville School Hall")]
    stable = link_sites({2020: s2020, 2023: s2023}, IssueLog())
    assert len(stable) == 2
    linked = [s for s in stable.values() if len(s["years"]) == 2][0]
    assert linked["years"] == {"2020": 0, "2023": 0}
    assert linked["confidence"]["2020-2023"] == "exact"


# ---------------------------------------------------------------- catchments


def synthetic_geography() -> C.Geography:
    """A 10 km × 10 km 'mainland' with a lake, plus a small island, and a
    1 km meshblock grid over both (all in metres)."""
    main = shapely.difference(shapely.box(0, 0, 10_000, 10_000), shapely.box(6_000, 6_000, 7_000, 7_000))
    island = shapely.box(12_000, 0, 12_500, 500)
    pieces = np.array([main, island], dtype=object)
    grid = [shapely.box(x, y, x + 1_000, y + 1_000) for x in range(0, 10_000, 1_000) for y in range(0, 10_000, 1_000)]
    mbs = shapely.intersection(np.array(grid, dtype=object), main)
    mbs = np.concatenate([mbs[~shapely.is_empty(mbs)], [island]])
    return C.Geography(
        land_pieces=pieces,
        land_tree=STRtree(pieces),
        land_area=float(shapely.area(pieces).sum()),
        mb_codes=np.arange(len(mbs)),
        mb_geoms=mbs,
        mb_rep=shapely.get_coordinates(shapely.point_on_surface(mbs)),
        mb_tree=STRtree(mbs),
        mb_area=float(shapely.area(mbs).sum()),
        excluded_islands=[],
    )


def test_voronoi_catchments_tile_the_land_exactly():
    geo = synthetic_geography()
    xy = np.array([[1_000, 1_000], [8_000, 2_000], [5_000, 9_000], [2_500, 5_000]], dtype=float)
    cells = C.voronoi_catchments(xy, geo)
    chk = C.coverage_checks(cells, geo.land_area)
    assert chk["invalid_polygons"] == 0
    assert abs(chk["overlap_km2"]) < 1e-6 and abs(chk["gap_km2"]) < 1e-6
    # Every cell contains its own polling place and nothing extends past the land
    assert all(shapely.contains(cells[i], shapely.Point(*xy[i])) for i in range(len(xy)))
    assert shapely.within(shapely.union_all(cells), shapely.union_all(geo.land_pieces).buffer(1e-6))
    # The lake is a hole, and the offshore island belongs to its nearest site
    assert not shapely.intersects(shapely.union_all(cells), shapely.box(6_100, 6_100, 6_900, 6_900))
    assert shapely.intersects(cells[1], shapely.box(12_000, 0, 12_500, 500))


def test_single_sparse_site_gets_all_land():
    geo = synthetic_geography()
    cells = C.voronoi_catchments(np.array([[5_000.0, 5_000.0]]), geo)
    assert math.isclose(shapely.area(cells[0]), geo.land_area, rel_tol=1e-9)


def test_meshblock_catchments_give_every_site_an_area():
    geo = synthetic_geography()
    # Two sites inside the same meshblock: one would otherwise get nothing.
    xy = np.array([[200.0, 200.0], [700.0, 700.0], [9_000.0, 9_000.0]])
    log = IssueLog()
    cats, _, n_split = C.meshblock_catchments(xy, geo, 2023, log)
    assert n_split >= 1
    assert all(shapely.area(c) > 0 for c in cats)
    cats = np.asarray(shapely.coverage_clean(cats))
    chk = C.coverage_checks(cats, geo.mb_area)
    assert abs(chk["overlap_km2"]) < 1e-6 and abs(chk["gap_km2"]) < 1e-6


def test_exclave_cleanup_merges_small_fragments_only():
    left = shapely.union(shapely.box(0, 0, 1_000, 1_000), shapely.box(1_500, 0, 1_600, 100))  # tiny fragment inside right's area
    right = shapely.difference(shapely.box(1_000, 0, 3_000, 1_000), shapely.box(1_500, 0, 1_600, 100))
    out, moved, area = C.remove_exclaves(np.array([left, right], dtype=object), np.array([[500.0, 500.0], [2_500.0, 500.0]]))
    assert moved == 1 and math.isclose(area, 10_000)
    assert shapely.get_num_geometries(out[0]) == 1
    assert math.isclose(shapely.area(out[1]), 2_000_000)


def test_simplification_preserves_shared_edges():
    geo = synthetic_geography()
    xy = np.array([[1_000, 1_000], [8_000, 2_000], [5_000, 9_000], [2_500, 5_000]], dtype=float)
    cells = C.voronoi_catchments(xy, geo)
    simp = C.simplify_coverage(cells, 200.0)
    assert shapely.is_valid(simp).all()
    assert shapely.coverage_is_valid(simp, gap_width=0.0)


# ---------------------------------------------------------------- outputs


@pytest.mark.skipif(not (ROOT / "public" / "data" / "manifest.json").exists(), reason="pipeline outputs not built")
def test_generated_assets_validate():
    from pipeline.validate import validate_outputs

    assert validate_outputs() == []


# ---------------------------------------------------------------- labels


def test_labels_merge_spelling_variants_but_not_distant_namesakes():
    from pipeline.labels import build_labels

    def payload(rows):
        return {"sites": {"suburb": [r[0] for r in rows], "lat": [r[1] for r in rows], "lng": [r[2] for r in rows]}}

    results = {
        2014: payload([("Whangarei Heads", -35.80, 174.50), ("Riverside", -35.72, 174.33), ("Taken in Epsom", -36.88, 174.77), ("Wanganui East", -39.92, 175.06)]),
        2023: payload([("Whangārei Heads", -35.801, 174.501), ("Riverside", -43.53, 172.60), ("Harbour View", -41.21, 174.90), ("Whanganui East", -39.921, 175.061)]),
        2026: payload([("Harbourview", -41.211, 174.901)]),
    }
    rows = [r for r in build_labels(results) if r[3] == "locality"]
    names = sorted(r[0] for r in rows)
    assert "Whangārei Heads" in names and "Whangarei Heads" not in names  # macronised spelling preferred
    assert names.count("Riverside") == 2  # same name in two towns stays separate
    assert not any(n.startswith("Taken in") for n in names)
    assert sum(1 for n in names if n.replace(" ", "").lower() == "harbourview") == 1
    assert sum(1 for n in names if n.endswith("anui East")) == 1  # historical spelling alias
