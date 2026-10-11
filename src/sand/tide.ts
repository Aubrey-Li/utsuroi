import { createRng, fbm1 } from '../strokes/random';

/**
 * Distances here are measured up the beach from the waterline, in meters
 * ("u"). A front of 3 means the water reaches 3 m up the sand at that x.
 * The writing sits roughly 3.3 to 5 m up the beach.
 */
interface Wave {
  reach: number;
  rise: number;
  hold: number;
  fall: number;
  t: number;
  strength: number;
  seedA: number;
  seedB: number;
}

export interface TideParams {
  /** Seconds between waves, min and max. */
  gapMin: number;
  gapMax: number;
  /** Chance that a wave is a big one that runs up into the writing, at calm and at full swell. */
  bigChanceCalm: number;
  bigChanceSwell: number;
  /** How far big waves reach (m up the beach). */
  bigReachMin: number;
  bigReachMax: number;
  /** Seconds for the swell to build and fade. Big waves come in sets when the swell is up. */
  swellPeriod: number;
  /** Big waves are this much less likely while someone is writing. */
  writingLull: number;
}

export const DEFAULT_TIDE: TideParams = {
  gapMin: 0.3,
  gapMax: 2.2,
  bigChanceCalm: 0.08,
  bigChanceSwell: 0.45,
  bigReachMin: 2.8,
  bigReachMax: 6.4,
  swellPeriod: 45,
  writingLull: 0.3,
};

/** Lowest the water ever sits, so the waterline always stays wet and meets the sea. */
const MIN_FRONT = 0.18;

/**
 * The sea, always moving. Most waves lap at the waterline; now and then the
 * swell builds and a set of bigger waves runs up the beach and takes some of
 * whatever is written there. Nothing is triggered by the writer.
 */
export class Tide {
  /** Seconds since the tide started. */
  time = 0;
  params: TideParams;
  /** Set by the app while someone is writing, to ease off the big waves a little. */
  writing = false;
  /** Total waves so far, and how many of them were big. */
  waves = 0;
  bigWaves = 0;
  private wave: Wave;
  private gap = 0;
  private readonly rng: () => number;
  private readonly swellSeed: number;

  constructor(seed = 7, params: TideParams = DEFAULT_TIDE) {
    this.rng = createRng(seed);
    this.params = { ...params };
    this.swellSeed = Math.floor(this.rng() * 1e6);
    this.wave = this.smallWave();
    this.wave.t = this.wave.rise * 0.6;
  }

  /** How strongly the current wave erodes what it covers (1/s). */
  get erosion(): number {
    return this.wave.strength;
  }

  /** Highest the water reaches anywhere right now, for skipping dry rows. */
  get maxFront(): number {
    return this.baseFront() * 1.35 + 0.35;
  }

  /** How far up the beach (m) the current wave's front is, before shaping along the shore. */
  get level(): number {
    return this.baseFront();
  }

  /** True while the current wave is still running up the beach (foam is brightest then). */
  get rushing(): boolean {
    return this.wave.t < this.wave.rise;
  }

  /** 0 when the sea is calm, 1 at the height of a swell. */
  get swell(): number {
    const s = 0.5 + 0.5 * fbm1(this.time / this.params.swellPeriod, this.swellSeed);
    return Math.min(1, Math.max(0, (s - 0.25) / 0.6));
  }

  update(dt: number): void {
    this.time += dt;
    const w = this.wave;
    if (w.t < w.rise + w.hold + w.fall) {
      w.t += dt;
      return;
    }
    this.gap -= dt;
    if (this.gap > 0) return;
    const p = this.params;
    const swell = this.swell;
    let chance = p.bigChanceCalm + (p.bigChanceSwell - p.bigChanceCalm) * swell * swell;
    if (this.writing) chance *= p.writingLull;
    if (this.rng() < chance) {
      const r = Math.pow(this.rng(), 0.6) * (0.7 + 0.3 * swell);
      this.wave = this.bigWave(p.bigReachMin + (p.bigReachMax - p.bigReachMin) * r);
      this.bigWaves++;
    } else {
      this.wave = this.smallWave();
    }
    this.waves++;
    this.gap = p.gapMin + (p.gapMax - p.gapMin) * this.rng();
  }

  /** Distance up the beach (m) the water reaches at world x. */
  frontAt(x: number): number {
    const w = this.wave;
    const base = this.baseFront();
    const lobes = 1 + 0.11 * fbm1(x * 0.22, w.seedA);
    const fringe = 0.22 * fbm1(x * 0.8 + this.time * 0.12, w.seedB) * Math.min(1, base);
    const lace = 0.025 * Math.sin(x * 5.3 + this.time * 2.1) + 0.015 * Math.sin(x * 11.7 - this.time * 1.3);
    return Math.max(MIN_FRONT, base * lobes + fringe + lace);
  }

  private baseFront(): number {
    const w = this.wave;
    if (w.t < w.rise) {
      const u = w.t / w.rise;
      return MIN_FRONT + (w.reach - MIN_FRONT) * (1 - (1 - u) ** 3);
    }
    if (w.t < w.rise + w.hold) return w.reach;
    const u = Math.min(1, (w.t - w.rise - w.hold) / w.fall);
    return MIN_FRONT + (w.reach - MIN_FRONT) * (1 - u * u);
  }

  private smallWave(): Wave {
    const r = this.rng;
    const swell = this.swell;
    return {
      reach: 0.4 + r() * (0.6 + swell * 0.7),
      rise: 1.8 + r() * 0.8,
      hold: 0.25,
      fall: 2.6 + r() * 1.0,
      t: 0,
      strength: 0.45,
      seedA: Math.floor(r() * 1e6),
      seedB: Math.floor(r() * 1e6),
    };
  }

  private bigWave(reach: number): Wave {
    const r = this.rng;
    return {
      reach,
      rise: 2.2 + r() * 0.7 + reach * 0.08,
      hold: 0.35,
      fall: 3.0 + r() * 0.8 + reach * 0.1,
      t: 0,
      strength: 0.85 + r() * 0.35,
      seedA: Math.floor(r() * 1e6),
      seedB: Math.floor(r() * 1e6),
    };
  }
}
