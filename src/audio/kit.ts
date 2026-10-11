/**
 * Small building blocks for procedural sound: noise, filters, envelopes.
 * Everything takes a BaseAudioContext so it also renders offline for tests.
 */

export type NoiseColor = 'white' | 'pink' | 'brown';

const cache = new WeakMap<BaseAudioContext, Map<NoiseColor, AudioBuffer>>();

/** A few seconds of noise that loops without a click. Cached per context. */
export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor, seconds = 4): AudioBuffer {
  let byColor = cache.get(ctx);
  if (!byColor) {
    byColor = new Map();
    cache.set(ctx, byColor);
  }
  const hit = byColor.get(color);
  if (hit) return hit;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0,
      last = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'white') data[i] = w * 0.5;
      else if (color === 'pink') {
        // Paul Kellet's refined pink noise filter.
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.5;
      }
    }
    // Crossfade the ends so the loop is seamless.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[i]! * t + data[length - fade + i]! * (1 - t);
    }
  }
  byColor.set(color, buffer);
  return buffer;
}

/** A looping noise source, started at a random point so layers don't line up. */
export function loopNoise(ctx: BaseAudioContext, color: NoiseColor): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, color);
  src.loop = true;
  src.start(ctx.currentTime, Math.random() * src.buffer.duration);
  return src;
}

export function filter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, Q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  return f;
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

/** A short burst of filtered noise: a crackle, a pen stroke, a grain of sand. */
export function burst(
  ctx: BaseAudioContext,
  out: AudioNode,
  opts: { color?: NoiseColor; type?: BiquadFilterType; freq: number; Q?: number; level: number; attack?: number; decay: number; at?: number; pan?: number },
): void {
  const at = opts.at ?? ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, opts.color ?? 'white');
  const f = filter(ctx, opts.type ?? 'bandpass', opts.freq, opts.Q ?? 1);
  const g = gain(ctx, 0);
  const attack = opts.attack ?? 0.002;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(opts.level, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + opts.decay);
  let tail: AudioNode = g;
  if (opts.pan !== undefined && 'createStereoPanner' in ctx) {
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan;
    g.connect(p);
    tail = p;
  }
  src.connect(f).connect(g);
  tail.connect(out);
  src.start(at, Math.random() * (src.buffer.duration - 1));
  src.stop(at + attack + opts.decay + 0.05);
}

/** A soundscape a scene can start, steer each frame, and stop. */
export interface Soundscape {
  start(): void;
  stop(): void;
}
