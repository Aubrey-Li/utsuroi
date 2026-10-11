import * as THREE from 'three/webgpu';
import {
  abs,
  color,
  dot,
  float,
  floor,
  fract,
  mix,
  modelNormalMatrix,
  mx_noise_float,
  normalize,
  normalLocal,
  pass,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import type { StoneEntry, StonePlacement } from '../journal/kept';
import { createRng } from '../strokes/random';
import { HAND_STACK } from '../text/font';
import { wrapText } from '../text/wrap';
import { stoneShape, type StoneShape } from './cairn';

/** A quiet pebble shore in soft morning light. */
const PALETTE = {
  skyTop: '#9cc2e6',
  skyLow: '#e9dcd6',
  horizon: '#f7e6d4',
  sea: '#7fb3c4',
  seaFar: '#a9c6d6',
  seaLine: '#e3f1f2',
  foam: '#f7f4ee',
  pebbleA: '#b9ada0',
  pebbleB: '#d6cdc0',
  pebbleC: '#8f8a86',
  pebbleD: '#a7978a',
  crevice: '#5d5550',
  chiselSteel: '#9aa3ab',
  chiselWood: '#8a6648',
};

/** The low morning sun, from the left and a little in front. */
const KEY = new THREE.Vector3(-0.55, 0.62, 0.55).normalize();

/** Each stone gets one of these families of color. */
const STONE_TONES = [
  { dark: '#5f5a56', mid: '#8f8881', light: '#c4bcb1' },
  { dark: '#525962', mid: '#7f8890', light: '#b6bec3' },
  { dark: '#6a5b4d', mid: '#988572', light: '#cdbb9f' },
  { dark: '#4f4e50', mid: '#76757a', light: '#aaa8a6' },
  { dark: '#6b5f5a', mid: '#998a83', light: '#cbbdb4' },
];

/** Where the stone you're carving lies, in front of you. */
const WRITING_SPOT = new THREE.Vector3(0, 0, 0.35);
const CAMERA_WRITING = { position: new THREE.Vector3(0, 0.78, 1.18), target: new THREE.Vector3(0, 0.03, 0.27) };

/**
 * Where you can look: from down at the stone (tilt 0) up to the sea and the
 * cairns along the shore (tilt 1), turning a little either way.
 */
const VIEW = {
  down: { position: CAMERA_WRITING.position, pitch: -Math.atan2(0.75, 0.91) },
  up: { position: new THREE.Vector3(0, 0.6, 1.5), pitch: THREE.MathUtils.degToRad(-4) },
  maxYaw: 0.85,
};

/** How long a stone takes to come to you, and to go back. */
const HOLD_TIME = 1.3;

const floatUniform = (v = 0) => uniform(v);

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(4, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#7fa9d8');
    g.addColorStop(0.35, PALETTE.skyTop);
    g.addColorStop(0.47, PALETTE.skyLow);
    g.addColorStop(0.5, PALETTE.horizon);
    g.addColorStop(1, PALETTE.pebbleA);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 512);
  });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

function hash2(p: Parameters<typeof dot>[0]) {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

/**
 * The pebble beach: a field of small rounded pebbles, each its own size,
 * shape and tone, lit like a little dome, with shadowed gaps between them.
 */
function pebbleGround(): THREE.Mesh {
  const m = new THREE.MeshBasicNodeMaterial();
  type F = ReturnType<typeof float>;
  type V = ReturnType<typeof vec2>;
  // Two layers: larger pebbles, and smaller ones filling between them.
  const layer = (density: number, salt: number) => {
    const p = vec2(positionWorld.x, positionWorld.z).mul(density);
    const cell = floor(p);
    const f = fract(p);
    let best = float(9) as unknown as F;
    let id = float(0) as unknown as F;
    let toward = vec2(0, 0) as unknown as V;
    let size = float(0.4) as unknown as F;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const g = vec2(i, j);
        const c = cell.add(g).add(salt);
        const o = vec2(hash2(c), hash2(c.add(vec2(17.3, 5.1)))).mul(0.7).add(0.15);
        const rad = hash2(c.add(vec2(2.1, 8.7))).mul(0.18).add(0.34);
        const ang = hash2(c.add(vec2(6.3, 1.9))).mul(6.283);
        const r = g.add(o).sub(f);
        // An oval, turned its own way.
        const rx = r.x.mul(ang.cos()).add(r.y.mul(ang.sin()));
        const ry = r.y.mul(ang.cos()).sub(r.x.mul(ang.sin())).mul(1.45);
        const d = vec2(rx, ry).length().div(rad);
        const closer = step(d, best);
        best = mix(best, d, closer) as unknown as F;
        id = mix(id, hash2(c.add(vec2(3.7, 9.2))), closer) as unknown as F;
        toward = mix(toward, r, closer) as unknown as V;
        size = mix(size, rad, closer) as unknown as F;
      }
    }
    return { d: best, id, toward };
  };
  const big = layer(11, 0);
  const small = layer(23, 40);
  const useBig = step(big.d, 1.0);
  const d = mix(small.d, big.d, useBig);
  const id = mix(small.id, big.id, useBig);
  const toward = mix(small.toward, big.toward, useBig);
  const inside = float(1).sub(smoothstep(0.82, 1.0, d));
  // Dome lighting: brighter on the side toward the sun, darker at the rim.
  const nx = toward.x.negate().mul(d);
  const nz = toward.y.negate().mul(d);
  // Clamped: past a pebble's edge the dome has no height (and sqrt of a negative would be NaN).
  const dome = d.mul(d).negate().add(1).max(0).sqrt();
  const lit = nx.mul(KEY.x).add(nz.mul(KEY.z)).mul(0.9).add(dome.mul(KEY.y));
  const tone = mix(
    mix(color(PALETTE.pebbleA), color(PALETTE.pebbleB), step(0.45, id)),
    mix(color(PALETTE.pebbleC), color(PALETTE.pebbleD), step(0.6, fract(id.mul(5.1)))),
    step(0.62, fract(id.mul(3.7))),
  ).mul(fract(id.mul(11.3)).mul(0.18).add(0.9));
  const pebble = tone.mul(lit.mul(0.45).add(0.68));
  const gap = mix(color(PALETTE.crevice), color('#8b8077'), small.id.mul(0.5));
  let col = mix(gap, pebble, inside);
  col = col.add(step(0.95, mx_noise_float(vec3(positionWorld.x.mul(160), positionWorld.z.mul(160), 2))).mul(0.04));
  // Far away it all blends into one warm gray.
  col = mix(col, color(PALETTE.pebbleA), smoothstep(3, 11, positionWorld.z.negate()).mul(0.7));
  m.colorNode = col;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), m);
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -9;
  return ground;
}

/** A soft dark oval under a stone where it meets the pebbles. */
function contactShadow(shape: StoneShape, texture: THREE.Texture): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(shape.rx * 2.9, shape.rz * 2.9),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.6, color: '#3d3330' }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return mesh;
}

function seaMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true });
  const d = positionWorld.z.negate().sub(3.4);
  let col = mix(color(PALETTE.sea), color(PALETTE.seaFar), smoothstep(1, 40, d));
  const crest = sin(d.mul(1.6).add(mx_noise_float(vec3(positionWorld.x.mul(0.15), d.mul(0.1), 1)).mul(3)).add(time.mul(0.8))).mul(0.5).add(0.5);
  col = mix(col, color(PALETTE.seaLine), smoothstep(0.92, 0.97, crest).mul(float(1).sub(smoothstep(2, 20, d))).mul(0.5));
  // A thin line of foam where the calm water meets the pebbles.
  const edge = float(1).sub(smoothstep(0.0, 0.35, abs(d.sub(sin(positionWorld.x.mul(0.8).add(time.mul(0.6))).mul(0.12)))));
  col = mix(col, color(PALETTE.foam), edge.mul(0.75));
  m.colorNode = col;
  m.opacityNode = smoothstep(-0.2, 0.15, d);
  return m;
}

/** A flat beach stone: an ellipsoid with gentle lumps, generated from its seed. */
export function stoneGeometry(shape: StoneShape): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 64, 32);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const r = createRng(shape.seed);
  const lumps = Array.from({ length: 5 }, () => ({ d: new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.4, r() - 0.5).normalize(), a: (r() - 0.5) * 0.12 }));
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let k = 1;
    for (const l of lumps) k += l.a * Math.max(0, v.dot(l.d)) ** 2;
    // Flatter on top and underneath, the way water wears a stone.
    const y = Math.sign(v.y) * Math.pow(Math.abs(v.y), 1.35);
    pos.setXYZ(i, v.x * shape.rx * k, y * shape.ry, v.z * shape.rz * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** The height of a stone's top surface at local (x, z). */
function topAt(shape: StoneShape, x: number, z: number): number {
  const q = 1 - (x / shape.rx) ** 2 - (z / shape.rz) ** 2;
  return q <= 0 ? 0 : shape.ry * Math.pow(Math.sqrt(q), 1.35);
}

/** Stone shading in a few soft bands, with carved letters on top read from a texture. */
function stoneMaterial(shape: StoneShape, carve: THREE.Texture, glow: ReturnType<typeof floatUniform>): THREE.MeshBasicNodeMaterial {
  const tone = STONE_TONES[shape.seed % STONE_TONES.length]!;
  const m = new THREE.MeshBasicNodeMaterial();
  const cu = positionLocal.x.div(shape.rx * 2).add(0.5);
  const cv = positionLocal.z.div(shape.rz * 2).negate().add(0.5);
  const top = smoothstep(0.55, 0.85, normalLocal.y);
  const at = (du: number, dv: number) => texture(carve, vec2(cu.add(du), cv.add(dv))).r.mul(top);
  const t = 1.5 / 1024;
  const c0 = at(0, 0);
  const dcdu = at(t, 0).sub(at(-t, 0));
  const dcdv = at(0, t).sub(at(0, -t));
  // Tilt the surface normal into each groove.
  const nLocal = normalize(normalLocal.add(vec3(dcdu.mul(-3.5), 0, dcdv.mul(3.5))));
  const n = normalize(modelNormalMatrix.mul(nLocal));
  const lam = dot(n, vec3(KEY.x, KEY.y, KEY.z));
  let col = mix(mix(color(tone.dark), color(tone.mid), smoothstep(0.1, 0.3, lam)), color(tone.light), smoothstep(0.6, 0.78, lam));
  // Darker toward the underside, where it sits in the pebbles.
  const lift = smoothstep(-shape.ry, shape.ry * 0.4, positionLocal.y);
  col = col.mul(lift.mul(0.5).add(0.5));
  // Water-worn mottling and fine grain.
  const mottle = mx_noise_float(positionLocal.mul(9).add(shape.seed % 97)).mul(0.5).add(0.5);
  col = col.mul(mottle.mul(0.14).add(0.93));
  const grain = step(0.9, mx_noise_float(positionLocal.mul(160))).mul(0.05);
  col = col.add(grain);
  // Grooves are darker at the bottom, with a pale fresh cut on the lit edge.
  col = mix(col, color(tone.dark).mul(0.7), smoothstep(0.35, 0.95, c0).mul(0.85));
  col = mix(col, color('#f3ece2'), smoothstep(0.1, 0.4, c0).mul(float(1).sub(smoothstep(0.4, 0.8, c0))).mul(0.25));
  m.colorNode = col.add(vec3(1, 0.95, 0.85).mul(glow.mul(0.12)));
  return m;
}

interface Placed {
  entry: StoneEntry;
  mesh: THREE.Mesh;
}

interface Dust {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
}

/** `visiting`: a kept stone held up in front of you to read; `returning`: going back to its cairn. */
export type StoneStage = 'carving' | 'lifting' | 'carrying' | 'settling' | 'resting' | 'returning' | 'visiting';

/**
 * The stone scene: the stone you carve lies in front of you; cairns of
 * stones you've kept stand further along the shore.
 */
export class StoneWorld {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 1, 0.02, 200);
  stage: StoneStage = 'carving';
  /** Called with the moment a stone touches down on the cairn (for its sound). */
  onSettle: (() => void) | null = null;
  /** Called for each tap of the chisel. */
  onTap: (() => void) | null = null;

  private readonly placed: Placed[] = [];
  private shadowTex: THREE.CanvasTexture | null = null;
  private shadow: THREE.Mesh | null = null;
  private stone!: THREE.Mesh;
  private shape!: StoneShape;
  private seed = 0;
  private readonly carveCanvas: HTMLCanvasElement;
  private readonly carveTex: THREE.CanvasTexture;
  private readonly glow = floatUniform(0);
  private readonly chisel: THREE.Group;
  private readonly dust: Dust[] = [];
  private readonly dustTex: THREE.CanvasTexture;
  private text = '';
  private revealAt = -10;
  private chiselTarget: THREE.Vector3 | null = null;
  private taps = 0;
  private tapClock = 0;
  private clock = 0;
  private stageTime = 0;
  private placement: StonePlacement | null = null;
  private pending: StoneEntry | null = null;
  private carryFrom = new THREE.Vector3();
  private readonly camPos = CAMERA_WRITING.position.clone();
  private readonly camLook = CAMERA_WRITING.target.clone();
  private readonly camPosTo = CAMERA_WRITING.position.clone();
  private readonly camLookTo = CAMERA_WRITING.target.clone();
  private camRate = 3;
  private visiting: Placed | null = null;
  private readonly visitHome = new THREE.Vector3();
  private readonly visitRot = new THREE.Euler();
  private readonly visitHomeQuat = new THREE.Quaternion();
  private readonly view = { tilt: 0, yaw: 0, rate: 12 };
  private tiltNow = 0;
  private yawNow = 0;
  /** The stone being held is drawn sharp, on its own, over the blurred shore. */
  private readonly heldScene = new THREE.Scene();
  private pipeline: THREE.RenderPipeline | null = null;
  private readonly blur = floatUniform(0);
  private readonly raycaster = new THREE.Raycaster();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(PALETTE.horizon, 10, 70);

    this.scene.add(pebbleGround());
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(200, 120), seaMaterial());
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.01, -3.4 - 60);
    this.scene.add(sea);

    // Scattered larger pebbles near you, for depth.
    const rng = createRng(77);
    for (let i = 0; i < 70; i++) {
      const s = stoneShape(1000 + i);
      const k = 0.18 + rng() * 0.25;
      const shape = { rx: s.rx * k, ry: s.ry * k, rz: s.rz * k, seed: s.seed };
      const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
      blank.needsUpdate = true;
      shape.ry *= 1.5;
      const pebble = new THREE.Mesh(stoneGeometry(shape), stoneMaterial(shape, blank, floatUniform(0)));
      const a = rng() * Math.PI * 2;
      const d = 0.45 + Math.pow(rng(), 0.7) * 2.2;
      pebble.position.set(Math.cos(a) * d * 1.4, shape.ry * 0.35, 0.4 + Math.sin(a) * d - 0.6);
      pebble.rotation.y = rng() * Math.PI;
      const shade = contactShadow(shape, this.shadowTexture());
      shade.position.set(pebble.position.x + 0.01, 0.003, pebble.position.z + 0.01);
      this.scene.add(shade, pebble);
    }

    this.carveCanvas = document.createElement('canvas');
    this.carveCanvas.width = this.carveCanvas.height = 1024;
    this.carveTex = new THREE.CanvasTexture(this.carveCanvas);
    this.carveTex.colorSpace = THREE.NoColorSpace;

    this.chisel = this.makeChisel();
    this.chisel.visible = false;
    this.scene.add(this.chisel);
    this.dustTex = canvasTexture(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(235,228,218,0.9)');
      g.addColorStop(1, 'rgba(235,228,218,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    });

    this.newStone(Math.floor(Math.random() * 1e6));
  }

  private shadowTexture(): THREE.CanvasTexture {
    this.shadowTex ??= canvasTexture(128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });
    return this.shadowTex;
  }

  async init(): Promise<void> {
    await this.renderer.init();
  }

  get usingWebGPU(): boolean {
    const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    return Boolean(backend?.isWebGPUBackend);
  }

  get currentSeed(): number {
    return this.seed;
  }

  get stones(): readonly StoneEntry[] {
    return this.placed.map((p) => p.entry);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Tall screens: a wider lens so the stone fills the width.
    this.camera.fov = this.camera.aspect < 0.8 ? 57 : 46;
    this.camera.updateProjectionMatrix();
  }

  /** Shows the stones already kept, on their cairns. */
  setKept(entries: readonly StoneEntry[]): void {
    for (const p of this.placed) {
      this.scene.remove(p.mesh);
      if (p.mesh.userData.shadow) this.scene.remove(p.mesh.userData.shadow as THREE.Object3D);
    }
    this.placed.length = 0;
    for (const e of entries) this.addPlaced(e);
  }

  /** Carves the words into the stone. Returns false if they no longer fit. */
  setText(text: string): boolean {
    if (this.stage !== 'carving') return true;
    const grew = Array.from(text).length > Array.from(this.text).length;
    const layout = this.layout(text);
    if (!layout) return false;
    this.text = text;
    if (grew && text.trim()) {
      this.revealAt = this.clock;
      const last = layout.lastChar;
      if (last) {
        const x = (last.x / 1024 - 0.5) * 2 * this.shape.rx;
        const z = (last.y / 1024 - 0.5) * 2 * this.shape.rz;
        this.chiselTarget = this.stone.localToWorld(new THREE.Vector3(x, topAt(this.shape, x, z), z));
        this.taps = 2;
        this.tapClock = 0;
      }
    }
    this.drawCarving(layout, 1);
    return true;
  }

  /** The words carved so far. */
  get carved(): string {
    return this.text;
  }

  /** Lifts the finished stone and carries it to its place on the cairn. */
  setOnCairn(entry: StoneEntry): void {
    if (this.stage !== 'carving') return;
    this.pending = entry;
    this.placement = entry.place;
    this.stage = 'lifting';
    this.stageTime = 0;
    this.chisel.visible = false;
    this.carryFrom.copy(this.stone.position);
    // Afterward, look back down at the fresh stone.
    this.setView(0, 0, 3);
  }

  /** Lifts a kept stone off its cairn so it can be read, until `putBack`. */
  visit(id: string): StoneEntry | null {
    const p = this.placed.find((x) => x.entry.id === id);
    if (!p) return null;
    this.visiting = p;
    this.visitHome.copy(p.mesh.position);
    this.visitRot.copy(p.mesh.rotation);
    this.visitHomeQuat.copy(p.mesh.quaternion);
    this.scene.remove(p.mesh);
    this.heldScene.add(p.mesh);
    this.stage = 'visiting';
    this.stageTime = 0;
    this.chisel.visible = false;
    return p.entry;
  }

  /** The kept stone under a point on the screen, if any. */
  stoneAt(clientX: number, clientY: number): StoneEntry | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(
      this.placed.map((p) => p.mesh),
      false,
    )[0];
    return hit ? (this.placed.find((p) => p.mesh === hit.object)?.entry ?? null) : null;
  }

  /** Where each kept stone is on screen, in client pixels (for automated checks). */
  onScreen(): { id: string; x: number; y: number; visible: boolean }[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.placed.map((p) => {
      const v = p.mesh.getWorldPosition(new THREE.Vector3()).project(this.camera);
      return { id: p.entry.id, x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, visible: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 };
    });
  }

  get tilt(): number {
    return this.view.tilt;
  }

  get yaw(): number {
    return this.view.yaw;
  }

  /** Where to look, eased toward at `rate`. */
  setView(tilt: number, yaw: number, rate = 12): void {
    this.view.tilt = THREE.MathUtils.clamp(tilt, 0, 1);
    this.view.yaw = THREE.MathUtils.clamp(yaw, -VIEW.maxYaw, VIEW.maxYaw);
    this.view.rate = rate;
  }

  putBack(): void {
    if (!this.visiting) return;
    this.stage = 'returning';
    this.stageTime = 0;
  }

  update(dt: number): void {
    this.clock += dt;
    this.stageTime += dt;
    this.glow.value = 0;

    const looking = this.stage === 'carving' || this.stage === 'visiting' || this.stage === 'returning';
    if (looking) this.lookFromView(dt);

    if (this.stage === 'carving') {
      // The newest letter appears as the chisel cuts it.
      const reveal = Math.min(1, (this.clock - this.revealAt) / 0.45);
      if (reveal < 1) {
        const layout = this.layout(this.text);
        if (layout) this.drawCarving(layout, reveal);
      }
      this.animateChisel(dt);
    } else if (this.stage === 'lifting') {
      const u = Math.min(1, this.stageTime / 0.8);
      if (this.shadow) (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - u);
      const e = u * u * (3 - 2 * u);
      this.stone.position.copy(this.carryFrom).add(new THREE.Vector3(0, 0.25 * e, 0));
      this.stone.rotation.x = -0.25 * e;
      if (u >= 1) this.next('carrying');
    } else if (this.stage === 'carrying') {
      const p = this.placement!;
      const target = new THREE.Vector3(p.x, p.y + 0.25, p.z);
      const u = Math.min(1, this.stageTime / 1.9);
      const e = u * u * (3 - 2 * u);
      const start = this.carryFrom.clone().add(new THREE.Vector3(0, 0.25, 0));
      const pos = start.clone().lerp(target, e);
      pos.y += Math.sin(Math.PI * u) * 0.25;
      this.stone.position.copy(pos);
      this.stone.rotation.set(-0.25 * (1 - e) + p.tiltX * e, p.rotY * e, p.tiltZ * e);
      this.aim(new THREE.Vector3(p.x - 0.6, Math.max(0.75, p.y + 0.55), p.z + 1.55), new THREE.Vector3(p.x, p.y + 0.05, p.z), 2);
      if (u >= 1) this.next('settling');
    } else if (this.stage === 'settling') {
      const p = this.placement!;
      const u = Math.min(1, this.stageTime / 0.55);
      const drop = 0.25 * (1 - u * u);
      this.stone.position.set(p.x, p.y + drop, p.z);
      this.stone.rotation.set(p.tiltX, p.rotY, p.tiltZ);
      if (u >= 1) {
        this.onSettle?.();
        this.next('resting');
      }
    } else if (this.stage === 'resting') {
      const p = this.placement!;
      // A small wobble as it finds its seat.
      const w = Math.exp(-this.stageTime * 5) * Math.sin(this.stageTime * 28) * 0.05;
      this.stone.rotation.set(p.tiltX + w, p.rotY, p.tiltZ - w * 0.6);
      if (this.stageTime > 1.6) {
        // The stone joins the cairn; a fresh one waits where you carve.
        this.stone.rotation.set(p.tiltX, p.rotY, p.tiltZ);
        if (this.pending) this.addPlaced(this.pending, this.stone);
        this.pending = null;
        this.newStone(Math.floor(Math.random() * 1e6), true);
        this.stone.scale.setScalar(0.001);
        this.next('carving');
      }
    } else if (this.stage === 'visiting' && this.visiting) {
      const mesh = this.visiting.mesh;
      const u = Math.min(1, this.stageTime / HOLD_TIME);
      const e = u * u * (3 - 2 * u);
      this.holdPose(mesh, e, Math.sin(Math.PI * u) * 0.18);
      this.blur.value = e;
      (mesh.userData.glow as typeof this.glow).value = e * (0.5 + 0.5 * Math.sin(this.clock * 1.5));
    } else if (this.stage === 'returning' && this.visiting) {
      const mesh = this.visiting.mesh;
      const u = Math.min(1, this.stageTime / HOLD_TIME);
      const e = u * u * (3 - 2 * u);
      this.holdPose(mesh, 1 - e, Math.sin(Math.PI * u) * 0.14);
      this.blur.value = 1 - e;
      (mesh.userData.glow as typeof this.glow).value = 0;
      if (u >= 1) this.release();
    }

    // A fresh stone grows into place.
    if (this.stage === 'carving' && this.stone.scale.x < 1) this.stone.scale.setScalar(Math.min(1, this.stone.scale.x + dt * 1.2));

    this.stepDust(dt);
    const follow = 1 - Math.exp(-dt * this.camRate);
    this.camPos.lerp(this.camPosTo, follow);
    this.camLook.lerp(this.camLookTo, follow);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (this.visiting) this.renderHeld();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Clears the stone in front of you (when leaving). */
  reset(): void {
    if (this.visiting) this.release(false);
    if (this.stage !== 'carving') this.newStone(Math.floor(Math.random() * 1e6));
    this.stage = 'carving';
    this.stone.visible = true;
    this.stone.scale.setScalar(1);
    this.text = '';
    this.chisel.visible = false;
    const layout = this.layout('');
    if (layout) this.drawCarving(layout, 1);
    this.setView(0, 0);
    this.tiltNow = this.yawNow = 0;
    this.camPos.copy(CAMERA_WRITING.position);
    this.camLook.copy(CAMERA_WRITING.target);
    this.aim(CAMERA_WRITING.position, CAMERA_WRITING.target, 3);
  }

  /** The held stone is back on its cairn. */
  private release(settle = true): void {
    const p = this.visiting!;
    this.heldScene.remove(p.mesh);
    this.scene.add(p.mesh);
    p.mesh.position.copy(this.visitHome);
    p.mesh.rotation.copy(this.visitRot);
    (p.mesh.userData.glow as typeof this.glow).value = 0;
    this.visiting = null;
    this.blur.value = 0;
    if (settle) this.onSettle?.();
    this.next('carving');
  }

  /** Points the camera where you're looking. Eases in slowly after the camera has been elsewhere. */
  private lookFromView(dt: number): void {
    const follow = 1 - Math.exp(-dt * this.view.rate);
    this.tiltNow += (this.view.tilt - this.tiltNow) * follow;
    this.yawNow += (this.view.yaw - this.yawNow) * follow;
    const e = THREE.MathUtils.smoothstep(this.tiltNow, 0, 1);
    const pos = VIEW.down.position.clone().lerp(VIEW.up.position, e);
    const pitch = THREE.MathUtils.lerp(VIEW.down.pitch, VIEW.up.pitch, e);
    const dir = new THREE.Vector3(Math.sin(this.yawNow) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.yawNow) * Math.cos(pitch));
    // Look at a point about as far as the stone, so easing between aims stays steady.
    const rate = this.stage === 'carving' ? Math.min(30, 3 + this.stageTime * 12) : 30;
    this.aim(pos, pos.clone().addScaledVector(dir, 1.1), rate);
  }

  /**
   * Places a stone between its cairn (k = 0) and held up in front of the
   * camera (k = 1): close enough to fill the view's width, a little above
   * center to leave room for its words below, its face turned toward you.
   */
  private holdPose(mesh: THREE.Mesh, k: number, arc: number): void {
    const shape = stoneShape(this.visiting!.entry.seed);
    const cam = this.camera;
    const vHalf = THREE.MathUtils.degToRad(cam.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * cam.aspect);
    const fill = cam.aspect < 0.8 ? 0.8 : 0.4;
    const d = Math.max((shape.rx * 2.1) / (fill * 2 * Math.tan(hHalf)), (shape.rz * 2) / (0.5 * 2 * Math.tan(vHalf)));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const held = cam.position.clone().addScaledVector(forward, d).addScaledVector(up, d * Math.tan(vHalf) * 0.2);
    mesh.position.copy(this.visitHome).lerp(held, k);
    mesh.position.y += arc;
    // Face up toward the camera, leaning back a little the way you'd hold it in your palm.
    const face = cam.quaternion
      .clone()
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.3, Math.sin(this.clock * 0.4) * 0.05, 0)));
    mesh.quaternion.copy(this.visitHomeQuat).slerp(face, k);
  }

  /** The shore, blurred and dimmed by how far the stone has come; the held stone sharp on top. */
  private renderHeld(): void {
    if (!this.pipeline) {
      const shore = pass(this.scene, this.camera).getTextureNode('output');
      const held = pass(this.heldScene, this.camera).getTextureNode('output');
      const soft = gaussianBlur(shore, vec2(1, 1), 9, { resolutionScale: 0.5 });
      const back = mix(shore.rgb, soft.rgb.mul(vec3(0.86, 0.85, 0.84)).add(vec3(0.07, 0.065, 0.06)), this.blur);
      // The held pass is clear where the stone isn't; its edges are antialiased, so blend by coverage.
      this.pipeline = new THREE.RenderPipeline(this.renderer, vec4(back.mul(held.a.oneMinus()).add(held.rgb), 1));
    }
    this.pipeline.render();
  }

  private next(stage: StoneStage): void {
    this.stage = stage;
    this.stageTime = 0;
  }

  private aim(position: THREE.Vector3, target: THREE.Vector3, rate: number): void {
    this.camPosTo.copy(position);
    this.camLookTo.copy(target);
    this.camRate = rate;
  }

  /** A fresh, blank stone where you carve. `keepOld` leaves the previous one where it is (on a cairn). */
  private newStone(seed: number, keepOld = false): void {
    this.seed = seed;
    this.shape = stoneShape(seed);
    if (this.stone && !keepOld) this.scene.remove(this.stone);
    this.text = '';
    const layout = this.layout('');
    if (layout) this.drawCarving(layout, 1);
    this.stone = new THREE.Mesh(stoneGeometry(this.shape), stoneMaterial(this.shape, this.carveTex, this.glow));
    this.stone.position.copy(WRITING_SPOT).setY(this.shape.ry * 0.55);
    this.stone.rotation.set(0, 0, 0);
    this.scene.add(this.stone);
    if (this.shadow) this.scene.remove(this.shadow);
    this.shadow = contactShadow(this.shape, this.shadowTexture());
    this.shadow.position.set(WRITING_SPOT.x + 0.015, 0.003, WRITING_SPOT.z + 0.02);
    this.scene.add(this.shadow);
  }

  /** A kept stone on its cairn, with its words baked into its own texture. */
  private addPlaced(entry: StoneEntry, mesh?: THREE.Mesh): void {
    const shape = stoneShape(entry.seed);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    const layout = layoutOn(canvas.getContext('2d')!, entry.text);
    if (layout) paintCarving(canvas.getContext('2d')!, layout, 1);
    tex.needsUpdate = true;
    const glow = floatUniform(0);
    const m = mesh ?? new THREE.Mesh(stoneGeometry(shape));
    m.material = stoneMaterial(shape, tex, glow);
    m.userData.glow = glow;
    m.position.set(entry.place.x, entry.place.y, entry.place.z);
    m.rotation.set(entry.place.tiltX, entry.place.rotY, entry.place.tiltZ);
    if (!mesh) this.scene.add(m);
    // The bottom stone of each cairn sits in its own shadow.
    if (entry.place.level === 0) {
      const shade = contactShadow(shape, this.shadowTexture());
      shade.position.set(entry.place.x + 0.02, 0.003, entry.place.z + 0.025);
      this.scene.add(shade);
      m.userData.shadow = shade;
    }
    this.placed.push({ entry, mesh: m });
  }

  private layout(text: string) {
    return layoutOn(this.carveCanvas.getContext('2d')!, text);
  }

  private drawCarving(layout: CarveLayout, reveal: number): void {
    paintCarving(this.carveCanvas.getContext('2d')!, layout, reveal);
    this.carveTex.needsUpdate = true;
  }

  private makeChisel(): THREE.Group {
    const g = new THREE.Group();
    const steel = new THREE.MeshBasicNodeMaterial();
    steel.colorNode = mix(color('#5d646b'), color(PALETTE.chiselSteel), smoothstep(-0.2, 0.6, normalLocal.x.add(normalLocal.y)));
    const wood = new THREE.MeshBasicNodeMaterial();
    wood.colorNode = mix(color('#5e4330'), color(PALETTE.chiselWood), smoothstep(-0.2, 0.6, normalLocal.x.add(normalLocal.y)));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.03, 8), steel);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.015;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 10), steel);
    shaft.position.y = 0.09;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.12, 12), wood);
    handle.position.y = 0.2;
    g.add(tip, shaft, handle);
    return g;
  }

  private animateChisel(dt: number): void {
    if (!this.chiselTarget) return;
    this.chisel.visible = true;
    this.tapClock += dt;
    const lean = new THREE.Euler(-0.5, 0, 0.35);
    const lift = this.taps > 0 ? Math.abs(Math.sin((this.tapClock * Math.PI) / 0.16)) * 0.018 : 0.03;
    const p = this.chiselTarget.clone().add(new THREE.Vector3(0, lift, 0));
    this.chisel.position.lerp(p, 1 - Math.exp(-dt * 25));
    this.chisel.rotation.copy(lean);
    if (this.taps > 0 && this.tapClock > 0.16) {
      this.tapClock = 0;
      this.taps--;
      this.onTap?.();
      this.puff(this.chiselTarget);
    }
    // Rest above the stone once the letter is cut.
    if (this.taps === 0 && this.clock - this.revealAt > 2.5) {
      this.chisel.visible = false;
      this.chiselTarget = null;
    }
  }

  private puff(at: THREE.Vector3): void {
    for (let i = 0; i < 4; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dustTex, transparent: true, depthWrite: false }));
      sprite.position.copy(at);
      sprite.scale.setScalar(0.008);
      this.scene.add(sprite);
      this.dust.push({
        sprite,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.08, 0.04 + Math.random() * 0.05, (Math.random() - 0.5) * 0.08),
        age: 0,
        life: 0.6 + Math.random() * 0.5,
      });
    }
  }

  private stepDust(dt: number): void {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i]!;
      d.age += dt;
      const k = d.age / d.life;
      if (k >= 1) {
        this.scene.remove(d.sprite);
        d.sprite.material.dispose();
        this.dust.splice(i, 1);
        continue;
      }
      d.vel.multiplyScalar(Math.exp(-dt * 3));
      d.sprite.position.addScaledVector(d.vel, dt);
      d.sprite.scale.setScalar(0.008 + k * 0.02);
      d.sprite.material.opacity = (1 - k) * 0.8;
    }
  }
}

interface CarveLayout {
  lines: string[];
  size: number;
  top: number;
  lastChar: { x: number; y: number } | null;
}

/** Fits words onto a stone's face: centered lines, smaller as there's more. */
function layoutOn(ctx: CanvasRenderingContext2D, text: string): CarveLayout | null {
  for (let size = 170; size >= 70; size -= 8) {
    ctx.font = `${size}px ${HAND_STACK}`;
    const lines = wrapText(text, 1024 * 0.64, (s) => ctx.measureText(s).width);
    const lh = size * 1.05;
    // The face is an oval, so fewer lines fit as the letters grow.
    if (lines.length * lh <= 1024 * 0.56 && lines.length <= 4) {
      const top = 512 - (lines.length * lh) / 2 + size * 0.78;
      let lastChar: CarveLayout['lastChar'] = null;
      if (text.trim()) {
        const li = lines.length - 1;
        const line = lines[li]!;
        const w = ctx.measureText(line).width;
        const lastW = ctx.measureText(Array.from(line).pop() ?? '').width;
        lastChar = { x: 512 + w / 2 - lastW / 2, y: top + li * lh - size * 0.32 };
      }
      return { lines, size, top, lastChar };
    }
  }
  return null;
}

/**
 * Paints carved letters as a soft groove profile: white in the cut's
 * center, fading toward its edges. `reveal` fades in the newest letter.
 */
function paintCarving(ctx: CanvasRenderingContext2D, layout: CarveLayout, reveal: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.font = `${layout.size}px ${HAND_STACK}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const lh = layout.size * 1.05;
  const passes: [number, number][] = [
    [layout.size * 0.11, 0.18],
    [layout.size * 0.07, 0.3],
    [layout.size * 0.035, 0.5],
  ];
  layout.lines.forEach((line, i) => {
    const y = layout.top + i * lh;
    const isLast = i === layout.lines.length - 1;
    const chars = Array.from(line);
    const draw = (s: string, x: number, align: CanvasTextAlign, alpha: number) => {
      ctx.textAlign = align;
      for (const [w, a] of passes) {
        ctx.strokeStyle = `rgba(255,255,255,${a * alpha})`;
        ctx.lineWidth = w;
        ctx.strokeText(s, x, y);
      }
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fillText(s, x, y);
    };
    if (!isLast || reveal >= 1 || chars.length === 0) {
      draw(line, 512, 'center', 1);
      return;
    }
    // Draw all but the newest letter fully, then the newest as it's being cut.
    const head = chars.slice(0, -1).join('');
    const full = ctx.measureText(line).width;
    const left = 512 - full / 2;
    draw(head, left, 'left', 1);
    draw(chars[chars.length - 1]!, left + ctx.measureText(head).width, 'left', reveal);
  });
}
