import * as THREE from 'three/webgpu';
import { createRng } from '../strokes/random';

export const SKY_COLORS = {
  top: '#2f72c9',
  mid: '#5a9fe0',
  low: '#9fd3f2',
  horizon: '#dff3f7',
  cloudLit: '#ffffff',
  cloudBody: '#eef3fb',
  cloudShade: '#bfcbe8',
  cloudDeep: '#a6b4dc',
  mountain: '#a9c9d8',
  hillFar: '#8cc6a4',
  hillMid: '#74b886',
  hillNear: '#5ea86f',
  treeFar: '#6aa98a',
  treeNear: '#4b9563',
};

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function skyTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(4, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, SKY_COLORS.top);
    g.addColorStop(0.3, SKY_COLORS.mid);
    g.addColorStop(0.44, SKY_COLORS.low);
    g.addColorStop(0.5, SKY_COLORS.horizon);
    g.addColorStop(1, SKY_COLORS.hillNear);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 512);
  });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/** A soft round puff: solid in the middle, fading at the edge, so puffs blend like paint. */
function puff(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, alpha = 1): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(0.72, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

const rgbOf = (hex: string) => {
  const c = new THREE.Color(hex);
  return `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
};

/**
 * A painted cumulus: a dome of puffs on a flat base, shaded lavender-blue
 * underneath and bright where the sun catches the top.
 */
export function cloudTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  return canvasTexture(1024, 512, (ctx) => {
    const base = 360;
    const puffs: { x: number; y: number; r: number }[] = [];
    const n = 16 + Math.floor(rng() * 8);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = 140 + t * 740 + (rng() - 0.5) * 40;
      const dome = Math.sin(t * Math.PI);
      const r = 42 + dome * (60 + rng() * 55);
      const y = base - r * 0.55 - dome * (40 + rng() * 70);
      puffs.push({ x, y, r });
    }
    // A second, smaller row on top for a lumpy crown.
    for (let i = 0; i < 6; i++) {
      const p = puffs[3 + Math.floor(rng() * (n - 6))]!;
      puffs.push({ x: p.x + (rng() - 0.5) * 60, y: p.y - p.r * 0.55, r: p.r * (0.55 + rng() * 0.25) });
    }
    const deep = rgbOf(SKY_COLORS.cloudDeep);
    const shadeC = rgbOf(SKY_COLORS.cloudShade);
    const body = rgbOf(SKY_COLORS.cloudBody);
    const lit = rgbOf(SKY_COLORS.cloudLit);
    for (const p of puffs) puff(ctx, p.x + 8, p.y + 18, p.r, deep, 0.45);
    for (const p of puffs) puff(ctx, p.x + 4, p.y + 10, p.r * 0.97, shadeC);
    for (const p of puffs) puff(ctx, p.x - 2, p.y - 2, p.r * 0.9, body);
    for (const p of puffs) puff(ctx, p.x - 12, p.y - 16, p.r * 0.62, lit);
    // A soft, flat base rather than a cut.
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createLinearGradient(0, base - 12, 0, base + 46);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, base - 12, 1024, 512 - base + 12);
  });
}

/** Thin high streaks of cirrus. */
export function wispTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  return canvasTexture(1024, 256, (ctx) => {
    for (let i = 0; i < 9; i++) {
      const y = 70 + rng() * 120;
      const x = 80 + rng() * 860;
      const len = 180 + rng() * 360;
      const g = ctx.createLinearGradient(x - len / 2, 0, x + len / 2, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${0.35 + rng() * 0.3})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, len / 2, 3 + rng() * 5, (rng() - 0.5) * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** A hill silhouette, optionally with a line of round trees along its top. */
export function hillTexture(fill: string, seed: number, height: number, trees: string | null): THREE.CanvasTexture {
  const rng = createRng(seed);
  return canvasTexture(2048, 512, (ctx) => {
    const bumps = Array.from({ length: 6 }, () => ({ a: 0.4 + rng() * 0.6, p: rng() * 6 }));
    const ridge = (x: number) => {
      let y = 0;
      bumps.forEach((b, i) => (y += Math.sin((x / 2048) * Math.PI * (i + 1) + b.p) * b.a));
      return 512 - height - y * 46;
    };
    if (trees) {
      for (let x = 0; x < 2048; x += 14 + rng() * 40) {
        if (rng() < 0.35) continue;
        const r = 10 + rng() * 18;
        const y = ridge(x);
        ctx.fillStyle = trees;
        ctx.beginPath();
        ctx.arc(x, y - r * 0.6, r, 0, Math.PI * 2);
        ctx.arc(x + r * 0.6, y - r * 0.3, r * 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, 512);
    for (let x = 0; x <= 2048; x += 8) ctx.lineTo(x, ridge(x));
    ctx.lineTo(2048, 512);
    ctx.closePath();
    ctx.fill();
  });
}
