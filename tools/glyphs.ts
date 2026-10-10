// Dev-only glyph sheet: open http://localhost:5199/tools/glyphs.html while `npm run dev` is running.
import fontData from '../src/strokes/fonts/ems-allure.json';
import { StrokeFont, type StrokeFontData } from '../src/strokes/glyphs';
import { DEFAULT_LAYOUT, SandLayout } from '../src/strokes/layout';
import { createRng } from '../src/strokes/random';
import { DEFAULT_WRITER, SandWriter } from '../src/strokes/writer';
import type { Vec2 } from '../src/strokes/types';

const font = new StrokeFont(fontData as StrokeFontData);
const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,!?';

function drawStroke(ctx: CanvasRenderingContext2D, pts: Vec2[], map: (p: Vec2) => Vec2, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = map(p);
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  });
  ctx.stroke();
  const s = map(pts[0]!);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  // Arrowhead at the end shows direction.
  const a = map(pts[pts.length - 2] ?? pts[0]!);
  const b = map(pts[pts.length - 1]!);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - 9 * Math.cos(ang - 0.4), b.y - 9 * Math.sin(ang - 0.4));
  ctx.lineTo(b.x - 9 * Math.cos(ang + 0.4), b.y - 9 * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

function drawSheet() {
  const canvas = document.getElementById('sheet') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cols = 10;
  const cellW = canvas.width / cols;
  const cellH = 150;
  const scale = 0.12;
  chars.split('').forEach((ch, idx) => {
    const g = font.get(ch);
    if (!g) return;
    const cx = (idx % cols) * cellW + 30;
    const cy = Math.floor(idx / cols) * cellH + 110;
    ctx.fillStyle = '#9a8a78';
    ctx.font = '16px Georgia';
    ctx.fillText(ch, cx - 22, cy - 80);
    ctx.strokeStyle = '#e6dccd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy);
    ctx.lineTo(cx + cellW - 40, cy);
    ctx.stroke();
    const map = (p: Vec2) => ({ x: cx + p.x * scale, y: cy - p.y * scale });
    g.strokes.forEach((s, i) => {
      const t = g.strokes.length > 1 ? i / (g.strokes.length - 1) : 0;
      drawStroke(ctx, s, map, `hsl(${210 - t * 90}, 60%, 40%)`);
    });
    g.deferred.forEach((s) => drawStroke(ctx, s, map, '#c0392b'));
    ctx.fillStyle = g.joinsIn && g.joinsOut ? '#2e7d32' : '#9a8a78';
    ctx.font = '11px Georgia';
    ctx.fillText(`${g.joinsIn ? 'in' : '–'} ${g.joinsOut ? 'out' : '–'}`, cx + cellW - 90, cy - 80);
  });
}

function drawLine(text: string) {
  const canvas = document.getElementById('line') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const o = DEFAULT_LAYOUT;
  const k = canvas.width / (o.width + 0.4);
  const map = (x: number, y: number) => ({ x: (x - o.left + 0.2) * k, y: (o.firstBaseline + 0.45 - y) * k });
  let order = 0;
  const writer = new SandWriter(new SandLayout(font, o, createRng(9)), DEFAULT_WRITER, {
    stamp(x0, y0, p0, x1, y1) {
      const a = map(x0, y0);
      const b = map(x1, y1);
      ctx.strokeStyle = `hsl(${(order++ / 40) % 360}, 45%, 35%)`;
      ctx.lineWidth = 1 + p0 * 2.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    },
    wipe() {},
  });
  for (const ch of text) writer.type(ch);
  let guard = 0;
  while (writer.busy && guard++ < 60 * 120) writer.update(1 / 60);
}

drawSheet();
const input = document.getElementById('sample') as HTMLInputElement;
input.addEventListener('input', () => drawLine(input.value));
drawLine(input.value);
