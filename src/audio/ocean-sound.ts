import { filter, gain, glide, loopNoise, type Soundscape } from './kit';

/**
 * The shore: a low rumble of the open sea, surf that swells as each wave
 * runs up the sand and fizzes as it draws back, and the scratch of sand
 * under the stick.
 */
export class OceanSound implements Soundscape {
  private readonly out: GainNode;
  private readonly surf: GainNode;
  private readonly surfTone: BiquadFilterNode;
  private readonly fizz: GainNode;
  private readonly scratch: GainNode;
  private readonly scratchTone: BiquadFilterNode;
  private lastFront = 0;
  private sources: AudioScheduledSourceNode[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.out = gain(ctx, 0);
    this.out.connect(destination);

    const rumble = loopNoise(ctx, 'brown');
    const rumbleTone = filter(ctx, 'lowpass', 260);
    const rumbleGain = gain(ctx, 0.15);
    rumble.connect(rumbleTone).connect(rumbleGain).connect(this.out);

    const surf = loopNoise(ctx, 'pink');
    this.surfTone = filter(ctx, 'lowpass', 700);
    this.surf = gain(ctx, 0.05);
    surf.connect(this.surfTone).connect(this.surf).connect(this.out);

    const fizz = loopNoise(ctx, 'white');
    const fizzTone = filter(ctx, 'bandpass', 4200, 0.6);
    this.fizz = gain(ctx, 0);
    fizz.connect(fizzTone).connect(this.fizz).connect(this.out);

    const sand = loopNoise(ctx, 'white');
    this.scratchTone = filter(ctx, 'bandpass', 2400, 1.4);
    this.scratch = gain(ctx, 0);
    sand.connect(this.scratchTone).connect(this.scratch).connect(this.out);

    this.sources = [rumble, surf, fizz, sand];
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

  /**
   * Steer the sound from the scene each frame.
   * `front`: how far up the beach the water is (m). `rushing`: the wave is still running up.
   * `drawSpeed`: how fast the stick is moving through the sand (m/s), 0 when not drawing.
   */
  update(dt: number, front: number, rushing: boolean, drawSpeed: number): void {
    const speed = dt > 0 ? (front - this.lastFront) / dt : 0;
    this.lastFront = front;
    const rush = Math.max(0, speed);
    const back = Math.max(0, -speed);
    // Bigger waves are louder and brighter.
    const size = Math.min(1, front / 5);
    // Each wave swells as it runs up the beach and falls quiet between.
    glide(this.surf.gain, 0.025 + Math.min(0.7, rush * 0.4) + size * 0.08, this.ctx, 0.35);
    glide(this.surfTone.frequency, 500 + Math.min(1400, rush * 700) + size * 400, this.ctx, 0.4);
    // Foam fizzes on the rush and the backwash.
    glide(this.fizz.gain, (rushing ? Math.min(0.12, rush * 0.06) : 0) + Math.min(0.08, back * 0.05) * (0.4 + size), this.ctx, 0.3);
    glide(this.scratch.gain, Math.min(0.4, drawSpeed * 0.3), this.ctx, 0.06);
    glide(this.scratchTone.frequency, 1800 + Math.min(1600, drawSpeed * 900), this.ctx, 0.1);
  }
}
