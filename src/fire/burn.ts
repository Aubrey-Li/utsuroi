import { createRng } from '../strokes/random';

/**
 * How a sheet of paper burns, as a map from paper position (u, v in 0..1) to
 * the moment the flame reaches it (0..1). The front starts at the ignition
 * point and spreads outward, unevenly, the way real paper burns.
 */
export const BURN_SIZE = 512;

/** Width (in map units) of the charred band behind the front before paper falls away to ash. */
export const CHAR_WIDTH = 0.05;

export interface UV {
  u: number;
  v: number;
}

function valueNoise2(rng: () => number, cells: number) {
  const grid = Array.from({ length: (cells + 1) * (cells + 1) }, () => rng());
  return (u: number, v: number) => {
    const x = u * cells;
    const y = v * cells;
    const i = Math.min(cells - 1, Math.floor(x));
    const j = Math.min(cells - 1, Math.floor(y));
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number) => grid[b * (cells + 1) + a]!;
    const top = at(i, j) * (1 - sx) + at(i + 1, j) * sx;
    const bottom = at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
}

export function makeBurnMap(seed: number, ignition: UV, size = BURN_SIZE): Float32Array {
  const rng = createRng(seed);
  const coarse = valueNoise2(rng, 5);
  const fine = valueNoise2(rng, 17);
  const map = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i + 0.5) / size;
      const v = (j + 0.5) / size;
      // Paper is taller than wide; measure distance in paper proportions.
      const d = Math.hypot((u - ignition.u) * 0.71, v - ignition.v);
      const n = coarse(u, v) * 0.7 + fine(u, v) * 0.3;
      const value = d + (n - 0.5) * 0.28 * Math.min(1, d * 4);
      map[j * size + i] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  for (let k = 0; k < map.length; k++) map[k] = (map[k]! - min) / (max - min);
  return map;
}

/** Bilinear lookup of the burn map at (u, v). */
export function burnAt(map: Float32Array, u: number, v: number, size = BURN_SIZE): number {
  const x = Math.min(size - 1.001, Math.max(0, u * size - 0.5));
  const y = Math.min(size - 1.001, Math.max(0, v * size - 0.5));
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const at = (a: number, b: number) => map[b * size + a]!;
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
}

/** A random point on the burning edge, for placing flames and embers. Null if none is found. */
export function sampleFront(map: Float32Array, front: number, rng: () => number, tries = 30, tolerance = 0.012): UV | null {
  for (let k = 0; k < tries; k++) {
    const u = rng();
    const v = rng();
    if (Math.abs(burnAt(map, u, v) - front) < tolerance) return { u, v };
  }
  return null;
}

/** Speed of the front: slow to catch, then quicker as it spreads. Units of map per second. */
export function frontSpeed(front: number): number {
  return 0.055 + 0.06 * Math.min(1, Math.max(0, front));
}

export function isBurntOut(front: number): boolean {
  return front > 1 + CHAR_WIDTH;
}

/** Packs the map into bytes for a texture. */
export function packBurnMap(map: Float32Array): Uint8Array {
  const out = new Uint8Array(map.length);
  for (let k = 0; k < map.length; k++) out[k] = Math.round(map[k]! * 255);
  return out;
}
