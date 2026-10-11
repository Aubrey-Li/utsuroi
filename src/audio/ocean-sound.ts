import { gain, glide, loadSounds, loop, slice, type Soundscape } from './kit';

/**
 * Moments in "Waves of Hawaii" (florianreichelt, CC0) where a wave peaks, in
 * seconds. Each visual wave plays one of these, so the sound arrives with it.
 */
const WAVE_PEAKS = [10, 24.25, 34.5, 40.75, 49.75, 55.75, 61.75, 68.25, 78.5, 89.25];
/** How long before its peak a wave starts to be heard (s), and how long it lasts. */
const LEAD = 3;
const LENGTH = 6.8;

/**
 * The shore, from recordings: a quiet bed of lapping water, a wave washing
 * in for each wave on screen (louder the further it runs), and sand under
 * the stick while drawing.
 */
export class OceanSound implements Soundscape {
  private readonly out: GainNode;
  private sand: { gain: GainNode; source: AudioBufferSourceNode } | null = null;
  private waves: AudioBuffer | null = null;
  private lastWave = -1;
  private lastPeak = -1;

  private constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.out = gain(ctx, 0);
    this.out.connect(destination);
  }

  static async create(ctx: BaseAudioContext, destination: AudioNode): Promise<OceanSound> {
    const s = new OceanSound(ctx, destination);
    const b = await loadSounds(ctx, ['ocean-bed', 'ocean-waves', 'sand-drag']);
    loop(ctx, b['ocean-bed'], s.out, 0.55);
    s.sand = loop(ctx, b['sand-drag'], s.out, 0);
    s.waves = b['ocean-waves'];
    return s;
  }

  start(): void {
    glide(this.out.gain, 1, this.ctx, 2.5);
  }

  stop(): void {
    glide(this.out.gain, 0, this.ctx, 0.6);
  }

  /**
   * `waveCount` changes when a new wave starts; `reach` is how far up the beach (m) it will run.
   * `drawSpeed` is how fast the stick is moving through the sand (m/s), 0 when not drawing.
   */
  update(waveCount: number, reach: number, drawSpeed: number): void {
    if (this.waves && waveCount !== this.lastWave) {
      this.lastWave = waveCount;
      let pick = Math.floor(Math.random() * WAVE_PEAKS.length);
      if (pick === this.lastPeak) pick = (pick + 1) % WAVE_PEAKS.length;
      this.lastPeak = pick;
      const size = Math.min(1, reach / 5);
      slice(this.ctx, this.waves, this.out, {
        offset: WAVE_PEAKS[pick]! - LEAD,
        duration: LENGTH,
        level: 0.3 + 0.75 * size,
        rate: 0.96 + Math.random() * 0.08,
        fadeIn: 0.6,
        fadeOut: 1.8,
      });
    }
    if (this.sand) {
      glide(this.sand.gain.gain, Math.min(0.9, drawSpeed * 0.6), this.ctx, 0.08);
      glide(this.sand.source.playbackRate, 0.8 + Math.min(0.5, drawSpeed * 0.25), this.ctx, 0.1);
    }
  }
}
