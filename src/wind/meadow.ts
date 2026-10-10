import * as THREE from 'three/webgpu';
import { attribute, color, cos, float, mix, mx_noise_float, positionLocal, positionWorld, sin, smoothstep, texture, time, uniform, uv, vec3 } from 'three/tsl';
import { createRng } from '../strokes/random';

const floatUniform = () => uniform(0);
type FloatUniform = ReturnType<typeof floatUniform>;
type FloatNode = Parameters<typeof float>[0];

export const MEADOW_COLORS = {
  soil: '#3d7a45',
  grassDeep: '#2f6e3c',
  grassDark: '#3f8a4a',
  grassMid: '#5fae55',
  grassLight: '#a6d867',
  grassDry: '#c9d77a',
  dapple: '#eef7a6',
  sheen: '#d9f0a0',
  shade: '#2c5e3a',
};

/** Where the tree's shade falls on the meadow (x, z, radius). */
const TREE_SHADE = { x: -3.2, z: 0.5, r: 3.8 };

/**
 * The wave of wind rolling across the meadow at a point: a slow swell plus
 * the gust. The same function bends the grass and the flowers and puts a
 * sheen on the crests.
 */
function windWave(rootX: FloatNode, rootZ: FloatNode) {
  return sin(float(rootX).mul(0.55).add(float(rootZ).mul(0.22)).sub(time.mul(1.9))).mul(0.5).add(0.5);
}

function bendFor(flex: FloatNode, wave: FloatNode, gust: FloatUniform, phase: FloatNode) {
  const w = float(wave);
  const calm = w.mul(0.07).add(0.02);
  const blow = gust.mul(w.mul(0.12).add(0.3));
  const flutter = sin(time.mul(3.1).add(float(phase))).mul(0.018).mul(gust.mul(2).add(1));
  return calm.add(blow).add(flutter).mul(float(flex));
}

/** Thousands of curved blades in one geometry, each bending at its tip. */
export function makeGrass(gust: FloatUniform): THREE.Mesh {
  const rng = createRng(21);
  const blades = 12000;
  const LEVELS = 4;
  const vertsPer = LEVELS * 2 + 1;
  const pos = new Float32Array(blades * vertsPer * 3);
  const shade = new Float32Array(blades * vertsPer * 3);
  const flex = new Float32Array(blades * vertsPer);
  const root = new Float32Array(blades * vertsPer * 2);
  const phase = new Float32Array(blades * vertsPer);
  const index: number[] = [];
  const deep = new THREE.Color(MEADOW_COLORS.grassDeep);
  const dark = new THREE.Color(MEADOW_COLORS.grassDark);
  const midC = new THREE.Color(MEADOW_COLORS.grassMid);
  const light = new THREE.Color(MEADOW_COLORS.grassLight);
  const dry = new THREE.Color(MEADOW_COLORS.grassDry);

  for (let b = 0; b < blades; b++) {
    // Denser close by; from right in front of you out toward the hills.
    const z = 4.4 - Math.pow(rng(), 1.5) * 15;
    const x = (rng() - 0.5) * (15 + (4.4 - z) * 1.5);
    const near = Math.max(0, Math.min(1, (z + 2) / 6));
    const h = (0.2 + rng() * 0.34) * (1 + near * 0.6);
    const w = (0.018 + rng() * 0.02) * (1 + near * 0.5);
    const lean = (rng() - 0.3) * 0.5;
    const turn = rng() * Math.PI * 2;
    const tip = midC.clone().lerp(light, 0.3 + rng() * 0.7);
    if (rng() < 0.08) tip.lerp(dry, 0.7);
    const baseCol = deep.clone().lerp(dark, rng());
    const ph = rng() * Math.PI * 2;
    const o = b * vertsPer;
    for (let k = 0; k <= LEVELS; k++) {
      const s = k / LEVELS;
      const y = h * s;
      // Curve over toward the lean direction as the blade rises.
      const off = lean * h * s * s;
      const cx = x + Math.cos(turn) * off * 0.3 + off;
      const cz = z + Math.sin(turn) * off * 0.3;
      const half = w * Math.pow(1 - s, 0.7) * 0.5;
      const col = baseCol.clone().lerp(tip, Math.pow(s, 0.8));
      const verts = k < LEVELS ? [cx - half, cx + half] : [cx];
      verts.forEach((vx, side) => {
        const v = o + (k < LEVELS ? k * 2 + side : LEVELS * 2);
        pos.set([vx, y, cz + (side - 0.5) * half * 0.4], v * 3);
        shade.set([col.r, col.g, col.b], v * 3);
        flex[v] = Math.pow(s, 1.6) * h * 2.4;
        root.set([x, z], v * 2);
        phase[v] = ph;
      });
    }
    for (let k = 0; k < LEVELS - 1; k++) {
      const a = o + k * 2;
      index.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const a = o + (LEVELS - 1) * 2;
    index.push(a, a + 1, o + LEVELS * 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('shade', new THREE.BufferAttribute(shade, 3));
  geo.setAttribute('flex', new THREE.BufferAttribute(flex, 1));
  geo.setAttribute('root', new THREE.BufferAttribute(root, 2));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setIndex(index);

  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const r = attribute('root', 'vec2');
  const fl = attribute('flex', 'float');
  const wave = windWave(r.x, r.y);
  const bend = bendFor(fl, wave, gust, attribute('phase', 'float'));
  m.positionNode = positionLocal.add(vec3(bend, bend.mul(bend).mul(-0.6), cos(time.mul(1.3).add(attribute('phase', 'float'))).mul(0.012).mul(fl)));
  // Sheen on the crest of each wave of wind, dappled light from the leaves, and the tree's shade.
  const sheen = wave.mul(fl).mul(0.25);
  const dapple = smoothstep(0.35, 0.6, mx_noise_float(vec3(positionWorld.x.mul(0.9), positionWorld.z.mul(0.9), time.mul(0.15))));
  const dx = r.x.sub(TREE_SHADE.x);
  const dz = r.y.sub(TREE_SHADE.z);
  const inShade = float(1).sub(smoothstep(TREE_SHADE.r * 0.6, TREE_SHADE.r, dx.mul(dx).add(dz.mul(dz)).sqrt()));
  let col = mix(attribute('shade', 'vec3'), color(MEADOW_COLORS.sheen), sheen);
  col = mix(col, color(MEADOW_COLORS.dapple), dapple.mul(0.3));
  col = mix(col, color(MEADOW_COLORS.shade), inShade.mul(0.45).mul(float(1).sub(dapple.mul(0.6))));
  m.colorNode = col;
  return new THREE.Mesh(geo, m);
}

function flowerAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  // Daisy.
  ctx.fillStyle = '#fffdf6';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(64 + Math.cos(a) * 26, 64 + Math.sin(a) * 26, 22, 8, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#f2c230';
  ctx.beginPath();
  ctx.arc(64, 64, 15, 0, Math.PI * 2);
  ctx.fill();
  // Buttercup.
  ctx.fillStyle = '#f7d43a';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(192 + Math.cos(a) * 18, 64 + Math.sin(a) * 18, 18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#e09a1c';
  ctx.beginPath();
  ctx.arc(192, 64, 9, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Small flowers scattered through the grass, nodding with the same wind. */
export function makeFlowers(gust: FloatUniform): THREE.Mesh {
  const rng = createRng(77);
  const count = 260;
  const pos = new Float32Array(count * 4 * 3);
  const uvs = new Float32Array(count * 4 * 2);
  const root = new Float32Array(count * 4 * 2);
  const flex = new Float32Array(count * 4);
  const index: number[] = [];
  for (let i = 0; i < count; i++) {
    // Mostly close by; far away they would only read as specks.
    const z = 3.8 - Math.pow(rng(), 2.2) * 9;
    const x = (rng() - 0.5) * (14 + (3.8 - z) * 1.4);
    // Flowers grow in little patches.
    const near = Math.max(0, Math.min(1, (z + 2) / 6));
    const size = (0.05 + rng() * 0.04) * (1 + near * 0.5);
    const y = 0.18 + rng() * 0.25;
    const variant = rng() < 0.65 ? 0 : 1;
    const corners = [
      [x - size, y - size * 0.6, z],
      [x + size, y - size * 0.6, z],
      [x + size, y + size * 0.6, z - size * 0.3],
      [x - size, y + size * 0.6, z - size * 0.3],
    ];
    corners.forEach((p, k) => {
      const v = i * 4 + k;
      pos.set(p, v * 3);
      uvs.set([variant * 0.5 + (k === 1 || k === 2 ? 0.5 : 0), k < 2 ? 0 : 1], v * 2);
      root.set([x, z], v * 2);
      flex[v] = y * 1.6;
    });
    const o = i * 4;
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('root', new THREE.BufferAttribute(root, 2));
  geo.setAttribute('flex', new THREE.BufferAttribute(flex, 1));
  geo.setIndex(index);
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
  const r = attribute('root', 'vec2');
  const bend = bendFor(attribute('flex', 'float'), windWave(r.x, r.y), gust, r.x.mul(3.1));
  m.positionNode = positionLocal.add(vec3(bend, 0, 0));
  const tex = texture(flowerAtlas(), uv());
  m.colorNode = tex.rgb;
  m.opacityNode = tex.a;
  return new THREE.Mesh(geo, m);
}

/** The ground between the blades, with dappled light and the tree's shade. */
export function makeGround(): THREE.Mesh {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshBasicNodeMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -20;
  const dapple = smoothstep(0.3, 0.6, mx_noise_float(vec3(positionWorld.x.mul(0.6), positionWorld.z.mul(0.6), time.mul(0.12))));
  const patches = mx_noise_float(vec3(positionWorld.x.mul(0.15), positionWorld.z.mul(0.15), 9)).mul(0.5).add(0.5);
  const base = mix(color(MEADOW_COLORS.grassDeep), color(MEADOW_COLORS.grassMid), smoothstep(-2, -14, positionWorld.z).mul(0.7).add(patches.mul(0.3)));
  (ground.material as THREE.MeshBasicNodeMaterial).colorNode = mix(base, color(MEADOW_COLORS.dapple), dapple.mul(0.18));
  return ground;
}
