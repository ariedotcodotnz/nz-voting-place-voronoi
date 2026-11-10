import type { CatchmentFeature, EncodedGeometryFile } from "./types";

export type BBox = [number, number, number, number]; // west, south, east, north

/** Decode one delta-encoded integer ring into [lng, lat] pairs. */
export function decodeRing(ring: number[], scale: number): number[][] {
  const out: number[][] = new Array(ring.length / 2);
  let x = 0;
  let y = 0;
  for (let k = 0, j = 0; k < ring.length; k += 2, j++) {
    x += ring[k];
    y += ring[k + 1];
    out[j] = [x / scale, y / scale];
  }
  return out;
}

export function decodeGeometryFile(file: EncodedGeometryFile, chunk: string): CatchmentFeature[] {
  if (file.v !== 1) throw new Error(`Unsupported geometry encoding v${file.v}`);
  return file.features.map(([i, polys]) => ({
    type: "Feature",
    id: i,
    properties: { i, chunk },
    geometry: { type: "MultiPolygon", coordinates: polys.map((rings) => rings.map((r) => decodeRing(r, file.scale))) },
  }));
}

/** Normalise a viewport that may cross the antimeridian into 1–2 boxes. */
export function splitViewport(b: BBox): BBox[] {
  const [w, s, e, n] = b;
  if (w <= e) return [b];
  return [
    [w, s, 180, n],
    [-180, s, e, n],
  ];
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function viewportIntersects(viewport: BBox, chunk: BBox): boolean {
  return splitViewport(viewport).some((v) => bboxIntersects(v, chunk));
}

/** Expand a bbox by a fraction of its size (for prefetching just off-screen). */
export function padBBox(b: BBox, frac: number): BBox {
  // A viewport across the date line has west > east: its width wraps through 180°.
  const width = b[0] <= b[2] ? b[2] - b[0] : b[2] + 360 - b[0];
  const dx = width * frac;
  const dy = (b[3] - b[1]) * frac;
  if (width + 2 * dx >= 360) return [-180, b[1] - dy, 180, b[3] + dy];
  const wrap = (lng: number) => (lng > 180 ? lng - 360 : lng < -180 ? lng + 360 : lng);
  return b[0] <= b[2] ? [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy] : [wrap(b[0] - dx), b[1] - dy, wrap(b[2] + dx), b[3] + dy];
}
