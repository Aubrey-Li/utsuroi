import { gain, glide, loadSounds, loop, slice, type Soundscape } from './kit';

/**
 * A summer meadow, from recordings: birds and insects in the grass, wind in
 * the trees that rises with the gust, and a rush of air when the wind takes
 * the words.
 */
export class WindSound implements Soundscape {
  private readonly out: GainNode;
  private meadow: GainNode | null = null;
  private trees: GainNode | null = null;
  private gust: AudioBuffer | null = null;

  private constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.out = gain(ctx, 0);
    this.out.connect(destination);
  }

  static async create(ctx: BaseAudioContext, destination: AudioNode): Promise<WindSound> {
    const s = new WindSound(ctx, destination);
    const b = await loadSounds(ctx, ['meadow', 'trees', 'gust']);
    s.meadow = loop(ctx, b.meadow, s.out, 0.6).gain;
    s.trees = loop(ctx, b.trees, s.out, 0.18).gain;
    s.gust = b.gust;
    return s;
  }

  start(): void {
    glide(this.out.gain, 1, this.ctx, 2.5);
  }

  stop(): void {
    glide(this.out.gain, 0, this.ctx, 0.6);
  }

  /** The rush of air as the wind picks up the words. */
  whoosh(): void {
    if (this.gust) slice(this.ctx, this.gust, this.out, { level: 0.5, fadeIn: 0.25, fadeOut: 1.2 });
  }

  /** `gust`: how hard the wind is blowing (0..1). */
  update(gust: number): void {
    if (this.meadow) glide(this.meadow.gain, 0.6 - gust * 0.25, this.ctx, 0.8);
    if (this.trees) glide(this.trees.gain, 0.18 + gust * 0.7, this.ctx, 0.8);
  }
}
