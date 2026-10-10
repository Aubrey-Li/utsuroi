import { createRng, fbm1 } from '../strokes/random';

/** One thing carried by the wind: a character, or a leaf. */
export interface Flier {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Rotation around the view axis and a slow tumble, in radians. */
  spin: number;
  tumble: number;
  spinRate: number;
  tumbleRate: number;
  /** Seconds before the wind lifts it; it shivers in place until then. */
  delay: number;
  age: number;
  seed: number;
  /** 1 while flying normally, fading to 0 as it leaves. */
  opacity: number;
  scale: number;
  gone: boolean;
}

export interface FlightBounds {
  /** Fliers past this x (or above this y) have left the view. */
  maxX: number;
  maxY: number;
  /** Seconds after which anything still around fades out regardless. */
  maxAge: number;
}

export function makeFlier(x: number, y: number, z: number, delay: number, seed: number): Flier {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    spin: 0,
    tumble: 0,
    spinRate: 0,
    tumbleRate: 0,
    delay,
    age: 0,
    seed,
    opacity: 1,
    scale: 1,
    gone: false,
  };
}

/**
 * Lift order for the words: roughly left to right, line by line, with a
 * little randomness so they don't leave like a printer.
 */
export function liftDelays(count: number, seed: number, spacing = 0.07): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, i) => i * spacing + rng() * 0.35);
}

/**
 * Advances everything the wind is carrying. `gust` (0..1) is how hard it's
 * blowing. Air drag keeps speeds natural; noise makes each path its own.
 */
export function stepFliers(fliers: Flier[], dt: number, gust: number, time: number, bounds: FlightBounds): void {
  for (const f of fliers) {
    if (f.gone) continue;
    f.age += dt;
    if (f.age < f.delay) {
      // Shivering in place, more as the moment comes.
      const k = f.age / Math.max(f.delay, 1e-3);
      f.spin = Math.sin(time * 18 + f.seed) * 0.08 * k * gust;
      continue;
    }
    const t = f.age - f.delay;
    if (f.spinRate === 0) {
      const r = createRng(f.seed);
      f.spinRate = (r() - 0.5) * 6;
      f.tumbleRate = 1.5 + r() * 3;
      f.vx = 0.6 + r() * 0.8;
      f.vy = 0.4 + r() * 0.6;
    }
    const n1 = fbm1(time * 0.8 + f.seed * 0.13, f.seed);
    const n2 = fbm1(time * 1.1 + f.seed * 0.29, f.seed + 77);
    const ax = (2.6 + 1.2 * n1) * gust + 0.25;
    const ay = (0.7 + 1.4 * n2) * gust + 0.2 * Math.sin(time * 2 + f.seed);
    const az = 0.6 * fbm1(time * 0.6 + f.seed, f.seed + 191);
    const drag = Math.exp(-0.55 * dt);
    f.vx = (f.vx + ax * dt) * drag;
    f.vy = (f.vy + ay * dt) * drag;
    f.vz = (f.vz + az * dt) * drag;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z += f.vz * dt;
    f.spin += f.spinRate * dt;
    f.tumble += f.tumbleRate * dt;
    f.scale = Math.max(0.55, 1 - t * 0.08);
    const leaving = f.x > bounds.maxX || f.y > bounds.maxY || f.age > bounds.maxAge;
    f.opacity = leaving ? f.opacity - dt * 1.5 : Math.min(1, f.opacity + dt);
    if (f.opacity <= 0) {
      f.opacity = 0;
      f.gone = true;
    }
  }
}

export function allGone(fliers: readonly Flier[]): boolean {
  return fliers.every((f) => f.gone);
}
