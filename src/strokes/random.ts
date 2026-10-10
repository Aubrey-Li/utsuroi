/** Small seeded PRNG (mulberry32). Deterministic so tests and replays are stable. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roughly normal sample (sum of uniforms), mean 0, standard deviation ~1. */
export function gaussian(rng: () => number): number {
  return (rng() + rng() + rng() + rng() - 2) * 1.732;
}

function hash1(i: number, seed: number): number {
  let h = Math.imul(i ^ seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u;
}

/** Two octaves of value noise, still roughly in [-1, 1]. */
export function fbm1(x: number, seed = 0): number {
  return noise1(x, seed) * 0.67 + noise1(x * 2.13 + 17.3, seed + 101) * 0.33;
}
