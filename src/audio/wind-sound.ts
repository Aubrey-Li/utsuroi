import { burst, filter, gain, glide, loopNoise, type Soundscape } from './kit';

/**
 * A meadow on a sunny day: a breeze that rises and falls, leaves rustling
 * overhead, birds now and then, and the rush of a gust when the wind takes
 * the words.
 */
export class WindSound implements Soundscape {
  private readonly out: GainNode;
  private readonly breeze: GainNode;
  private readonly breezeTone: BiquadFilterNode;
  private readonly leaves: GainNode;
  private sources: AudioScheduledSourceNode[] = [];
  private nextBird = 2;
  private clock = 0;
  private gust = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.out = gain(ctx, 0);
    this.out.connect(destination);

    const air = loopNoise(ctx, 'pink');
    this.breezeTone = filter(ctx, 'bandpass', 600, 0.5);
    this.breeze = gain(ctx, 0.1);
    air.connect(this.breezeTone).connect(this.breeze).connect(this.out);

    const rustle = loopNoise(ctx, 'white');
    const rustleTone = filter(ctx, 'highpass', 2600, 0.5);
    const rustleSoft = filter(ctx, 'lowpass', 7500, 0.5);
    this.leaves = gain(ctx, 0.02);
    rustle.connect(rustleTone).connect(rustleSoft).connect(this.leaves).connect(this.out);

    this.sources = [air, rustle];
  }

  start(): void {
    glide(this.out.gain, 0.9, this.ctx, 2.5);
  }

  stop(): void {
    glide(this.out.gain, 0, this.ctx, 0.6);
  }

  dispose(): void {
    for (const s of this.sources) s.stop();
    this.out.disconnect();
  }

  /** The gust when the wind takes the words: a rising rush of air through the leaves. */
  whoosh(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = loopNoise(ctx, 'pink');
    const tone = filter(ctx, 'bandpass', 300, 0.8);
    const g = gain(ctx, 0);
    tone.frequency.setValueAtTime(300, t);
    tone.frequency.exponentialRampToValueAtTime(1400, t + 1.6);
    tone.frequency.exponentialRampToValueAtTime(500, t + 5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 1.4);
    g.gain.setTargetAtTime(0, t + 2.2, 1.2);
    src.connect(tone).connect(g).connect(this.out);
    src.stop(t + 9);
  }

  /** `gust`: how hard the wind is blowing (0..1). */
  update(dt: number, gust: number): void {
    this.clock += dt;
    this.gust = gust;
    const t = this.clock;
    // The breeze breathes in and out on its own.
    const swell = 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1);
    glide(this.breeze.gain, 0.13 + swell * 0.14 + gust * 0.35, this.ctx, 0.5);
    glide(this.breezeTone.frequency, 450 + swell * 300 + gust * 900, this.ctx, 0.6);
    const flutter = 0.5 + 0.5 * Math.sin(t * 5.3) * Math.sin(t * 2.1 + 2);
    glide(this.leaves.gain, (0.03 + swell * 0.04 + gust * 0.14) * (0.6 + 0.4 * flutter), this.ctx, 0.12);

    // Birds sing when it's calm.
    if (t > this.nextBird) {
      this.nextBird = t + 4 + Math.random() * 9;
      if (this.gust < 0.3) this.bird();
    }
  }

  /** A short phrase of chirps, synthesized, somewhere off to one side. */
  private bird(): void {
    const ctx = this.ctx;
    const pan = Math.random() * 1.6 - 0.8;
    const base = 2600 + Math.random() * 1600;
    const notes = 2 + Math.floor(Math.random() * 4);
    let at = ctx.currentTime + 0.05;
    const panner = 'createStereoPanner' in ctx ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      panner.connect(this.out);
    }
    const dest = panner ?? this.out;
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const g = gain(ctx, 0);
      const len = 0.06 + Math.random() * 0.09;
      const up = Math.random() < 0.6;
      const f0 = base * (up ? 0.85 : 1.25);
      const f1 = base * (up ? 1.3 : 0.8);
      osc.frequency.setValueAtTime(f0, at);
      osc.frequency.exponentialRampToValueAtTime(f1, at + len);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.045, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      osc.connect(g).connect(dest);
      osc.start(at);
      osc.stop(at + len + 0.02);
      at += len + 0.04 + Math.random() * 0.08;
    }
  }

  /** For tests: a short rustle of leaves on demand. */
  rustle(): void {
    burst(this.ctx, this.out, { freq: 5000, Q: 0.5, level: 0.05, decay: 0.2 });
  }
}
