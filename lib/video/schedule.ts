/**
 * Frame schedule for timeline videos: intro on the first election, a hold on
 * each election, an eased crossfade between consecutive elections, and an
 * outro on the last. Crossfades are visual only: the year and every number
 * shown switch at the midpoint and always belong to a real election.
 */
export interface Timing {
  fps: number;
  intro: number;
  hold: number;
  fade: number;
  outro: number;
}

export const DEFAULT_TIMING: Timing = { fps: 30, intro: 1.2, hold: 2.0, fade: 1.0, outro: 2.6 };

export interface FrameState {
  /** Election index fully drawn underneath. */
  from: number;
  /** Election index fading in on top (null when holding). */
  to: number | null;
  /** Eased crossfade progress 0..1. */
  t: number;
  /** Election whose year and statistics are displayed. */
  shown: number;
  /** Map fade-in during the intro, 0..1. */
  mapIn: number;
  /** True during the outro. */
  outro: boolean;
}

export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Segment lengths in whole frames (integer arithmetic keeps boundaries exact). */
function frames(tm: Timing) {
  const f = (sec: number) => Math.max(1, Math.round(sec * tm.fps));
  return { intro: f(tm.intro), hold: f(tm.hold), fade: f(tm.fade), outro: f(tm.outro) };
}

export function totalFrames(n: number, tm: Timing = DEFAULT_TIMING): number {
  if (n <= 0) return 0;
  const F = frames(tm);
  return F.intro + n * F.hold + (n - 1) * F.fade + F.outro;
}

export function frameState(frame: number, n: number, tm: Timing = DEFAULT_TIMING): FrameState {
  const F = frames(tm);
  const mapIn = Math.min(1, frame / Math.max(1, F.intro * 0.6));
  let r = frame - F.intro;
  if (r < 0) return { from: 0, to: null, t: 0, shown: 0, mapIn, outro: false };
  for (let k = 0; k < n; k++) {
    if (r < F.hold) return { from: k, to: null, t: 0, shown: k, mapIn, outro: false };
    r -= F.hold;
    if (k === n - 1) break;
    if (r < F.fade) {
      const p = ease(r / F.fade);
      return { from: k, to: k + 1, t: p, shown: p < 0.5 ? k : k + 1, mapIn, outro: false };
    }
    r -= F.fade;
  }
  return { from: n - 1, to: null, t: 0, shown: n - 1, mapIn, outro: true };
}
