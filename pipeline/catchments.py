"""Estimated polling-place catchments.

Two methods are generated for every election, all in NZTM2000 (EPSG:2193):

``voronoi``
    Voronoi cells of the election's sites, clipped to the LINZ 1:50k
    coastline polygons with Stats NZ inland-water meshblocks (lakes) removed.
    Cells are bounded by a large envelope before clipping, so no cell is
    unbounded and no rectangular edge survives the clip.

``meshblock``
    Each Stats NZ 2026 land meshblock (mainland + island) is assigned whole to
    the site nearest its representative point, then meshblocks are dissolved
    per site. Boundaries therefore follow roads, rivers and property lines and
    lakes/inlets stay as water. A site that would receive no meshblock (two
    venues inside one large meshblock) gets a share of the meshblock it sits
    in, split by a local Voronoi among the competing sites.

Remote islands further than ``REMOTE_M`` from every polling place in every
election (Kermadecs, sub-Antarctic islands, etc.) are excluded and listed in
the report.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import shapely
from shapely import STRtree

from .common import BUILD_DIR, CRS_METRIC, DATA_DIR, IssueLog

COAST_PATH = DATA_DIR / "geographic" / "lds-nz-coastlines-and-islands-polygons-topo-150k-GPKG" / "nz-coastlines-and-islands-polygons-topo-150k.gpkg"
MESHBLOCK_PATH = DATA_DIR / "geographic" / "statsnz-meshblock-2026-GPKG" / "meshblock-2026.gpkg"

REMOTE_M = 150_000.0
TILE_M = 20_000.0
LAND_PRESIMPLIFY_M = 4.0
MESHBLOCK_PRESIMPLIFY_M = 3.0
LAND_CLASSES = {"Mainland", "Island"}
FRAGMENT_ABS_M2 = 2_000_000.0
FRAGMENT_FRAC = 0.5


def _log_time(msg: str, t0: float) -> None:
    print(f"    {msg} ({time.time() - t0:.1f}s)", flush=True)


@dataclass
class Geography:
    land_pieces: np.ndarray  # tiled land polygons (Voronoi clip mask)
    land_tree: STRtree
    land_area: float
    mb_codes: np.ndarray
    mb_geoms: np.ndarray
    mb_rep: np.ndarray  # (N, 2) representative points
    mb_tree: STRtree
    mb_area: float
    excluded_islands: list[dict]


def _nearest_distance(tree: STRtree, geoms: np.ndarray) -> np.ndarray:
    """Distance from each geometry to the nearest geometry in ``tree``."""
    idx, dist = tree.query_nearest(geoms, return_distance=True, all_matches=False)
    out = np.full(len(geoms), np.inf)
    out[idx[0]] = dist
    return out


def load_geography(all_site_xy: np.ndarray, log: IssueLog) -> Geography:
    """Load and prepare land mask + meshblocks (cached under build/)."""
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    site_pts = shapely.points(all_site_xy)
    site_tree = STRtree(site_pts)

    # ---- Meshblocks ------------------------------------------------------
    mb_cache = BUILD_DIR / "meshblocks-land.parquet"
    if mb_cache.exists() and mb_cache.stat().st_mtime > MESHBLOCK_PATH.stat().st_mtime:
        mb = gpd.read_parquet(mb_cache)
    else:
        mb_all = gpd.read_file(MESHBLOCK_PATH, columns=["MB2026_V1_00", "LANDWATER_NAME"])
        mb_all = mb_all[~mb_all.geometry.is_empty & mb_all.geometry.notna()].to_crs(CRS_METRIC)
        n_null = 57575 - len(mb_all)
        if n_null:
            log.add(None, "meshblocks", "info", f"{n_null} meshblocks have empty/null geometry in the source (non-digitised) and are skipped")
        geoms = shapely.make_valid(mb_all.geometry.values)
        geoms = shapely.coverage_simplify(geoms, MESHBLOCK_PRESIMPLIFY_M, simplify_boundary=True)
        mb_all = gpd.GeoDataFrame(mb_all.drop(columns="geometry"), geometry=geoms, crs=CRS_METRIC)
        mb_all.to_parquet(BUILD_DIR / "meshblocks-all.parquet")
        mb = mb_all[mb_all["LANDWATER_NAME"].isin(LAND_CLASSES)].reset_index(drop=True)
        mb.to_parquet(mb_cache)
        _log_time(f"meshblocks loaded and coverage-simplified ({len(mb)} land)", t0)
    lakes_cache = BUILD_DIR / "meshblocks-all.parquet"
    mb_all = gpd.read_parquet(lakes_cache)
    lakes = shapely.union_all(mb_all[mb_all["LANDWATER_NAME"] == "Inland Water"].geometry.values)

    geoms = mb.geometry.values
    # Exclude remote islands (meshblocks classed 'Island' far from every site).
    dist_full = _nearest_distance(site_tree, geoms)
    remote = (mb["LANDWATER_NAME"].values == "Island") & (dist_full > REMOTE_M)
    if remote.any():
        log.add(None, "remote_islands", "info", f"{int(remote.sum())} island meshblocks more than {REMOTE_M / 1000:.0f} km from any polling place excluded from the meshblock catchments", area_km2=round(float(shapely.area(geoms[remote]).sum() / 1e6), 1))
    mb = mb[~remote].reset_index(drop=True)
    mb_geoms = mb.geometry.values
    rep = shapely.get_coordinates(shapely.point_on_surface(mb_geoms))

    # ---- Coastline land mask --------------------------------------------
    coast = gpd.read_file(COAST_PATH, columns=["name", "grp_name"]).to_crs(CRS_METRIC)
    coast = coast.explode(index_parts=False, ignore_index=True)
    cgeoms = shapely.make_valid(coast.geometry.values)
    cdist = _nearest_distance(site_tree, cgeoms)
    keep = cdist <= REMOTE_M
    excluded = []
    ex = coast[~keep]
    if len(ex):
        grp = ex.assign(area=shapely.area(cgeoms[~keep]) / 1e6).fillna({"grp_name": "", "name": ""})
        for key, g in grp.groupby(grp["grp_name"].where(grp["grp_name"] != "", grp["name"])):
            excluded.append({"name": key or "(unnamed)", "polygons": int(len(g)), "area_km2": round(float(g["area"].sum()), 2)})
        excluded.sort(key=lambda e: -e["area_km2"])
        log.add(None, "remote_islands", "info", f"{int((~keep).sum())} coastline polygons (remote islands) more than {REMOTE_M / 1000:.0f} km from any polling place excluded from catchments", groups=excluded[:15])
    land = shapely.simplify(cgeoms[keep], LAND_PRESIMPLIFY_M, preserve_topology=True)
    # Remove lakes
    lake_parts = shapely.get_parts(lakes)
    ltree = STRtree(lake_parts)
    li, lj = ltree.query(land, predicate="intersects")
    if len(li):
        for i in np.unique(li):
            land[i] = shapely.difference(land[i], shapely.union_all(lake_parts[lj[li == i]]))
    land = shapely.get_parts(land)
    land = land[~shapely.is_empty(land)]
    land_area = float(shapely.area(land).sum())
    # Tile big polygons so per-cell clipping is cheap.
    minx, miny, maxx, maxy = shapely.total_bounds(land)
    xs = np.arange(minx, maxx + TILE_M, TILE_M)
    ys = np.arange(miny, maxy + TILE_M, TILE_M)
    tiles = np.array([shapely.box(x, y, x + TILE_M, y + TILE_M) for x in xs for y in ys])
    ttree = STRtree(tiles)
    pieces = []
    for poly in land:
        if shapely.get_num_coordinates(poly) < 2000:
            pieces.append(poly)
            continue
        ti = ttree.query(poly, predicate="intersects")
        parts = shapely.intersection(poly, tiles[ti])
        pieces.extend(shapely.get_parts(parts[~shapely.is_empty(parts)]))
    pieces = np.array([p for p in pieces if shapely.get_type_id(p) in (3, 6) and shapely.area(p) > 0])
    _log_time(f"land mask ready: {len(land)} polygons -> {len(pieces)} tiles, {land_area / 1e6:,.0f} km2", t0)
    return Geography(
        land_pieces=pieces,
        land_tree=STRtree(pieces),
        land_area=land_area,
        mb_codes=mb["MB2026_V1_00"].values,
        mb_geoms=mb_geoms,
        mb_rep=rep,
        mb_tree=STRtree(mb_geoms),
        mb_area=float(shapely.area(mb_geoms).sum()),
        excluded_islands=excluded,
    )


def _group_union(geoms: np.ndarray, owners: np.ndarray, n: int, coverage: bool = False, exact_mask: np.ndarray | None = None) -> np.ndarray:
    """Union geometries per owner. ``coverage`` uses the fast GEOS coverage
    union for groups whose members share exact edges; groups containing any
    member flagged False in ``exact_mask`` fall back to a full overlay union."""
    out = np.empty(n, dtype=object)
    out[:] = None
    order = np.argsort(owners, kind="stable")
    owners_s = owners[order]
    bounds = np.flatnonzero(np.diff(owners_s)) + 1
    starts = np.concatenate([[0], bounds])
    ends = np.concatenate([bounds, [len(owners_s)]])
    for s, e in zip(starts, ends):
        g = geoms[order[s:e]]
        if len(g) == 1:
            out[owners_s[s]] = g[0]
        elif coverage and (exact_mask is None or bool(exact_mask[order[s:e]].all())):
            try:
                out[owners_s[s]] = shapely.coverage_union_all(g)
            except shapely.errors.GEOSException:
                out[owners_s[s]] = shapely.union_all(g)
        else:
            out[owners_s[s]] = shapely.union_all(g)
    for i in range(n):
        if out[i] is None:
            out[i] = shapely.Polygon()
    return out


def voronoi_catchments(xy: np.ndarray, geo: Geography) -> np.ndarray:
    pts = shapely.points(xy)
    minx, miny = xy.min(axis=0)
    maxx, maxy = xy.max(axis=0)
    env = shapely.box(minx - 2e6, miny - 2e6, maxx + 2e6, maxy + 2e6)
    vor = shapely.voronoi_polygons(shapely.multipoints(pts), extend_to=env, ordered=True)
    cells = np.asarray(shapely.get_parts(vor))
    if len(cells) != len(xy) or not shapely.contains(cells, pts).all():
        # Fall back to a spatial join if GEOS ordering is not available.
        tree = STRtree(cells)
        pi, ci = tree.query(pts, predicate="within")
        ordered = np.empty(len(xy), dtype=object)
        ordered[pi] = cells[ci]
        cells = ordered
    ci, pj = geo.land_tree.query(cells, predicate="intersects")
    inter = shapely.intersection(cells[ci], geo.land_pieces[pj])
    keep = ~shapely.is_empty(inter)
    inter = shapely.get_parts(inter[keep], return_index=True)
    polys, idx = inter
    owners = ci[keep][idx]
    is_poly = shapely.get_type_id(polys) == 3
    return _group_union(polys[is_poly], owners[is_poly], len(xy))


def meshblock_catchments(xy: np.ndarray, geo: Geography, year: int, log: IssueLog) -> tuple[np.ndarray, np.ndarray, int]:
    from scipy.spatial import cKDTree

    n = len(xy)
    tree = cKDTree(xy)
    _, owner = tree.query(geo.mb_rep)
    owner = owner.astype(np.int64)
    geoms = geo.mb_geoms.copy()
    pts = shapely.points(xy)
    si, mi = geo.mb_tree.query(pts, predicate="within")
    site_mb = dict(zip(si.tolist(), mi.tolist()))
    # Meshblocks split between several sites: meshblock -> participating sites.
    split: dict[int, set[int]] = {}
    pieces: dict[int, list[tuple[int, object]]] = {}

    def split_meshblock(m: int, participants: list[int]) -> None:
        mgeom = geo.mb_geoms[m]
        local = shapely.voronoi_polygons(shapely.multipoints(pts[participants]), extend_to=shapely.envelope(mgeom).buffer(1000), ordered=True)
        cells = np.asarray(shapely.get_parts(local))
        if len(cells) != len(participants) or not shapely.contains(cells, pts[participants]).all():
            ctree = STRtree(cells)
            pi, cj = ctree.query(pts[participants], predicate="within")
            ordered = np.empty(len(participants), dtype=object)
            ordered[pi] = cells[cj]
            cells = ordered
        pieces[m] = [(s, shapely.intersection(mgeom, c)) for s, c in zip(participants, cells) if c is not None]
        pieces[m] = [(s, g) for s, g in pieces[m] if not shapely.is_empty(g)]

    for _ in range(4):
        has_area = np.zeros(n, dtype=bool)
        has_area[owner[owner >= 0]] = True
        for plist in pieces.values():
            for s, _g in plist:
                has_area[s] = True
        orphans = np.flatnonzero(~has_area).tolist()
        if not orphans:
            break
        by_mb: dict[int, set[int]] = defaultdict(set)
        for s in orphans:
            m = site_mb.get(s)
            if m is None:  # site not inside any land meshblock (e.g. on a wharf)
                m = int(geo.mb_tree.query_nearest(pts[s], all_matches=False)[0])
            by_mb[m].add(s)
        for m, new_sites in by_mb.items():
            participants = split.get(m, {int(owner[m])}) | new_sites
            split[m] = participants
            owner[m] = -1
            split_meshblock(m, sorted(participants))
    if split:
        log.add(year, "meshblock_split", "info", f"{len(split)} meshblocks shared between several polling places were split by a local Voronoi so every site has a catchment")
    keep = owner >= 0
    extra = [(s, g) for plist in pieces.values() for s, g in plist]
    all_geoms = np.concatenate([geoms[keep], np.array([g for _, g in extra], dtype=object)]) if extra else geoms[keep]
    all_owner = np.concatenate([owner[keep], np.array([s for s, _ in extra], dtype=np.int64)]) if extra else owner[keep]
    exact = np.concatenate([np.ones(int(keep.sum()), dtype=bool), np.zeros(len(extra), dtype=bool)])
    out = _group_union(np.asarray(all_geoms, dtype=object), all_owner, n, coverage=True, exact_mask=exact)
    return out, owner, len(split)


def remove_exclaves(geoms: np.ndarray, xy: np.ndarray, max_rounds: int = 4) -> tuple[np.ndarray, int, float]:
    """Merge disconnected fragments of a catchment into a neighbour.

    Nearest-site assignment of whole meshblocks occasionally gives a polling
    place a fragment that is cut off from its main catchment by a neighbour's
    territory. Each such fragment (a part that does not contain the polling
    place, is not its largest part, is no larger than max(2 km², half the main
    part) and shares a border with another catchment) is reassigned to the catchment it shares the longest border
    with. Fragments touching no other catchment (offshore islands) are kept.
    Returns (geoms, fragments_moved, area_moved_m2)."""
    pts = shapely.points(xy)
    moved_total, area_total = 0, 0.0
    for _ in range(max_rounds):
        parts, owner = shapely.get_parts(geoms, return_index=True)
        n_parts = len(parts)
        main = np.zeros(n_parts, dtype=bool)
        contains = shapely.contains(parts, pts[owner]) | shapely.touches(parts, pts[owner])
        areas = shapely.area(parts)
        for s in np.unique(owner):
            idx = np.flatnonzero(owner == s)
            hit = idx[contains[idx]]
            main[hit[0] if len(hit) else idx[np.argmax(areas[idx])]] = True
        main_area = np.zeros(len(geoms))
        main_area[owner[main]] = areas[main]
        # Only small fragments are treated as assignment artefacts. Large
        # disconnected parts are usually real geography cut off by water (land
        # across a lake or a sounds peninsula) and stay with their site.
        small = areas <= np.maximum(FRAGMENT_ABS_M2, FRAGMENT_FRAC * main_area[owner])
        cand = np.flatnonzero(~main & small)
        if len(cand) == 0:
            break
        tree = STRtree(parts)
        new_owner = owner.copy()
        moved = 0
        for p in cand:
            nb = tree.query(parts[p], predicate="intersects")
            nb = nb[(nb != p) & (owner[nb] != owner[p])]
            if len(nb) == 0:
                continue
            shared = shapely.length(shapely.intersection(shapely.boundary(parts[p]), shapely.boundary(parts[nb])))
            if shared.max() <= 0:
                continue
            new_owner[p] = owner[nb[np.argmax(shared)]]
            moved += 1
            area_total += float(areas[p])
        if moved == 0:
            break
        moved_total += moved
        geoms = _group_union(parts, new_owner, len(geoms), coverage=True)
    return geoms, moved_total, area_total


def coverage_checks(geoms: np.ndarray, reference_area: float) -> dict[str, float]:
    """Return area accounting for a set of catchments that should tile the land."""
    valid = shapely.is_valid(geoms)
    areas = shapely.area(geoms)
    total = float(areas.sum())
    union = shapely.coverage_union_all(geoms) if bool(valid.all()) else shapely.union_all(geoms)
    union_area = float(shapely.area(union))
    try:
        cov_valid = bool(shapely.coverage_is_valid(geoms, gap_width=0.0))
    except Exception:  # pragma: no cover - GEOS edge cases
        cov_valid = False
    return {
        "invalid_polygons": int((~valid).sum()),
        "empty_polygons": int(shapely.is_empty(geoms).sum()),
        "sum_area_km2": round(total / 1e6, 3),
        "union_area_km2": round(union_area / 1e6, 3),
        "overlap_km2": round((total - union_area) / 1e6, 4),
        "reference_area_km2": round(reference_area / 1e6, 3),
        "gap_km2": round((reference_area - union_area) / 1e6, 4),
        "coverage_valid": cov_valid,
    }


def simplify_coverage(geoms: np.ndarray, tolerance: float, min_part_area: float = 0.0) -> np.ndarray:
    """Topology-preserving simplification (shared edges stay shared)."""
    g = shapely.make_valid(geoms)
    g = np.array([x if shapely.get_type_id(x) in (3, 6) else shapely.union_all([p for p in shapely.get_parts(x) if shapely.get_type_id(p) in (3, 6)]) for x in g], dtype=object)
    out = shapely.coverage_simplify(g, tolerance, simplify_boundary=True)
    if min_part_area > 0:
        cleaned = []
        for geom in out:
            parts = shapely.get_parts(geom)
            if len(parts) > 1:
                areas = shapely.area(parts)
                big = parts[(areas >= min_part_area) | (areas == areas.max())]
                geom = shapely.multipolygons(big) if len(big) > 1 else big[0]
            cleaned.append(geom)
        out = np.array(cleaned, dtype=object)
    return out
