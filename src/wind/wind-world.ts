import * as THREE from 'three/webgpu';
import {
  attribute,
  color,
  cos,
  mix,
  mx_noise_float,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import { createRng } from '../strokes/random';
import { HAND_STACK } from '../text/font';
import { wrapText } from '../text/wrap';
import { allGone, liftDelays, makeFlier, stepFliers, type Flier } from './flight';

/** A sunny afternoon under a tree. Painted, like the ocean scene. */
const PALETTE = {
  skyTop: '#2f72c9',
  skyMid: '#5a9fe0',
  skyLow: '#9fd3f2',
  horizon: '#dff3f7',
  hillFar: '#8cc6a4',
  hillNear: '#63ad73',
  grassDark: '#3f8a4a',
  grassMid: '#5fae55',
  grassLight: '#a6d867',
  dapple: '#e9f59a',
  leafDark: '#2e6a3c',
  leafMid: '#4b9646',
  leafLit: '#b6e070',
  bark: '#6b4a3a',
  barkDark: '#4a3129',
  ink: '#fffaf0',
};

const SUN_AT = new THREE.Vector3(9.5, 13, -20);

const floatUniform = () => uniform(0);
type FloatUniform = ReturnType<typeof floatUniform>;
const TEXT_CENTER = new THREE.Vector3(0, 2.25, 0);

function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, PALETTE.skyTop);
  g.addColorStop(0.3, PALETTE.skyMid);
  g.addColorStop(0.44, PALETTE.skyLow);
  g.addColorStop(0.5, PALETTE.horizon);
  g.addColorStop(1, PALETTE.hillNear);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft, flat-bottomed cumulus with a lilac-blue underside. */
function cloudTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  return canvasTexture(512, 256, (ctx) => {
    const puffs = Array.from({ length: 9 }, (_, i) => ({
      x: 90 + i * 40 + rng() * 30,
      y: 150 - Math.sin((i / 8) * Math.PI) * (50 + rng() * 40),
      r: 40 + rng() * 45,
    }));
    ctx.fillStyle = 'rgba(205,222,245,0.95)';
    for (const p of puffs) {
      ctx.beginPath();
      ctx.arc(p.x, p.y + 10, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,1)';
    for (const p of puffs) {
      ctx.beginPath();
      ctx.arc(p.x - 4, p.y, p.r * 0.92, 0, Math.PI * 2);
      ctx.fill();
    }
    // Flat base.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(0, 186, 512, 70);
  });
}

function hillTexture(fill: string, seed: number, height: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  return canvasTexture(1024, 256, (ctx) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, 256);
    const bumps = Array.from({ length: 5 }, () => ({ a: 0.4 + rng() * 0.6, p: rng() * 6 }));
    for (let x = 0; x <= 1024; x += 8) {
      let y = 0;
      bumps.forEach((b, i) => (y += Math.sin((x / 1024) * Math.PI * (i + 1) + b.p) * b.a));
      ctx.lineTo(x, 256 - height - y * 26);
    }
    ctx.lineTo(1024, 256);
    ctx.closePath();
    ctx.fill();
  });
}

function glowTexture(stops: [number, string][]): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [at, c] of stops) g.addColorStop(at, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
}

/** Builds the meadow: one geometry holding thousands of blades that sway at their tips. */
function makeGrass(gust: FloatUniform): THREE.Mesh {
  const rng = createRng(21);
  const count = 9000;
  const pos = new Float32Array(count * 9);
  const tip = new Float32Array(count * 3);
  const phase = new Float32Array(count * 3);
  const shade = new Float32Array(count * 9);
  const cols = [PALETTE.grassDark, PALETTE.grassMid, PALETTE.grassLight].map((c) => new THREE.Color(c));
  for (let i = 0; i < count; i++) {
    // From right in front of you (tall screens see further down) out to the hills.
    const z = 4.4 - Math.pow(rng(), 1.5) * 15;
    const x = (rng() - 0.5) * (14 + (2.4 - z) * 1.6);
    const h = (0.18 + rng() * 0.32) * (1 + Math.max(0, z) * 0.1);
    const w = 0.025 + rng() * 0.03;
    const lean = (rng() - 0.5) * 0.12;
    const o = i * 9;
    pos.set([x - w, 0, z, x + w, 0, z, x + lean, h, z + (rng() - 0.5) * 0.04], o);
    tip.set([0, 0, h], i * 3);
    const ph = rng() * Math.PI * 2;
    phase.set([ph, ph, ph], i * 3);
    const base = cols[0]!.clone().lerp(cols[1]!, rng() * 0.7);
    const top = cols[1]!.clone().lerp(cols[2]!, 0.3 + rng() * 0.7);
    shade.set([base.r, base.g, base.b, base.r, base.g, base.b, top.r, top.g, top.b], o);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('shade', new THREE.BufferAttribute(shade, 3));

  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const t = attribute('tip', 'float');
  const ph = attribute('phase', 'float');
  const breeze = sin(time.mul(1.7).add(ph)).mul(0.05);
  const push = gust.mul(0.28).add(gust.mul(sin(time.mul(7).add(ph))).mul(0.06));
  m.positionNode = positionLocal.add(vec3(breeze.add(push), push.mul(-0.25), cos(time.mul(1.3).add(ph)).mul(0.02)).mul(t.mul(2.2)));
  const dapple = smoothstep(0.35, 0.6, mx_noise_float(vec3(positionWorld.x.mul(0.9), positionWorld.z.mul(0.9), time.mul(0.15))));
  m.colorNode = mix(attribute('shade', 'vec3'), color(PALETTE.dapple), dapple.mul(0.35));
  return new THREE.Mesh(geo, m);
}

/** Leaf clusters along the branches: diamonds in three greens, the ones toward the sun lit through. */
function makeCanopy(gust: FloatUniform): THREE.Mesh {
  const rng = createRng(5);
  const clusters: THREE.Vector3[] = [];
  // Along a few branch curves sweeping in from the trunk at the left.
  for (let b = 0; b < 5; b++) {
    const y0 = 3.2 + b * 0.32;
    for (let k = 0; k < 9; k++) {
      const t = k / 8;
      clusters.push(new THREE.Vector3(-3.8 + t * (7.5 - b * 0.4), y0 + Math.sin(t * Math.PI) * 0.6 + rng() * 0.3, 0.6 + rng() * 1.6));
    }
  }
  const perCluster = 70;
  const leaves = clusters.length * perCluster;
  const pos = new Float32Array(leaves * 6 * 3);
  const phase = new Float32Array(leaves * 6);
  const sway = new Float32Array(leaves * 6);
  const shade = new Float32Array(leaves * 6 * 3);
  const dark = new THREE.Color(PALETTE.leafDark);
  const mid = new THREE.Color(PALETTE.leafMid);
  const lit = new THREE.Color(PALETTE.leafLit);
  const sunDir = SUN_AT.clone().normalize();
  let v = 0;
  for (const c of clusters) {
    for (let i = 0; i < perCluster; i++) {
      const r = 0.55 * Math.cbrt(rng());
      const a = rng() * Math.PI * 2;
      const e = (rng() - 0.5) * Math.PI;
      const center = new THREE.Vector3(c.x + Math.cos(a) * Math.cos(e) * r * 1.4, c.y + Math.sin(e) * r * 0.8, c.z + Math.sin(a) * r);
      const size = 0.09 + rng() * 0.09;
      const rot = rng() * Math.PI;
      const ux = Math.cos(rot) * size;
      const uy = Math.sin(rot) * size;
      const vx = -uy * 0.45;
      const vy = ux * 0.45;
      const tipA = [center.x + ux, center.y + uy, center.z];
      const tipB = [center.x - ux, center.y - uy, center.z];
      const sideA = [center.x + vx, center.y + vy, center.z + 0.01];
      const sideB = [center.x - vx, center.y - vy, center.z - 0.01];
      // Brighter toward the sun and on the cluster's sunny side.
      const facing = center.clone().sub(c).normalize().dot(sunDir);
      const toward = THREE.MathUtils.clamp((center.x + 4) / 9, 0, 1);
      const col = dark.clone().lerp(mid, 0.3 + rng() * 0.5);
      if (facing > 0.1 && rng() < 0.35 + toward * 0.45) col.lerp(lit, 0.6 + rng() * 0.4);
      const ph = rng() * Math.PI * 2 + c.x;
      const amp = 0.4 + rng() * 0.6;
      for (const p of [tipA, sideA, tipB, tipA, tipB, sideB]) {
        pos.set(p, v * 3);
        shade.set([col.r, col.g, col.b], v * 3);
        phase[v] = ph;
        sway[v] = amp;
        v++;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  geo.setAttribute('shade', new THREE.BufferAttribute(shade, 3));
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const ph = attribute('phase', 'float');
  const amp = attribute('sway', 'float').mul(gust.mul(0.09).add(0.022));
  m.positionNode = positionLocal.add(
    vec3(sin(time.mul(1.4).add(ph)).mul(amp).add(gust.mul(0.08)), cos(time.mul(1.9).add(ph)).mul(amp).mul(0.6), 0),
  );
  // Leaves twinkle between shade and light as they move.
  const flick = smoothstep(0.55, 0.9, sin(time.mul(2.3).add(ph.mul(3))).mul(0.5).add(0.5)).mul(0.18);
  m.colorNode = mix(attribute('shade', 'vec3'), color(PALETTE.leafLit), flick);
  return new THREE.Mesh(geo, m);
}

function makeTree(): THREE.Group {
  const group = new THREE.Group();
  const bark = new THREE.MeshBasicNodeMaterial();
  // Lit from the sun's side (right), in two tones.
  bark.colorNode = mix(color(PALETTE.barkDark), color(PALETTE.bark), smoothstep(-0.1, 0.25, positionLocal.x));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.4, 6, 12), bark);
  trunk.position.set(-4.1, 2.6, 1.2);
  trunk.rotation.z = -0.06;
  group.add(trunk);
  const branches: [number, number, number, number, number][] = [
    [-3.9, 3.3, 1.0, 3.6, 0.07],
    [-3.9, 3.8, 1.4, 4.0, 0.055],
    [-4.0, 4.3, 0.8, 3.4, 0.05],
  ];
  for (const [x, y, z, len, r] of branches) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r, len, 8), bark);
    b.position.set(x + len / 2, y + 0.3, z);
    b.rotation.z = -Math.PI / 2 + 0.18;
    group.add(b);
  }
  return group;
}

/** Light shafts falling from the sun through the leaves. */
function makeShafts(): THREE.Group {
  const group = new THREE.Group();
  const tex = canvasTexture(64, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, 'rgba(255,250,215,0.55)');
    g.addColorStop(0.6, 'rgba(255,250,215,0.18)');
    g.addColorStop(1, 'rgba(255,250,215,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 512);
    const side = ctx.createLinearGradient(0, 0, 64, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)');
    side.addColorStop(0.5, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, 64, 512);
  });
  const rng = createRng(13);
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 + rng() * 0.3, fog: false });
    const w = 0.35 + rng() * 0.7;
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(w, 9), mat);
    shaft.geometry.translate(0, -4.5, 0);
    shaft.position.set(2.2 + i * 0.7 + rng() * 0.4, 4.6, -0.6 - rng());
    shaft.rotation.z = -0.55 - rng() * 0.12;
    shaft.userData.phase = rng() * 10;
    shaft.userData.base = mat.opacity;
    group.add(shaft);
  }
  return group;
}

interface Glyph {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  born: number;
  material: THREE.MeshBasicMaterial;
}

export class WindWorld {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  private readonly gust = floatUniform();
  private gustTarget = 0;
  private readonly clouds: THREE.Mesh[] = [];
  private readonly shafts: THREE.Group;
  private readonly motes: THREE.Sprite[] = [];
  private readonly textGroup = new THREE.Group();
  private glyphs: Glyph[] = [];
  private readonly glyphCache = new Map<string, THREE.CanvasTexture>();
  private fliers: Flier[] = [];
  private leafFliers: { flier: Flier; mesh: THREE.Mesh }[] = [];
  private readonly leafMat: THREE.MeshBasicMaterial;
  private clock = 0;
  private text = '';
  /** Width of the block of words (world units); narrower on tall screens. */
  private textWidth = 6;
  private readonly measureCtx = document.createElement('canvas').getContext('2d')!;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(PALETTE.horizon, 18, 90);
    this.camera.position.set(0, 1.2, 6);
    this.camera.lookAt(0, 2.2, 0);

    // Sun with a stepped glow, peeking through the canopy.
    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture([
          [0, 'rgba(255,255,240,1)'],
          [0.12, 'rgba(255,255,235,1)'],
          [0.14, 'rgba(255,250,210,0.45)'],
          [0.32, 'rgba(255,250,210,0.18)'],
          [0.6, 'rgba(255,250,210,0.06)'],
          [1, 'rgba(255,250,210,0)'],
        ]),
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    sun.position.copy(SUN_AT);
    sun.scale.setScalar(16);
    this.scene.add(sun);

    for (let i = 0; i < 5; i++) {
      const tex = cloudTexture(100 + i * 17);
      const cloud = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 7),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }),
      );
      cloud.position.set(-26 + i * 13, 8 + (i % 3) * 3.2, -40 - (i % 2) * 8);
      cloud.scale.setScalar(0.8 + (i % 3) * 0.25);
      this.clouds.push(cloud);
      this.scene.add(cloud);
    }

    const far = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 35),
      new THREE.MeshBasicMaterial({ map: hillTexture(PALETTE.hillFar, 3, 70), transparent: true, depthWrite: false }),
    );
    far.position.set(0, 4, -45);
    const near = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 22),
      new THREE.MeshBasicMaterial({ map: hillTexture(PALETTE.hillNear, 8, 40), transparent: true, depthWrite: false }),
    );
    near.position.set(6, 1.6, -26);
    this.scene.add(far, near);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshBasicNodeMaterial());
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -20;
    const dapple = smoothstep(0.3, 0.6, mx_noise_float(vec3(positionWorld.x.mul(0.6), positionWorld.z.mul(0.6), time.mul(0.12))));
    (ground.material as THREE.MeshBasicNodeMaterial).colorNode = mix(
      mix(color(PALETTE.grassDark), color(PALETTE.grassMid), smoothstep(-2, -14, positionWorld.z)),
      color(PALETTE.dapple),
      dapple.mul(0.22),
    );
    this.scene.add(ground);

    this.scene.add(makeGrass(this.gust));
    this.scene.add(makeTree());
    this.scene.add(makeCanopy(this.gust));
    this.shafts = makeShafts();
    this.scene.add(this.shafts);

    // Specks of light drifting in the air.
    const moteTex = glowTexture([
      [0, 'rgba(255,255,230,0.9)'],
      [0.35, 'rgba(255,255,230,0.35)'],
      [1, 'rgba(255,255,230,0)'],
    ]);
    const rng = createRng(31);
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: moteTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
      s.position.set((rng() - 0.5) * 9, 0.6 + rng() * 4, -1 + rng() * 3);
      s.scale.setScalar(0.05 + rng() * 0.12);
      s.userData = { phase: rng() * 10, base: s.position.clone() };
      this.motes.push(s);
      this.scene.add(s);
    }

    this.leafMat = new THREE.MeshBasicMaterial({ color: PALETTE.leafMid, side: THREE.DoubleSide, transparent: true });
    this.scene.add(this.textGroup);
  }

  async init(): Promise<void> {
    await this.renderer.init();
  }

  get usingWebGPU(): boolean {
    const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    return Boolean(backend?.isWebGPUBackend);
  }

  get flying(): boolean {
    return this.fliers.length > 0;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 0.8 ? 64 : 50;
    this.camera.updateProjectionMatrix();
    const halfW = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect * 6;
    this.textWidth = Math.min(6.4, halfW * 2 * 0.82);
    if (!this.flying) this.setText(this.text, true);
  }

  /** Lays out the words in the air. New characters drift in; removed ones vanish. */
  setText(text: string, relayout = false): void {
    // Once the wind has the words, they're no longer ours to change.
    if (this.flying) return;
    if (text === this.text && !relayout) return;
    const prevCount = this.glyphs.length;
    this.text = text;
    for (const g of this.glyphs) this.textGroup.remove(g.mesh);
    const old = this.glyphs;
    this.glyphs = [];

    let size = 0.62;
    let lines: string[] = [];
    const measure = (s: string) => {
      this.measureCtx.font = `96px ${HAND_STACK}`;
      return (this.measureCtx.measureText(s).width / 96) * size;
    };
    for (; size > 0.3; size -= 0.04) {
      lines = wrapText(text, this.textWidth, measure);
      if (lines.length * size * 1.2 <= 3.2) break;
    }
    const lineHeight = size * 1.2;
    const top = TEXT_CENTER.y + ((lines.length - 1) * lineHeight) / 2;
    let index = 0;
    lines.forEach((line, li) => {
      const chars = Array.from(line);
      let x = TEXT_CENTER.x - measure(line) / 2;
      for (const ch of chars) {
        const adv = measure(ch);
        if (ch.trim() !== '') {
          const tex = this.glyphTexture(ch);
          const reuse = old[index];
          const material = reuse?.material ?? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
          if (material.map !== tex) {
            material.map = tex;
            material.needsUpdate = true;
          }
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.5, size * 1.5), material);
          const home = new THREE.Vector3(x + adv / 2, top - li * lineHeight, TEXT_CENTER.z);
          mesh.position.copy(home);
          this.textGroup.add(mesh);
          this.glyphs.push({ mesh, home, born: index < prevCount ? (reuse?.born ?? this.clock) : this.clock, material });
          index++;
        }
        x += adv;
      }
    });
    for (let i = index; i < old.length; i++) old[i]!.material.dispose();
  }

  /** The wind lifts every character off, one after another, with a few leaves. */
  release(): void {
    if (this.glyphs.length === 0) return;
    this.gustTarget = 1;
    const delays = liftDelays(this.glyphs.length, Math.floor(this.clock * 1000), 0.06);
    this.fliers = this.glyphs.map((g, i) => makeFlier(g.mesh.position.x, g.mesh.position.y, g.mesh.position.z, 0.6 + delays[i]!, i * 97 + 13));
    const rng = createRng(Math.floor(this.clock * 977));
    for (let i = 0; i < 26; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), this.leafMat);
      const f = makeFlier(-4 + rng() * 6, 3.2 + rng() * 1.4, 0.6 + rng() * 1.5, 0.4 + rng() * 2.5, 500 + i * 7);
      mesh.position.set(f.x, f.y, f.z);
      this.scene.add(mesh);
      this.leafFliers.push({ flier: f, mesh });
    }
    this.text = '';
  }

  update(dt: number): boolean {
    this.clock += dt;
    // The gust builds quickly and fades slowly.
    const g = this.gust.value;
    this.gust.value = g + (this.gustTarget - g) * (1 - Math.exp(-dt * (this.gustTarget > g ? 2.5 : 0.8)));

    for (const c of this.clouds) {
      c.position.x += dt * (0.25 + this.gust.value * 0.8);
      if (c.position.x > 40) c.position.x = -40;
    }
    for (const s of this.shafts.children as THREE.Mesh[]) {
      const m = s.material as THREE.MeshBasicMaterial;
      // Shafts brighten and fade as leaves move in front of the sun.
      m.opacity = s.userData.base * (0.65 + 0.35 * Math.sin(this.clock * 0.9 + s.userData.phase) * Math.sin(this.clock * 0.37 + s.userData.phase * 2));
    }
    for (const s of this.motes) {
      const b = s.userData.base as THREE.Vector3;
      const p = s.userData.phase as number;
      s.position.set(b.x + Math.sin(this.clock * 0.3 + p) * 0.3 + this.gust.value * 0.4, b.y + Math.sin(this.clock * 0.5 + p * 2) * 0.15, b.z);
      (s.material as THREE.SpriteMaterial).opacity = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(this.clock * 1.3 + p));
    }

    // Resting words bob gently; new ones drift in.
    if (!this.flying) {
      this.glyphs.forEach((gl, i) => {
        const age = this.clock - gl.born;
        const appear = Math.min(1, age / 0.45);
        gl.mesh.position.set(gl.home.x, gl.home.y + Math.sin(this.clock * 1.2 + i * 0.55) * 0.03 + (1 - appear) * 0.15, gl.home.z);
        gl.mesh.rotation.z = Math.sin(this.clock * 0.9 + i) * 0.03;
        gl.material.opacity = appear;
        gl.mesh.scale.setScalar(0.75 + 0.25 * appear);
      });
    }

    let finished = false;
    if (this.flying) {
      const bounds = { maxX: 8, maxY: 7.5, maxAge: 10 };
      stepFliers(this.fliers, dt, this.gust.value, this.clock, bounds);
      this.fliers.forEach((f, i) => {
        const gl = this.glyphs[i]!;
        gl.mesh.position.set(f.x, f.y, f.z);
        gl.mesh.rotation.set(Math.sin(f.tumble) * 0.6, 0, f.spin);
        gl.mesh.scale.setScalar(f.scale);
        gl.material.opacity = f.opacity;
      });
      if (allGone(this.fliers)) {
        for (const gl of this.glyphs) {
          this.textGroup.remove(gl.mesh);
          gl.material.dispose();
        }
        this.glyphs = [];
        this.fliers = [];
        this.gustTarget = 0;
        finished = true;
      }
    }
    if (this.leafFliers.length) {
      stepFliers(
        this.leafFliers.map((l) => l.flier),
        dt,
        Math.max(this.gust.value, 0.5),
        this.clock,
        { maxX: 9, maxY: 9, maxAge: 9 },
      );
      for (const l of this.leafFliers) {
        l.mesh.position.set(l.flier.x, l.flier.y, l.flier.z);
        l.mesh.rotation.set(l.flier.tumble, l.flier.tumble * 0.7, l.flier.spin);
      }
      this.leafFliers = this.leafFliers.filter((l) => {
        if (!l.flier.gone) return true;
        this.scene.remove(l.mesh);
        return false;
      });
    }
    this.renderer.render(this.scene, this.camera);
    return finished;
  }

  private glyphTexture(ch: string): THREE.CanvasTexture {
    let tex = this.glyphCache.get(ch);
    if (!tex) {
      tex = canvasTexture(192, 192, (ctx) => {
        // 128px on a 192px canvas drawn at 1.5x the font size: one em is one world `size`.
        ctx.font = `128px ${HAND_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.shadowColor = 'rgba(30,60,110,0.45)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = PALETTE.ink;
        ctx.fillText(ch, 96, 128);
      });
      this.glyphCache.set(ch, tex);
    }
    return tex;
  }

  /** Forgets everything on screen. */
  reset(): void {
    this.setText('');
    this.fliers = [];
    for (const l of this.leafFliers) this.scene.remove(l.mesh);
    this.leafFliers = [];
    this.gust.value = 0;
    this.gustTarget = 0;
  }
}
