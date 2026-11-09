/**
 * Colour scales (D3). Sequential scales are single-hue light→dark; diverging
 * scales use two opposing poles and a neutral grey midpoint.
 */
import { color as d3color, hcl, interpolateLab, lab, piecewise, rgb } from "d3";

export type RGBA = [number, number, number, number];

export const NO_DATA_HEX = "#C9CED3";
export const TIE_HEX = "#8E959C";
export const NEUTRAL_HEX = "#ECEBE8";
export const UNASSIGNED_HEX = "#A9AFB5";

export function toRGBA(hex: string, alpha = 255): RGBA {
  const c = rgb(hex);
  return [Math.round(c.r), Math.round(c.g), Math.round(c.b), alpha];
}

/** Perceptual distance (CIE76 ΔE in Lab). */
export function deltaE(a: string, b: string): number {
  const A = lab(a);
  const B = lab(b);
  return Math.hypot(A.l - B.l, A.a - B.a, A.b - B.b);
}

/** Single-hue ramp from a near-white tint to a deepened version of `hex`.
 *  t ∈ [0,1]. Lightness decreases monotonically. */
export function sequentialInterpolator(hex: string): (t: number) => string {
  const base = hcl(hex);
  const light = hcl(base.h, Math.min(base.c, 18), 96);
  const dark = hcl(base.h, Math.max(base.c, 30), Math.max(18, Math.min(base.l - 18, 38)));
  const mid = hcl(base.h, base.c, Math.min(Math.max(base.l, 45), 70));
  return piecewise(interpolateLab, [light.formatHex(), mid.formatHex(), dark.formatHex()]);
}

/** A pole that reads as the opposite of `hex` (warm ↔ cool) for diverging
 *  scales when only one meaningful colour exists (e.g. swing). */
export function opposingPole(hex: string): string {
  const h = hcl(hex).h;
  const warm = Number.isNaN(h) ? false : h < 100 || h > 300;
  // Neither pole may read as a major party: blue would read as National,
  // red as Labour. Muted violet / brown-orange are not party colours.
  return warm ? "#6B5B95" : "#B5651D";
}

/** Two diverging poles for A vs B. Uses each party's own colour unless the two
 *  are too similar to read as opposites, in which case a fixed purple/orange
 *  pair is used (and the legend says so). */
export function divergingPoles(aHex: string, bHex: string): { a: string; b: string; fallback: boolean } {
  if (deltaE(aHex, bHex) < 35 || hcl(aHex).c < 12 || hcl(bHex).c < 12) {
    return { a: "#5E3C99", b: "#E66101", fallback: true };
  }
  return { a: aHex, b: bHex, fallback: false };
}

/** Diverging interpolator over t ∈ [-1, 1]: -1 → negPole, 0 → neutral, +1 → posPole. */
export function divergingInterpolator(negHex: string, posHex: string): (t: number) => string {
  const deepen = (h: string) => {
    const c = hcl(h);
    return hcl(c.h, Math.max(c.c, 35), Math.min(c.l, 45)).formatHex();
  };
  const neg = piecewise(interpolateLab, [NEUTRAL_HEX, negHex, deepen(negHex)]);
  const pos = piecewise(interpolateLab, [NEUTRAL_HEX, posHex, deepen(posHex)]);
  return (t: number) => {
    const c = Math.max(-1, Math.min(1, t));
    return c < 0 ? neg(-c) : pos(c);
  };
}

/** Lighten a colour toward white by `amount` ∈ [0,1] (used to shade narrow wins). */
export function lighten(hex: string, amount: number): string {
  return interpolateLab(hex, "#ffffff")(Math.max(0, Math.min(1, amount)));
}

export function readableTextOn(hex: string): string {
  const c = d3color(hex);
  if (!c) return "#14202B";
  return lab(c).l > 62 ? "#14202B" : "#FFFFFF";
}

/** Memoise a colour function over quantised inputs to keep accessors cheap. */
export function quantisedRGBA(fn: (t: number) => string, steps = 256, lo = 0, hi = 1, alpha = 255): (t: number) => RGBA {
  const cache: RGBA[] = new Array(steps + 1);
  for (let k = 0; k <= steps; k++) cache[k] = toRGBA(fn(lo + ((hi - lo) * k) / steps), alpha);
  return (t: number) => {
    const k = Math.round(((Math.max(lo, Math.min(hi, t)) - lo) / (hi - lo)) * steps);
    return cache[k];
  };
}
