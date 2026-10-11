// Dev-only: open http://localhost:5199/tools/sound-check.html while `npm run dev` is running.
import { FireSound } from '../src/audio/fire-sound';
import { OceanSound } from '../src/audio/ocean-sound';
import { WindSound } from '../src/audio/wind-sound';
import { Tide } from '../src/sand/tide';

const RATE = 44100;
const STEP = 1 / 30;

type Script = { name: string; seconds: number; make(ctx: BaseAudioContext, out: AudioNode): (t: number, dt: number) => void };

const scripts: Script[] = [
  {
    name: 'ocean: waves, then drawing in the sand from 6 s to 9 s',
    seconds: 16,
    make(ctx, out) {
      const s = new OceanSound(ctx, out);
      const tide = new Tide(3, { gapMin: 0.3, gapMax: 1, bigChanceCalm: 0.5, bigChanceSwell: 0.5, bigReachMin: 3, bigReachMax: 5, swellPeriod: 40, writingLull: 1 });
      s.start();
      return (t, dt) => {
        tide.update(dt);
        s.update(dt, tide.level, tide.rushing, t > 6 && t < 9 ? 1 + Math.sin(t * 6) * 0.6 : 0);
      };
    },
  },
  {
    name: 'wind: calm with birds, the wind takes the words at 7 s',
    seconds: 16,
    make(ctx, out) {
      const s = new WindSound(ctx, out);
      s.start();
      let gust = 0;
      let blown = false;
      return (t, dt) => {
        if (t > 7 && !blown) {
          blown = true;
          s.whoosh();
        }
        const target = t > 7 && t < 11 ? 1 : 0;
        gust += (target - gust) * (1 - Math.exp(-dt * (target > gust ? 2.5 : 0.8)));
        s.update(dt, gust);
      };
    },
  },
  {
    name: 'fire: writing 1-3 s, lit at 4 s, burning 5-15 s',
    seconds: 18,
    make(ctx, out) {
      const s = new FireSound(ctx, out);
      s.start();
      let next = 1;
      let lit = false;
      return (t, dt) => {
        if (t > 1 && t < 3 && t > next) {
          s.penStroke();
          next = t + 0.12 + Math.random() * 0.1;
        }
        if (t > 4 && !lit) {
          lit = true;
          s.ignite();
        }
        const burning = t < 4.5 ? 0 : t < 6 ? (t - 4.5) / 1.5 : t < 14 ? 1 : Math.max(0, 1 - (t - 14) / 1.5);
        s.update(dt, burning, 1 + 0.06 * Math.sin(t * 13));
      };
    },
  },
];

async function render(script: Script): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.floor(RATE * script.seconds), RATE);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const step = script.make(ctx, out);
  // Pause rendering every frame to steer the soundscape, as the scene would.
  for (let t = STEP; t < script.seconds; t += STEP) {
    const at = t;
    ctx.suspend(at).then(() => {
      step(at, STEP);
      void ctx.resume();
    });
  }
  return ctx.startRendering();
}

function analyse(buf: AudioBuffer) {
  const data = buf.getChannelData(0);
  const win = Math.floor(RATE * 0.5);
  const rms: number[] = [];
  let peak = 0;
  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0;
    for (let k = i; k < i + win; k++) {
      sum += data[k]! * data[k]!;
      peak = Math.max(peak, Math.abs(data[k]!));
    }
    rms.push(Math.sqrt(sum / win));
  }
  return { rms, peak };
}

function draw(buf: AudioBuffer, label: string): void {
  const out = document.getElementById('out')!;
  const title = document.createElement('div');
  const { rms, peak } = analyse(buf);
  title.textContent = `${label} | peak ${peak.toFixed(3)} | rms per 0.5 s: ${rms.map((r) => r.toFixed(3)).join(' ')}`;
  out.append(title);
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 160;
  out.append(canvas);
  const c = canvas.getContext('2d')!;
  // Spectrogram with a simple DFT on a few bands: low at the bottom, high at the top.
  const data = buf.getChannelData(0);
  const cols = 300;
  const bands = [80, 160, 320, 640, 1280, 2560, 5120, 10240];
  const hop = Math.floor(data.length / cols);
  const N = 1024;
  for (let x = 0; x < cols; x++) {
    const start = x * hop;
    bands.forEach((f, b) => {
      let re = 0;
      let im = 0;
      for (let n = 0; n < N && start + n < data.length; n++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N);
        const v = data[start + n]! * w;
        const a = (2 * Math.PI * f * n) / RATE;
        re += v * Math.cos(a);
        im -= v * Math.sin(a);
      }
      const mag = Math.sqrt(re * re + im * im) / N;
      const db = 20 * Math.log10(mag + 1e-9);
      const v = Math.max(0, Math.min(1, (db + 80) / 60));
      c.fillStyle = `hsl(${40 + (1 - v) * 200}, 80%, ${v * 60}%)`;
      c.fillRect(x * 3, 160 - (b + 1) * 20, 3, 20);
    });
  }
  (window as unknown as { results?: object[] }).results ??= [];
  (window as unknown as { results: object[] }).results.push({ label, peak, rms });
}

async function main() {
  for (const s of scripts) draw(await render(s), s.name);
  document.title = 'done';
  const buttons = document.getElementById('buttons')!;
  for (const s of scripts) {
    const b = document.createElement('button');
    b.textContent = `Play ${s.name.split(':')[0]}`;
    b.addEventListener('click', async () => {
      const buf = await render(s);
      const ctx = new AudioContext();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    });
    buttons.append(b);
  }
}
void main();
