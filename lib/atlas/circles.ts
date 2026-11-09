/**
 * Proportional-circle sizing.
 *
 * Circle AREA is proportional to the value (radius ∝ √value), with a constant
 * that is the same for every party and every election, so circles can be
 * compared across the timeline and between parties. Zooming applies one
 * uniform factor to every circle, which preserves the area ratios.
 */
import type { CircleSize } from "./url";

const K_VOTES = 0.34; // px per √vote at the reference zoom
const K_SHARE = 17; // px per √share at the reference zoom
const EQUAL_PX = 5;
const REF_ZOOM = 11;
export const MIN_RADIUS_PX = 1.25;

/** Uniform zoom factor: circles grow more slowly than the map so national
 *  views are not swamped and street views are not empty. */
export function zoomFactor(zoom: number): number {
  return Math.pow(2, (zoom - REF_ZOOM) * 0.55);
}

/** Radius in pixels for a value at a zoom level. `value` is votes for
 *  'votes' and a fraction (0..1) for 'share'. */
export function circleRadiusPx(value: number, zoom: number, size: CircleSize, scale = 1): number {
  if (size === "equal") return EQUAL_PX * scale * Math.pow(zoomFactor(zoom), 0.45);
  if (!(value > 0)) return 0;
  const k = size === "votes" ? K_VOTES : K_SHARE;
  return k * scale * Math.sqrt(value) * zoomFactor(zoom);
}

/** Inverse: the value a circle of radius `px` represents (for legends). */
export function valueForRadius(px: number, zoom: number, size: CircleSize, scale = 1): number {
  if (size === "equal") return NaN;
  const k = size === "votes" ? K_VOTES : K_SHARE;
  const r = px / (k * scale * zoomFactor(zoom));
  return r * r;
}

/** Grid cell size (degrees) for clustering at a zoom level; 0 = no clustering. */
export function clusterCellDeg(zoom: number, enabled: boolean): number {
  if (!enabled || zoom >= 8.5) return 0;
  const degPerPx = 360 / (256 * Math.pow(2, zoom));
  return 26 * degPerPx;
}

/** Tidy reference values for a circle legend, spanning the visible range. */
export function legendValues(maxValue: number, size: CircleSize): number[] {
  if (size === "share") return [0.05, 0.2, 0.5].filter((v) => v <= Math.max(0.5, maxValue));
  const nice = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
  const top = nice.filter((v) => v <= Math.max(10, maxValue)).pop() ?? 10;
  const i = nice.indexOf(top);
  return [nice[Math.max(0, i - 4)], nice[Math.max(0, i - 2)], top].filter((v, k, a) => a.indexOf(v) === k);
}
