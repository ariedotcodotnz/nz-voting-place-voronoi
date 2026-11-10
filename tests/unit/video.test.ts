import { describe, expect, it } from "vitest";
import { DEFAULT_TIMING, frameKey, frameState, totalFrames } from "@/lib/video/schedule";

describe("timeline video schedule", () => {
  const n = 7;
  const fps = DEFAULT_TIMING.fps;
  const total = totalFrames(n);

  it("covers intro, a hold per election, fades between them and an outro", () => {
    const { intro, hold, fade, outro } = DEFAULT_TIMING;
    const f = (x: number) => Math.round(x * fps);
    expect(total).toBe(f(intro) + n * f(hold) + (n - 1) * f(fade) + f(outro));
  });

  it("visits every election in order and only real elections are displayed", () => {
    const shown: number[] = [];
    for (let f = 0; f < total; f++) {
      const s = frameState(f, n);
      expect(Number.isInteger(s.shown)).toBe(true);
      expect(s.shown).toBeGreaterThanOrEqual(0);
      expect(s.shown).toBeLessThan(n);
      if (shown[shown.length - 1] !== s.shown) shown.push(s.shown);
    }
    expect(shown).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("crossfades smoothly and switches the label at the midpoint", () => {
    const fades = Array.from({ length: total }, (_, f) => frameState(f, n)).filter((s) => s.to !== null);
    expect(fades.length).toBe(Math.round((n - 1) * DEFAULT_TIMING.fade * fps));
    for (const s of fades) {
      expect(s.to).toBe(s.from + 1);
      expect(s.t).toBeGreaterThanOrEqual(0);
      expect(s.t).toBeLessThanOrEqual(1);
      expect(s.shown).toBe(s.t < 0.5 ? s.from : s.to);
    }
  });

  it("fades the map in during the intro and ends on the last election", () => {
    expect(frameState(0, n).mapIn).toBe(0);
    expect(frameState(Math.round(fps * DEFAULT_TIMING.intro), n).mapIn).toBe(1);
    const last = frameState(total - 1, n);
    expect(last.outro).toBe(true);
    expect(last.shown).toBe(n - 1);
  });

  it("gives every crossfade and intro frame its own key and repeats keys only on holds", () => {
    const states = Array.from({ length: total }, (_, f) => frameState(f, n));
    const keys = states.map(frameKey);
    for (let f = 1; f < total; f++) {
      const same = keys[f] === keys[f - 1];
      // A repeated key must be a still frame: no crossfade and the map fully in.
      if (same) expect(states[f].to === null && states[f].mapIn === 1).toBe(true);
      if (states[f].to !== null) expect(same).toBe(false);
    }
    // Holds and the outro are long runs, so most frames are repeats.
    expect(new Set(keys).size).toBeLessThan(total / 2);
  });
});
