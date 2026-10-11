import { burst, filter, gain, glide, loopNoise, type Soundscape } from './kit';

/**
 * A dark room with a candle: a quiet room tone and a faint flutter of the
 * flame, the scratch of a pen as you write, the soft whoosh of paper
 * catching, then crackling and the low rush of the burning page.
 */
export class FireSound implements Soundscape {
  private readonly out: GainNode;
  private readonly roar: GainNode;
  private readonly roarTone: BiquadFilterNode;
  private readonly candle: GainNode;
  private sources: AudioScheduledSourceNode[] = [];
  private burning = 0;
  private crackleDebt = 0;
  private clock = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.out = gain(ctx, 0);
    this.out.connect(destination);

    const room = loopNoise(ctx, 'brown');
    const roomTone = filter(ctx, 'lowpass', 160);
    room.connect(roomTone).connect(gain(ctx, 0.06)).connect(this.out);

    const flame = loopNoise(ctx, 'pink');
    const flameTone = filter(ctx, 'bandpass', 320, 1.8);
    this.candle = gain(ctx, 0.02);
    flame.connect(flameTone).connect(this.candle).connect(this.out);

    const fire = loopNoise(ctx, 'pink');
    this.roarTone = filter(ctx, 'lowpass', 500, 0.7);
    this.roar = gain(ctx, 0);
    fire.connect(this.roarTone).connect(this.roar).connect(this.out);

    this.sources = [room, flame, fire];
  }

  start(): void {
    glide(this.out.gain, 0.95, this.ctx, 1.5);
  }

  stop(): void {
    glide(this.out.gain, 0, this.ctx, 0.5);
  }

  dispose(): void {
    for (const s of this.sources) s.stop();
    this.out.disconnect();
  }

  /** A pen stroke on paper, for each character typed. */
  penStroke(): void {
    burst(this.ctx, this.out, {
      freq: 3200 + Math.random() * 1800,
      Q: 1.2,
      level: 0.22 + Math.random() * 0.1,
      attack: 0.004,
      decay: 0.05 + Math.random() * 0.05,
      pan: (Math.random() - 0.5) * 0.3,
    });
  }

  /** The flame leaving the candle, and the paper catching. */
  ignite(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = loopNoise(ctx, 'pink');
    const tone = filter(ctx, 'bandpass', 500, 0.9);
    const g = gain(ctx, 0);
    tone.frequency.setValueAtTime(400, t);
    tone.frequency.exponentialRampToValueAtTime(1800, t + 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(tone).connect(g).connect(this.out);
    src.stop(t + 1);
  }

  /** `burning`: how much of the page is alight (0..1). `flicker`: the candle's flicker, around 1. */
  update(dt: number, burning: number, flicker: number): void {
    this.clock += dt;
    this.burning = burning;
    glide(this.candle.gain, 0.015 + (flicker - 1) * 0.12, this.ctx, 0.08);
    glide(this.roar.gain, burning * 0.28 * (0.85 + 0.15 * Math.sin(this.clock * 9)), this.ctx, 0.2);
    glide(this.roarTone.frequency, 380 + burning * 900, this.ctx, 0.3);

    // Crackles come at random, faster the more is burning.
    this.crackleDebt += dt * (burning * 28);
    while (this.crackleDebt > 1) {
      this.crackleDebt -= 1;
      if (Math.random() < 0.5) continue;
      const at = this.ctx.currentTime + Math.random() * dt;
      const pan = (Math.random() - 0.5) * 0.8;
      burst(this.ctx, this.out, { type: 'highpass', freq: 1200 + Math.random() * 3000, Q: 0.7, level: 0.08 + Math.random() * 0.2, decay: 0.004 + Math.random() * 0.02, at, pan });
      // Some pops come in pairs.
      if (Math.random() < 0.25) {
        burst(this.ctx, this.out, { type: 'highpass', freq: 2000, Q: 0.7, level: 0.06 + Math.random() * 0.1, decay: 0.006, at: at + 0.015 + Math.random() * 0.03, pan });
      }
    }
  }

  get isBurning(): boolean {
    return this.burning > 0.01;
  }
}
