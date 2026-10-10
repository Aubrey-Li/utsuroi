import type { Vec2 } from './types';

export function pathLength(pts: readonly Vec2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return len;
}

/**
 * Centripetal Catmull-Rom through every control point. Font polylines are
 * coarse (10-30 points per letter); this turns them into smooth curves
 * without loops or overshoot at sharp turns.
 */
export function catmullRom(pts: readonly Vec2[], samplesPerSegment = 6): Vec2[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const out: Vec2[] = [{ ...pts[0]! }];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(i + 2, n - 1)]!;
    const knot = (a: Vec2, b: Vec2) => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-6);
    const t0 = 0;
    const t1 = t0 + (p0 === p1 ? knot(p1, p2) : knot(p0, p1));
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + (p2 === p3 ? knot(p1, p2) : knot(p2, p3));
    for (let s = 1; s <= samplesPerSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSegment;
      const lerp = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
        const w = (t - ta) / (tb - ta);
        return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}

/** Resamples a polyline to evenly spaced points (spacing in the same units as the points). */
export function resample(pts: readonly Vec2[], spacing: number): Vec2[] {
  if (pts.length === 0) return [];
  const out: Vec2[] = [{ ...pts[0]! }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg === 0) continue;
    let d = spacing - carry;
    while (d <= seg) {
      const w = d / seg;
      out.push({ x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w });
      d += spacing;
    }
    carry = seg - (d - spacing);
  }
  const last = pts[pts.length - 1]!;
  const tail = out[out.length - 1]!;
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > spacing * 0.25) out.push({ ...last });
  return out;
}
