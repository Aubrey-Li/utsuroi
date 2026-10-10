import { createRng, fbm1 } from '../strokes/random';

/**
 * Distances here are measured up the beach from the waterline, in meters
 * ("u"). A front of 3 means the water reaches 3 m up the sand at that x.
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

/** Lowest the water ever sits, so the waterline always stays wet and meets the sea. */
const MIN_FRONT = 0.18;

// Each wave in the release reaches a little higher, so the tide takes the
// words a piece at a time. The text sits roughly 3.3 to 5.0 m up the beach.
const RELEASE_REACHES = [2.3, 3.4, 4.0, 4.6, 5.15, 5.55, 5.9];

export type TideMode = 'idle' | 'release';

export class Tide {
  mode: TideMode = 'idle';
  /** Seconds since the tide started. */
  time = 0;
  private wave: Wave;
  private gap = 0;
  private readonly queue: number[] = [];
  private readonly rng: () => number;
  /** Count of release waves that have begun. */
  releaseWaves = 0;

  constructor(seed = 7) {
    this.rng = createRng(seed);
    this.wave = this.idleWave();
    this.wave.t = this.wave.rise * 0.6;
  }

  /** How strongly the current wave erodes what it covers (1/s). */
  get erosion(): number {
    return this.wave.strength;
  }

  get pendingReleaseWaves(): number {
    return this.queue.length;
  }

  /** Highest the water reaches anywhere right now, for skipping dry rows. */
  get maxFront(): number {
    return this.baseFront() * 1.35 + 0.35;
  }

  /** True while the current wave is still running up the beach (foam is brightest then). */
  get rushing(): boolean {
    return this.wave.t < this.wave.rise;
  }

  release(): void {
    this.mode = 'release';
    this.queue.length = 0;
    this.queue.push(...RELEASE_REACHES);
    this.releaseWaves = 0;
    // Let the current little wave finish; the release starts on the next one.
  }

  /** Adds one more large wave, for when the words haven't quite gone. */
  addWave(reach = 6.1): void {
    this.queue.push(reach);
  }

  calm(): void {
    this.mode = 'idle';
    this.queue.length = 0;
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
    const reach = this.queue.shift();
    if (reach !== undefined) {
      this.wave = this.releaseWave(reach);
      this.releaseWaves++;
    } else {
      if (this.mode === 'release') this.mode = 'idle';
      this.wave = this.idleWave();
    }
    this.gap = this.mode === 'release' ? 0.2 + this.rng() * 0.5 : 0.4 + this.rng() * 1.3;
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

  private idleWave(): Wave {
    const r = this.rng;
    return {
      reach: 0.45 + r() * 0.6,
      rise: 1.9 + r() * 0.7,
      hold: 0.25,
      fall: 2.8 + r() * 0.8,
      t: 0,
      strength: 0.45,
      seedA: Math.floor(r() * 1e6),
      seedB: Math.floor(r() * 1e6),
    };
  }

  private releaseWave(reach: number): Wave {
    const r = this.rng;
    return {
      reach: reach * (0.97 + r() * 0.06),
      rise: 2.3 + r() * 0.6 + reach * 0.08,
      hold: 0.35,
      fall: 3.2 + r() * 0.7 + reach * 0.1,
      t: 0,
      strength: 0.95 + r() * 0.3,
      seedA: Math.floor(r() * 1e6),
      seedB: Math.floor(r() * 1e6),
    };
  }
}
