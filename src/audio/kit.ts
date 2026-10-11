/**
 * Building blocks for playing recorded sounds: loading, loops and slices.
 * Everything takes a BaseAudioContext so it also renders offline for checks.
 */

const cache = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer>>>();

/** Loads `public/sounds/<name>.m4a` once per context. */
export function loadSound(ctx: BaseAudioContext, name: string): Promise<AudioBuffer> {
  let byName = cache.get(ctx);
  if (!byName) {
    byName = new Map();
    cache.set(ctx, byName);
  }
  let p = byName.get(name);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}sounds/${name}.m4a`)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load sound ${name}`);
        return r.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes));
    byName.set(name, p);
  }
  return p;
}

export async function loadSounds<const N extends string>(ctx: BaseAudioContext, names: readonly N[]): Promise<Record<N, AudioBuffer>> {
  const buffers = await Promise.all(names.map((n) => loadSound(ctx, n)));
  return Object.fromEntries(names.map((n, i) => [n, buffers[i]])) as Record<N, AudioBuffer>;
}

export function gain(ctx: BaseAudioContext, value = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Glides a parameter toward a value; `time` is roughly how long it takes (s). */
export function glide(param: AudioParam, value: number, ctx: BaseAudioContext, time = 0.1): void {
  param.setTargetAtTime(value, ctx.currentTime, Math.max(0.005, time / 3));
}

/** A recording playing on a loop through its own gain, starting at a random point. */
export function loop(ctx: BaseAudioContext, buffer: AudioBuffer, out: AudioNode, level = 0): { source: AudioBufferSourceNode; gain: GainNode } {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const g = gain(ctx, level);
  source.connect(g).connect(out);
  source.start(ctx.currentTime, Math.random() * buffer.duration);
  return { source, gain: g };
}

/** Plays part of a recording once, with soft edges. */
export function slice(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  out: AudioNode,
  opts: { offset?: number; duration?: number; level?: number; rate?: number; fadeIn?: number; fadeOut?: number; at?: number; pan?: number } = {},
): void {
  const at = opts.at ?? ctx.currentTime;
  const offset = opts.offset ?? 0;
  const duration = Math.min(opts.duration ?? buffer.duration - offset, buffer.duration - offset);
  const rate = opts.rate ?? 1;
  const length = duration / rate;
  const fadeIn = Math.min(opts.fadeIn ?? 0.005, length / 2);
  const fadeOut = Math.min(opts.fadeOut ?? 0.02, length / 2);
  const level = opts.level ?? 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const g = gain(ctx, 0);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + fadeIn);
  g.gain.setValueAtTime(level, at + length - fadeOut);
  g.gain.linearRampToValueAtTime(0, at + length);
  let tail: AudioNode = g;
  if (opts.pan !== undefined && 'createStereoPanner' in ctx) {
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan;
    g.connect(p);
    tail = p;
  }
  source.connect(g);
  tail.connect(out);
  source.start(at, offset, duration);
}

/** A soundscape a scene can start and stop. */
export interface Soundscape {
  start(): void;
  stop(): void;
}
