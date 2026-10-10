import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  color,
  float,
  length,
  mix,
  mx_noise_float,
  positionLocal,
  positionWorld,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { createRng } from '../strokes/random';
import { HAND_STACK } from '../text/font';
import { wrapText } from '../text/wrap';
import { BURN_SIZE, CHAR_WIDTH, frontSpeed, isBurntOut, makeBurnMap, packBurnMap, sampleFront, type UV } from './burn';

/** A dark room, a desk, a candle. Painted rather than photoreal. */
const PALETTE = {
  paper: '#f4ebd8',
  ink: '#2b1e1a',
  scorch: '#8a5a2b',
  char: '#1a1210',
  ember: '#ff9a3c',
  emberCore: '#ffe3a1',
  woodDark: '#20130d',
  woodLight: '#36231a',
  ash: '#6e6560',
  candleLight: '#ffb86b',
  fireLight: '#ff9a4a',
  ambient: '#050303',
  wax: '#f1e4c8',
};

const PAPER = { w: 2.1, h: 2.97, x: 0.1, z: 0.05, turn: -0.05 };
const CANDLE_AT = new THREE.Vector3(-1.65, 0, -1.05);
const FLAME_HEIGHT = 0.68;
const IGNITION: UV = { u: 0.02, v: 0.98 };

const vec3Uniform = (v: THREE.Vector3) => uniform(v);

/** A palette color as a vec3 node (linear), for arithmetic with lighting. */
function rgb(hex: string) {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
}
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

/** A soft teardrop of flame: white-yellow at the base, orange to transparent at the tip. */
function flameTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 256, (ctx) => {
    const g = ctx.createRadialGradient(64, 190, 4, 64, 160, 120);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(0.25, 'rgba(255,214,120,0.95)');
    g.addColorStop(0.55, 'rgba(255,140,50,0.55)');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(64, 8);
    ctx.bezierCurveTo(100, 90, 118, 150, 110, 196);
    ctx.bezierCurveTo(100, 246, 28, 246, 18, 196);
    ctx.bezierCurveTo(10, 150, 28, 90, 64, 8);
    ctx.fill();
  });
}

function softDot(rgb: string): THREE.CanvasTexture {
  return canvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.4, `rgba(${rgb},0.5)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

interface Particle {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  vel: THREE.Vector3;
  size: number;
  alive: boolean;
}

/** A fixed pool of sprites reused for flames, embers and smoke. */
class Pool {
  readonly items: Particle[] = [];
  constructor(scene: THREE.Scene, count: number, material: () => THREE.SpriteMaterial) {
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(material());
      sprite.visible = false;
      scene.add(sprite);
      this.items.push({ sprite, age: 0, life: 1, vel: new THREE.Vector3(), size: 1, alive: false });
    }
  }
  spawn(at: THREE.Vector3, vel: THREE.Vector3, life: number, size: number): Particle | null {
    const p = this.items.find((x) => !x.alive);
    if (!p) return null;
    p.alive = true;
    p.age = 0;
    p.life = life;
    p.size = size;
    p.vel.copy(vel);
    p.sprite.position.copy(at);
    p.sprite.visible = true;
    return p;
  }
  get active(): number {
    return this.items.filter((p) => p.alive).length;
  }
}

/** Lighting shared by every surface: the candle, the burning page, and the dark. */
function lightAt(
  candle: ReturnType<typeof vec3Uniform>,
  flicker: ReturnType<typeof floatUniform>,
  firePos: ReturnType<typeof vec3Uniform>,
  fire: ReturnType<typeof floatUniform>,
) {
  const dc = length(positionWorld.sub(candle));
  const df = length(positionWorld.sub(firePos));
  // Candlelight falls off quickly: the room beyond the desk stays dark.
  const fromCandle = rgb(PALETTE.candleLight).mul(flicker.mul(1.55).div(dc.mul(dc).mul(1.5).add(1)));
  const fromFire = rgb(PALETTE.fireLight).mul(fire.mul(flicker).mul(1.15).div(df.mul(df).mul(1.1).add(1)));
  return rgb(PALETTE.ambient).add(fromCandle).add(fromFire);
}

export class FireWorld {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50);
  private readonly flicker = floatUniform(1);
  private readonly candlePos = vec3Uniform(new THREE.Vector3(CANDLE_AT.x, FLAME_HEIGHT, CANDLE_AT.z));
  private readonly firePos = vec3Uniform(new THREE.Vector3(PAPER.x, 0.3, PAPER.z));
  private readonly fireLight = floatUniform(0);
  private readonly front = floatUniform(-1);
  private readonly burning = floatUniform(0);
  private readonly ash = floatUniform(0);
  private readonly paperOpacity = floatUniform(1);
  private readonly paper: THREE.Mesh;
  private readonly paperCanvas: HTMLCanvasElement;
  private readonly paperTex: THREE.CanvasTexture;
  private readonly burnTex: THREE.DataTexture;
  private burnMap: Float32Array;
  private readonly flames: Pool;
  private readonly embers: Pool;
  private readonly smoke: Pool;
  private readonly carrier: THREE.Sprite;
  private readonly candleFlame: THREE.Group;
  private clock = 0;
  private stage: 'writing' | 'carrying' | 'burning' | 'cooling' | 'returning' = 'writing';
  private stageTime = 0;
  private readonly rng = createRng(17);
  private seed = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.scene.background = new THREE.Color('#070505');
    this.camera.position.set(-0.15, 4.4, 2.4);
    this.camera.lookAt(-0.1, 0, -0.32);

    const light = lightAt(this.candlePos, this.flicker, this.firePos, this.fireLight);

    // The desk: dark wood grain that only shows where light reaches it, and ash where the page was.
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicNodeMaterial());
    desk.rotation.x = -Math.PI / 2;
    const grain = mx_noise_float(vec3(positionWorld.x.mul(0.8), positionWorld.z.mul(9), 1.0)).mul(0.5).add(0.5);
    const wood = mix(color(PALETTE.woodDark), color(PALETTE.woodLight), smoothstep(0.25, 0.8, grain));
    const inPaper = step(abs(positionWorld.x.sub(PAPER.x)), PAPER.w / 2).mul(step(abs(positionWorld.z.sub(PAPER.z)), PAPER.h / 2));
    const speck = smoothstep(0.55, 0.75, mx_noise_float(vec3(positionWorld.x.mul(14), positionWorld.z.mul(14), 3)));
    const deskCol = mix(wood, color(PALETTE.ash), inPaper.mul(this.ash).mul(speck.mul(0.7).add(0.15)));
    (desk.material as THREE.MeshBasicNodeMaterial).colorNode = deskCol.mul(light);
    this.scene.add(desk);

    // The paper and its ink, drawn on a canvas.
    this.paperCanvas = document.createElement('canvas');
    this.paperCanvas.width = 1024;
    this.paperCanvas.height = Math.round((1024 * PAPER.h) / PAPER.w);
    this.paperTex = new THREE.CanvasTexture(this.paperCanvas);
    this.paperTex.colorSpace = THREE.SRGBColorSpace;
    this.paperTex.anisotropy = 4;
    this.burnMap = makeBurnMap(this.seed, IGNITION);
    this.burnTex = new THREE.DataTexture(packBurnMap(this.burnMap), BURN_SIZE, BURN_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    this.burnTex.magFilter = THREE.LinearFilter;
    this.burnTex.minFilter = THREE.LinearFilter;
    this.burnTex.needsUpdate = true;

    const paperGeo = new THREE.PlaneGeometry(PAPER.w, PAPER.h, 84, 118);
    paperGeo.rotateX(-Math.PI / 2);
    const pm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true });
    const d = texture(this.burnTex, uv()).r.sub(this.front);
    const active = this.burning;
    // Paper curls up as the charred edge passes.
    const curlNoise = mx_noise_float(vec3(uv().x.mul(6), uv().y.mul(6), 2)).mul(0.5).add(0.6);
    const lift = smoothstep(0.0, -CHAR_WIDTH, d).mul(0.09).mul(curlNoise).add(smoothstep(0.03, -0.01, d).mul(0.015)).mul(active);
    pm.positionNode = positionLocal.add(vec3(0, lift.add(0.004), 0));
    let col = texture(this.paperTex, uv()).rgb;
    col = mix(col, color(PALETTE.scorch), smoothstep(0.1, 0.0, d).mul(0.6).mul(active));
    col = mix(col, color(PALETTE.char), smoothstep(0.004, -0.02, d).mul(active));
    const edge = float(1).sub(smoothstep(0.0, 0.016, abs(d.add(0.007)))).mul(active);
    const core = float(1).sub(smoothstep(0.0, 0.006, abs(d.add(0.004)))).mul(active);
    const glow = color(PALETTE.ember).mul(edge.mul(this.flicker.mul(0.5).add(1.2))).add(color(PALETTE.emberCore).mul(core));
    pm.colorNode = col.mul(light).add(glow);
    pm.opacityNode = step(float(-CHAR_WIDTH), mix(float(1), d, active)).mul(this.paperOpacity);
    this.paper = new THREE.Mesh(paperGeo, pm);
    this.paper.position.set(PAPER.x, 0, PAPER.z);
    this.paper.rotation.y = PAPER.turn;
    this.scene.add(this.paper);

    // The candle.
    const wax = new THREE.MeshBasicNodeMaterial();
    const up = clamp(positionLocal.y.div(0.6).add(0.5), 0, 1);
    wax.colorNode = color(PALETTE.wax).mul(up.mul(0.6).add(0.25)).mul(this.flicker.mul(0.25).add(0.85));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.6, 24), wax);
    body.position.set(CANDLE_AT.x, 0.3, CANDLE_AT.z);
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.03, 32), new THREE.MeshBasicNodeMaterial());
    (dish.material as THREE.MeshBasicNodeMaterial).colorNode = rgb('#8d6a4a').mul(light);
    dish.position.set(CANDLE_AT.x, 0.015, CANDLE_AT.z);
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6), new THREE.MeshBasicMaterial({ color: '#1a1210' }));
    wick.position.set(CANDLE_AT.x, 0.63, CANDLE_AT.z);
    this.scene.add(body, dish, wick);

    const flameTex = flameTexture();
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softDot('255,170,90'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.07 }),
    );
    halo.scale.setScalar(2.6);
    const flameBody = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flameBody.scale.set(0.12, 0.26, 1);
    flameBody.position.y = 0.08;
    this.candleFlame = new THREE.Group();
    this.candleFlame.add(halo, flameBody);
    this.candleFlame.position.set(CANDLE_AT.x, FLAME_HEIGHT, CANDLE_AT.z);
    this.scene.add(this.candleFlame);

    // The flame carried from the candle to the corner of the page.
    this.carrier = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.carrier.scale.set(0.1, 0.2, 1);
    this.carrier.visible = false;
    this.scene.add(this.carrier);

    this.flames = new Pool(this.scene, 110, () =>
      new THREE.SpriteMaterial({ map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const emberTex = softDot('255,190,110');
    this.embers = new Pool(this.scene, 160, () =>
      new THREE.SpriteMaterial({ map: emberTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const smokeTex = softDot('70,62,60');
    this.smoke = new Pool(this.scene, 40, () => new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));

    this.drawPaper([], 48);
  }

  async init(): Promise<void> {
    await this.renderer.init();
  }

  get usingWebGPU(): boolean {
    const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    return Boolean(backend?.isWebGPUBackend);
  }

  get canWrite(): boolean {
    return this.stage === 'writing';
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // On tall screens, a wider lens so the page fills the width and the candle sits at the edge.
    const tall = this.camera.aspect < 0.8;
    this.camera.fov = tall ? 68 : 42;
    this.camera.position.set(tall ? 0 : -0.15, 4.4, 2.4);
    this.camera.lookAt(tall ? 0 : -0.1, 0, -0.32);
    this.camera.updateProjectionMatrix();
  }

  /** Writes the letter onto the page. Returns false if it no longer fits. */
  setText(text: string): boolean {
    // Once lit, the page can't be changed.
    if (this.stage !== 'writing') return true;
    const ctx = this.paperCanvas.getContext('2d')!;
    const margin = 92;
    const width = this.paperCanvas.width - margin * 2;
    const height = this.paperCanvas.height - margin * 2;
    // Start large, like a first line in pen; long letters shrink to fit the page.
    for (let size = 60; size >= 26; size -= 2) {
      ctx.font = `${size}px ${HAND_STACK}`;
      const lines = wrapText(text, width, (s) => ctx.measureText(s).width);
      if (lines.length * size * 1.32 <= height) {
        this.drawPaper(lines, size);
        return true;
      }
    }
    return false;
  }

  /** Carry the candle's flame to the corner of the page, and let it burn. */
  light(): void {
    if (this.stage !== 'writing') return;
    this.stage = 'carrying';
    this.stageTime = 0;
    this.carrier.visible = true;
  }

  /** Advances the scene. Returns true at the moment the page has finished burning. */
  update(dt: number): boolean {
    this.clock += dt;
    this.stageTime += dt;
    const t = this.clock;
    this.flicker.value = 1 + 0.07 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 7.3 + 1) + 0.04 * Math.sin(t * 23.7 + 2);
    const sway = Math.sin(t * 3.1) * 0.012 + Math.sin(t * 7.7) * 0.006;
    this.candleFlame.children[1]!.position.x = sway;
    this.candleFlame.children[1]!.scale.set(0.12, 0.26 * (0.94 + 0.08 * Math.sin(t * 11)), 1);

    let finished = false;
    if (this.stage === 'carrying') {
      const u = Math.min(1, this.stageTime / 1.1);
      const e = u * u * (3 - 2 * u);
      const from = new THREE.Vector3(CANDLE_AT.x, FLAME_HEIGHT + 0.08, CANDLE_AT.z);
      const to = this.paperPoint(IGNITION);
      const p = from.clone().lerp(to, e);
      p.y += Math.sin(Math.PI * u) * 0.25;
      this.carrier.position.copy(p);
      this.carrier.scale.set(0.09, 0.18 * (0.9 + 0.2 * Math.sin(t * 17)), 1);
      if (u >= 1) {
        this.carrier.visible = false;
        this.stage = 'burning';
        this.stageTime = 0;
        this.front.value = 0;
        this.burning.value = 1;
      }
    } else if (this.stage === 'burning') {
      const f = this.front.value;
      this.front.value = f + frontSpeed(f) * dt;
      // The page lights the room while it burns.
      const strength = Math.min(1, f * 6) * Math.min(1, (1.02 - f) * 4);
      this.fireLight.value += (Math.max(0, strength) - this.fireLight.value) * Math.min(1, dt * 3);
      this.ash.value = Math.min(1, f);
      this.emit(dt);
      if (isBurntOut(this.front.value)) {
        this.stage = 'cooling';
        this.stageTime = 0;
        finished = true;
      }
    } else if (this.stage === 'cooling') {
      this.fireLight.value *= Math.exp(-dt * 1.5);
      if (this.stageTime > 3.5) this.ash.value = Math.max(0, this.ash.value - dt * 0.35);
      if (this.stageTime > 6) this.newPage();
    } else if (this.stage === 'returning') {
      this.paperOpacity.value = Math.min(1, this.paperOpacity.value + dt * 0.8);
      this.ash.value = Math.max(0, this.ash.value - dt * 0.5);
      if (this.paperOpacity.value >= 1) this.stage = 'writing';
    }
    this.stepParticles(dt);
    this.renderer.render(this.scene, this.camera);
    return finished;
  }

  /** Back to a fresh, blank page (also used when leaving). */
  reset(): void {
    this.stage = 'writing';
    this.front.value = -1;
    this.burning.value = 0;
    this.fireLight.value = 0;
    this.ash.value = 0;
    this.paperOpacity.value = 1;
    this.carrier.visible = false;
    for (const pool of [this.flames, this.embers, this.smoke]) {
      for (const p of pool.items) {
        p.alive = false;
        p.sprite.visible = false;
      }
    }
    this.drawPaper([], 48);
  }

  private newPage(): void {
    this.seed++;
    this.burnMap = makeBurnMap(this.seed, IGNITION);
    (this.burnTex.image.data as Uint8Array).set(packBurnMap(this.burnMap));
    this.burnTex.needsUpdate = true;
    this.front.value = -1;
    this.burning.value = 0;
    this.paperOpacity.value = 0;
    this.drawPaper([], 48);
    this.stage = 'returning';
  }

  private paperPoint(p: UV, lift = 0): THREE.Vector3 {
    const local = new THREE.Vector3((p.u - 0.5) * PAPER.w, lift, -(p.v - 0.5) * PAPER.h);
    return local.applyAxisAngle(new THREE.Vector3(0, 1, 0), PAPER.turn).add(new THREE.Vector3(PAPER.x, 0, PAPER.z));
  }

  private emit(dt: number): void {
    const f = this.front.value;
    if (f > 1.0) return;
    const sum = new THREE.Vector3();
    let n = 0;
    const flames = Math.round(dt * 85);
    for (let i = 0; i < flames; i++) {
      const p = sampleFront(this.burnMap, f - 0.006, this.rng);
      if (!p) continue;
      const at = this.paperPoint(p, 0.04);
      sum.add(at);
      n++;
      this.flames.spawn(at, new THREE.Vector3((this.rng() - 0.5) * 0.05, 0.35 + this.rng() * 0.3, (this.rng() - 0.5) * 0.05), 0.4 + this.rng() * 0.5, 0.2 + this.rng() * 0.26);
      if (this.rng() < 0.45) {
        this.embers.spawn(at, new THREE.Vector3((this.rng() - 0.5) * 0.3, 0.5 + this.rng() * 0.7, (this.rng() - 0.5) * 0.3), 1.2 + this.rng() * 1.8, 0.018 + this.rng() * 0.02);
      }
      if (this.rng() < 0.08) {
        this.smoke.spawn(at, new THREE.Vector3((this.rng() - 0.5) * 0.08, 0.25 + this.rng() * 0.2, (this.rng() - 0.5) * 0.08), 2.5 + this.rng() * 1.5, 0.25);
      }
    }
    if (n > 0) this.firePos.value.lerp(sum.divideScalar(n).setY(0.35), Math.min(1, dt * 4));
  }

  private stepParticles(dt: number): void {
    const t = this.clock;
    for (const p of this.flames.items) {
      if (!p.alive) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }
      p.sprite.position.addScaledVector(p.vel, dt);
      const s = p.size * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (0.9 + 0.2 * Math.sin(t * 20 + p.size * 90));
      p.sprite.scale.set(s * 0.55, s, 1);
      (p.sprite.material as THREE.SpriteMaterial).opacity = 1 - k * 0.4;
    }
    for (const p of this.embers.items) {
      if (!p.alive) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }
      p.vel.x += Math.sin(t * 2.3 + p.size * 400) * dt * 0.4;
      p.vel.multiplyScalar(Math.exp(-dt * 0.4));
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.size * (1 - k * 0.5));
      (p.sprite.material as THREE.SpriteMaterial).opacity = (1 - k) * (0.6 + 0.4 * Math.sin(t * 15 + p.size * 300));
    }
    for (const p of this.smoke.items) {
      if (!p.alive) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.size * (1 + k * 2.5));
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.sin(Math.PI * k) * 0.22;
    }
  }

  private drawPaper(lines: string[], size: number): void {
    const c = this.paperCanvas;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(0, 0, c.width, c.height);
    // Fibers and a little unevenness, fixed per page.
    const r = createRng(this.seed * 131);
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(160,130,90,0.05)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(r() * c.width, r() * c.height, 1 + r() * 6, 1);
    }
    const edge = ctx.createRadialGradient(c.width / 2, c.height / 2, c.width * 0.3, c.width / 2, c.height / 2, c.height * 0.75);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(120,90,50,0.12)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.fillStyle = PALETTE.ink;
    ctx.font = `${size}px ${HAND_STACK}`;
    ctx.textBaseline = 'alphabetic';
    const margin = 92;
    lines.forEach((line, i) => ctx.fillText(line, margin, margin + size + i * size * 1.32));
    this.paperTex.needsUpdate = true;
  }
}
