"""Write browser assets.

Geometry is written in a compact JSON encoding (version 1):

    {"v": 1, "scale": 100000, "features": [[siteIndex, [polygon, ...]], ...]}

where each polygon is a list of rings and each ring is a flat integer array
``[x0, y0, dx1, dy1, dx2, dy2, ...]`` of WGS84 longitude/latitude multiplied by
``scale`` (≈1 m precision), delta-encoded after the first vertex. The web app
decodes this into GeoJSON-style coordinates. This is several times smaller and
faster to parse than GeoJSON while remaining plain, inspectable JSON.

Asset file names carry a content hash so they can be cached immutably; only
``manifest.json`` must be revalidated.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import shapely
from pyproj import Transformer

SCALE = 100_000
_T = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)


def to_wgs84(geoms: np.ndarray) -> np.ndarray:
    return shapely.transform(geoms, lambda xy: np.column_stack(_T.transform(xy[:, 0], xy[:, 1])))


def _ring(coords: np.ndarray) -> list[int]:
    q = np.round(coords[:, :2] * SCALE).astype(np.int64)
    # drop consecutive duplicates created by quantisation (keep closing vertex)
    keep = np.ones(len(q), dtype=bool)
    keep[1:] = np.any(q[1:] != q[:-1], axis=1)
    q = q[keep]
    if len(q) < 4:
        return []
    d = np.vstack([q[:1], np.diff(q, axis=0)])
    return d.ravel().tolist()


def encode_geometry(geom: Any) -> list[list[list[int]]]:
    polys = []
    for poly in shapely.get_parts(geom):
        if shapely.get_type_id(poly) != 3 or poly.is_empty:
            continue
        rings = [_ring(np.asarray(poly.exterior.coords))]
        if not rings[0]:
            continue
        for interior in poly.interiors:
            r = _ring(np.asarray(interior.coords))
            if r:
                rings.append(r)
        polys.append(rings)
    return polys


def encode_features(ids: list[int], geoms_wgs: np.ndarray) -> list[list[Any]]:
    out = []
    for i, g in zip(ids, geoms_wgs):
        enc = encode_geometry(g)
        if enc:
            out.append([int(i), enc])
    return out


def dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


class AssetWriter:
    def __init__(self, out_dir: Path) -> None:
        self.out_dir = out_dir
        self.bytes_written: dict[str, int] = {}

    def reset(self) -> None:
        if self.out_dir.exists():
            shutil.rmtree(self.out_dir)
        self.out_dir.mkdir(parents=True)

    def write(self, rel_stem: str, obj: Any, hashed: bool = True) -> str:
        text = dumps(obj)
        if hashed:
            h = hashlib.sha256(text.encode()).hexdigest()[:10]
            rel = f"{rel_stem}.{h}.json"
        else:
            rel = f"{rel_stem}.json"
        path = self.out_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        self.bytes_written[rel] = len(text.encode())
        return rel


def bbox_wgs(geoms_wgs: np.ndarray) -> list[float]:
    b = shapely.total_bounds(geoms_wgs)
    return [round(float(v), 5) for v in b]


def chunk_features(geoms_metric: np.ndarray, chunk_m: float) -> dict[str, list[int]]:
    """Group feature indices into square chunks by representative point."""
    pts = shapely.get_coordinates(shapely.point_on_surface(geoms_metric))
    chunks: dict[str, list[int]] = {}
    for i, (x, y) in enumerate(pts):
        if shapely.is_empty(geoms_metric[i]):
            continue
        key = f"{int(x // chunk_m)}_{int(y // chunk_m)}"
        chunks.setdefault(key, []).append(i)
    return chunks
