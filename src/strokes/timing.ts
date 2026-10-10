import type { TimedPoint, Vec2 } from './types';

export interface TimingParams {
  /** Hand speed on straight lines, meters per second. */
  speed: number;
  /** Curvature (1/m) above which the hand starts slowing down. */
  curvatureRef: number;
  /** The slowest the hand gets in tight turns, as a fraction of `speed`. */
  minSpeedRatio: number;
  /** Distance (m) over which the stick accelerates at a stroke's start and slows at its end. */
  rampLength: number;
  pressureBase: number;
  /** Extra pressure where the stick lands. */
  pressureStart: number;
  /** Extra pressure in sharp turns. */
  pressureTurn: number;
  /** Curvature (1/m) that earns the full turn pressure. */
  turnCurvature: number;
  /** Distance (m) over which pressure trails off at a stroke's end. */
  taperLength: number;
}

export const DEFAULT_TIMING: TimingParams = {
  speed: 2.4,
  curvatureRef: 6,
  minSpeedRatio: 0.32,
  rampLength: 0.035,
  pressureBase: 0.62,
  pressureStart: 0.3,
  pressureTurn: 0.22,
  turnCurvature: 60,
  taperLength: 0.05,
};

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Unsigned curvature at each point (1/m), lightly smoothed. */
export function curvatures(pts: readonly Vec2[]): number[] {
  const n = pts.length;
  const raw = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    if (l1 === 0 || l2 === 0) continue;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    raw[i] = Math.abs(Math.atan2(cross, dot)) / ((l1 + l2) / 2);
  }
  const out = new Array<number>(n).fill(0);
  const w = 3;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) {
      sum += raw[j]!;
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/**
 * Assigns time and pressure to an evenly spaced stroke.
 *
 * Speed follows the two-thirds power law from motor-control research: hand
 * speed scales with curvature^(-1/3), so the stick slows in tight curves and
 * moves quickly on straight runs. That timing is most of what makes the
 * motion read as written rather than plotted.
 */
export function timeStroke(pts: readonly Vec2[], params: TimingParams = DEFAULT_TIMING): TimedPoint[] {
  const n = pts.length;
  if (n === 0) return [];
  const kappa = curvatures(pts);
  const cumulative = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    cumulative[i] = cumulative[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  const total = cumulative[n - 1]!;

  const speedAt = (i: number): number => {
    const k = kappa[i]!;
    const ratio = k > params.curvatureRef ? Math.pow(k / params.curvatureRef, -1 / 3) : 1;
    const s = cumulative[i]!;
    const ramp =
      (0.35 + 0.65 * smoothstep(0, params.rampLength, s)) * (0.5 + 0.5 * smoothstep(0, params.rampLength * 0.6, total - s));
    return params.speed * Math.max(params.minSpeedRatio, ratio) * ramp;
  };

  const out: TimedPoint[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const ds = cumulative[i]! - cumulative[i - 1]!;
      t += ds / ((speedAt(i) + speedAt(i - 1)) / 2);
    }
    const s = cumulative[i]!;
    const press =
      (params.pressureBase +
        params.pressureStart * Math.exp(-s / 0.025) +
        params.pressureTurn * Math.min(1, kappa[i]! / params.turnCurvature)) *
      (0.55 + 0.45 * smoothstep(0, params.taperLength, total - s));
    out.push({ x: pts[i]!.x, y: pts[i]!.y, p: Math.min(1, Math.max(0, press)), t });
  }
  return out;
}
