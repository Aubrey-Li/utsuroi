import { gain, glide, loadSounds, loop, slice, type Soundscape } from './kit';

/**
 * A dark room by candlelight, from recordings: quiet but for a pen on paper
 * as you write; the flare of the paper catching; then crackling that grows
 * into the fuller sound of the page burning, with how much is alight.
 */
export class FireSound implements Soundscape {
  private readonly out: GainNode;
  private pen: AudioBuffer | null = null;
  private catchFlame: AudioBuffer | null = null;
  private crackle: GainNode | null = null;
  private blaze: GainNode | null = null;
  private lastStroke = 0;

  private constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.out = gain(ctx, 0);
    this.out.connect(destination);
  }

  static async create(ctx: BaseAudioContext, destination: AudioNode): Promise<FireSound> {
    const s = new FireSound(ctx, destination);
    const b = await loadSounds(ctx, ['pen', 'catch', 'crackle', 'blaze']);
    s.pen = b.pen;
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

  /** A short stroke of the pen, cut from a recording of writing, for each character typed. */
  penStroke(): void {
    if (!this.pen) return;
    const now = this.ctx.currentTime;
    // Fast typing blends into continuous writing rather than stacking up.
    const at = Math.max(now, this.lastStroke);
    const duration = 0.09 + Math.random() * 0.12;
    this.lastStroke = at + duration * 0.6;
    slice(this.ctx, this.pen, this.out, {
      offset: Math.random() * (this.pen.duration - duration),
      duration,
      level: 0.5 + Math.random() * 0.35,
      rate: 0.92 + Math.random() * 0.16,
      fadeIn: 0.012,
      fadeOut: 0.04,
      at,
    });
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
