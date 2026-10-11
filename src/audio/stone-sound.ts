import { gain, glide, loadSounds, loop, slice, type Soundscape } from './kit';

/** Where each hit starts in "Metal Hand Tools on Stone" (craigsmith, CC0), in seconds. */
const CHISEL_HITS = [0.085, 0.63, 1.005, 1.3, 1.815, 2.195, 2.56, 4.635, 7.555, 9.04, 10.505, 13.335, 13.945, 14.605, 14.945, 16.32, 17.08, 17.805, 20.605, 23.01, 24.5];

/**
 * A pebble shore in the morning, from recordings: calm water lapping the
 * pebbles, a tap of the chisel for each cut, and a stone set down on stone.
 */
export class StoneSound implements Soundscape {
  private readonly out: GainNode;
  private chisel: AudioBuffer | null = null;
  private setDown: AudioBuffer | null = null;
  private lastHit = -1;

  private constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.out = gain(ctx, 0);
    this.out.connect(destination);
  }

  static async create(ctx: BaseAudioContext, destination: AudioNode): Promise<StoneSound> {
    const s = new StoneSound(ctx, destination);
    const b = await loadSounds(ctx, ['pebble-shore', 'chisel', 'stone-set']);
    loop(ctx, b['pebble-shore'], s.out, 0.7);
    s.chisel = b.chisel;
    s.setDown = b['stone-set'];
    return s;
  }

  start(): void {
    glide(this.out.gain, 1, this.ctx, 2);
  }

  stop(): void {
    glide(this.out.gain, 0, this.ctx, 0.6);
  }

  /** One tap of the chisel. */
  tap(): void {
    if (!this.chisel) return;
    let i = Math.floor(Math.random() * CHISEL_HITS.length);
    if (i === this.lastHit) i = (i + 1) % CHISEL_HITS.length;
    this.lastHit = i;
    slice(this.ctx, this.chisel, this.out, {
      offset: Math.max(0, CHISEL_HITS[i]! - 0.004),
      duration: 0.28,
      level: 0.45 + Math.random() * 0.2,
      rate: 0.95 + Math.random() * 0.1,
      fadeIn: 0.002,
      fadeOut: 0.12,
    });
  }

  /** A stone set down on the cairn (or put back). */
  set(): void {
    if (this.setDown) slice(this.ctx, this.setDown, this.out, { level: 0.8, fadeOut: 0.1, rate: 0.9 + Math.random() * 0.15 });
  }
}
