import * as THREE from 'three/webgpu';
import { createRng } from '../strokes/random';

export const SKY_COLORS = {
  top: '#2f72c9',
  mid: '#5a9fe0',
  low: '#9fd3f2',
  horizon: '#dff3f7',
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
