import * as THREE from 'three/webgpu';
import {
  abs,
  color,
  floor,
  fract,
  hash,
  max,
  min,
  sin,
  time,
  float,
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
import { flameShine, lightAt, makeCandle, makePen } from './props';
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

/** An irregular flake of ash with a faint glowing edge. */
function flakeTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (ctx) => {
    const rng = createRng(3);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = 18 + rng() * 12;
      const x = 32 + Math.cos(a) * r;
      const y = 32 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(200,190,182,1)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,170,90,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
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
  private readonly flakes: Pool;
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

    // The desk: varnished planks, dark beyond the candle's reach. A soft shadow under the page,
    // and ash where the page was.
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicNodeMaterial());
    desk.rotation.x = -Math.PI / 2;
    const plankW = 0.62;
    const row = positionWorld.z.div(plankW).add(40);
    const plank = floor(row);
    const across = fract(row);
    const tint = hash(plank).mul(0.25).add(0.88);
    const warp = mx_noise_float(vec3(positionWorld.x.mul(0.35), plank.mul(3.1), 0.5)).mul(1.6);
    const grain = mx_noise_float(vec3(positionWorld.x.mul(0.9).add(plank.mul(17)), across.mul(7).add(warp), 1.0)).mul(0.5).add(0.5);
    const rings = sin(across.mul(40).add(warp.mul(6)).add(positionWorld.x.mul(0.8))).mul(0.5).add(0.5);
    let wood = mix(color(PALETTE.woodDark), color(PALETTE.woodLight), smoothstep(0.25, 0.85, grain).mul(0.7).add(rings.mul(0.3))).mul(tint);
    const seam = float(1).sub(smoothstep(0.0, 0.025, min(across, float(1).sub(across))));
    wood = mix(wood, color('#0a0605'), seam.mul(0.8));
    // Shadow under the page, cast away from the candle (toward the lower right).
    const px = abs(positionWorld.x.sub(PAPER.x + 0.05)).sub(PAPER.w / 2);
    const pz = abs(positionWorld.z.sub(PAPER.z + 0.06)).sub(PAPER.h / 2);
    const under = float(1).sub(smoothstep(-0.03, 0.1, max(px, pz))).mul(this.paperOpacity).mul(float(1).sub(this.ash));
    const inPaper = step(abs(positionWorld.x.sub(PAPER.x)), PAPER.w / 2).mul(step(abs(positionWorld.z.sub(PAPER.z)), PAPER.h / 2));
    const speck = smoothstep(0.55, 0.75, mx_noise_float(vec3(positionWorld.x.mul(14), positionWorld.z.mul(14), 3)));
    const deskCol = mix(wood, color(PALETTE.ash), inPaper.mul(this.ash).mul(speck.mul(0.7).add(0.15)));
    const varnish = flameShine(this.candlePos, this.flicker, 60, 3).mul(grain.mul(0.5).add(0.6)).mul(float(1).sub(seam));
    (desk.material as THREE.MeshBasicNodeMaterial).colorNode = deskCol
      .mul(light)
      .mul(float(1).sub(under.mul(0.55)))
      .add(color('#ffcf8f').mul(varnish.mul(0.55)));
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
    // The sheet doesn't lie perfectly flat: a gentle warp and slightly lifted edges.
    const ux = uv().x;
    const uy = uv().y;
    const warpPaper = sin(ux.mul(3.1).add(0.4)).mul(sin(uy.mul(2.3).add(1.1))).mul(0.012);
    const edgeLift = smoothstep(0.06, 0.0, min(min(ux, float(1).sub(ux)), min(uy, float(1).sub(uy)))).mul(0.008);
    pm.positionNode = positionLocal.add(vec3(0, lift.add(0.006).add(warpPaper.add(0.012)).add(edgeLift), 0));
    let col = texture(this.paperTex, uv()).rgb;
    col = mix(col, color(PALETTE.scorch), smoothstep(0.1, 0.0, d).mul(0.6).mul(active));
    col = mix(col, color(PALETTE.char), smoothstep(0.004, -0.02, d).mul(active));
    const edge = float(1).sub(smoothstep(0.0, 0.016, abs(d.add(0.007)))).mul(active);
    const core = float(1).sub(smoothstep(0.0, 0.006, abs(d.add(0.004)))).mul(active);
    const glow = color(PALETTE.ember).mul(edge.mul(this.flicker.mul(0.5).add(1.2))).add(color(PALETTE.emberCore).mul(core));
    // Sparks glinting in the fresh char just behind the flame.
    const charBand = smoothstep(0.0, -0.006, d).mul(float(1).sub(smoothstep(-0.03, -0.048, d))).mul(active);
    const sparks = step(0.8, mx_noise_float(vec3(ux.mul(95), uy.mul(95), time.mul(0.9)))).mul(charBand);
    pm.colorNode = col
      .mul(light)
      .add(glow)
      .add(color(PALETTE.ember).mul(sparks.mul(this.flicker.mul(0.6).add(0.6))));
    pm.opacityNode = step(float(-CHAR_WIDTH), mix(float(1), d, active)).mul(this.paperOpacity);
    this.paper = new THREE.Mesh(paperGeo, pm);
    this.paper.position.set(PAPER.x, 0, PAPER.z);
    this.paper.rotation.y = PAPER.turn;
    this.scene.add(this.paper);

    // The candle in its brass holder, and a pen left beside the page.
    this.scene.add(makeCandle(CANDLE_AT, light, this.candlePos, this.flicker));
    this.scene.add(makePen(light, this.candlePos, this.flicker));

    const flameTex = flameTexture();
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softDot('255,170,90'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.07 }),
    );
    halo.scale.setScalar(2.6);
    // The flame in layers: an orange body, a bright core, a blue base, and the glowing wick tip.
    const flameBody = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flameTex, color: '#ffb26a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }),
    );
    flameBody.scale.set(0.13, 0.3, 1);
    flameBody.position.y = 0.09;
    const flameCore = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flameTex, color: '#fff6dc', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flameCore.scale.set(0.06, 0.15, 1);
    flameCore.position.y = 0.05;
    const flameBase = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softDot('110,150,255'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }),
    );
    flameBase.scale.set(0.05, 0.04, 1);
    flameBase.position.y = -0.005;
    const wickTip = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softDot('255,120,40'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    wickTip.scale.setScalar(0.025);
    wickTip.position.y = -0.02;
    this.candleFlame = new THREE.Group();
    this.candleFlame.add(halo, flameBody, flameCore, flameBase, wickTip);
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
    const flakeTex = flakeTexture();
    this.flakes = new Pool(this.scene, 60, () => new THREE.SpriteMaterial({ map: flakeTex, color: '#55504d', transparent: true, depthWrite: false }));

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
    const stretch = 0.94 + 0.08 * Math.sin(t * 11) + 0.04 * Math.sin(t * 17.3);
    const [, body, core] = this.candleFlame.children;
    body!.position.x = sway;
    body!.scale.set(0.13 * (2 - stretch) * 0.5 + 0.065, 0.3 * stretch, 1);
    core!.position.x = sway * 0.6;
    core!.scale.set(0.06, 0.15 * stretch, 1);

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
    for (const pool of [this.flames, this.embers, this.smoke, this.flakes]) {
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
      if (this.rng() < 0.06) {
        // Flakes of ash lift off the charred paper behind the flame.
        const behind = sampleFront(this.burnMap, f - 0.035, this.rng, 10, 0.01);
        if (behind) {
          const fl = this.flakes.spawn(
            this.paperPoint(behind, 0.06),
            new THREE.Vector3((this.rng() - 0.5) * 0.15, 0.18 + this.rng() * 0.25, (this.rng() - 0.5) * 0.15),
            2 + this.rng() * 2,
            0.03 + this.rng() * 0.04,
          );
          if (fl) (fl.sprite.material as THREE.SpriteMaterial).rotation = this.rng() * Math.PI * 2;
        }
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
    for (const p of this.flakes.items) {
      if (!p.alive) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }
      p.vel.x += Math.sin(t * 1.7 + p.size * 900) * dt * 0.25;
      p.vel.multiplyScalar(Math.exp(-dt * 0.5));
      p.sprite.position.addScaledVector(p.vel, dt);
      const m = p.sprite.material as THREE.SpriteMaterial;
      m.rotation += dt * (1.5 + p.size * 40) * (p.size > 0.05 ? -1 : 1);
      // Tumbling: the flake narrows and widens as it turns.
      p.sprite.scale.set(p.size * (0.4 + 0.6 * Math.abs(Math.sin(t * 3 + p.size * 300))), p.size, 1);
      m.opacity = Math.min(1, (1 - k) * 2) * 0.85;
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
