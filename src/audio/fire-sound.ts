import { gain, glide, loadSounds, loop, slice, type Soundscape } from './kit';

/**
 * A dark room by candlelight, from recordings: quiet while you write; the
 * flare of the paper catching; then crackling that grows into the fuller
 * sound of the page burning, with how much is alight.
 */
export class FireSound implements Soundscape {
  private readonly out: GainNode;
  private catchFlame: AudioBuffer | null = null;
  private crackle: GainNode | null = null;
  private blaze: GainNode | null = null;

  private constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.out = gain(ctx, 0);
    this.out.connect(destination);
  }

  static async create(ctx: BaseAudioContext, destination: AudioNode): Promise<FireSound> {
    const s = new FireSound(ctx, destination);
    const b = await loadSounds(ctx, ['catch', 'crackle', 'blaze']);
    s.catchFlame = b.catch;
    s.crackle = loop(ctx, b.crackle, s.out, 0).gain;
    s.blaze = loop(ctx, b.blaze, s.out, 0).gain;
    return s;
  }

  start(): void {
    glide(this.out.gain, 1, this.ctx, 1.5);
  }

  stop(): void {
    glide(this.out.gain, 0, this.ctx, 0.5);
  }

  /** The paper catching. */
  ignite(): void {
    if (this.catchFlame) slice(this.ctx, this.catchFlame, this.out, { level: 0.7, fadeOut: 0.2 });
  }

  /** `burning`: how much of the page is alight (0..1). */
  update(burning: number): void {
    if (this.crackle) glide(this.crackle.gain, Math.min(1, burning * 1.4) * 0.75, this.ctx, 0.3);
    if (this.blaze) glide(this.blaze.gain, Math.pow(burning, 1.6) * 0.55, this.ctx, 0.5);
  }
}
