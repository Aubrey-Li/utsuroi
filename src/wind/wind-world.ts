import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createRng } from '../strokes/random';
import { HAND_STACK } from '../text/font';
import { wrapText } from '../text/wrap';
import { allGone, liftDelays, makeFlier, stepFliers, type Flier } from './flight';
import { makeFlowers, makeGrass, makeGround } from './meadow';
import { cloudTexture, hillTexture, SKY_COLORS, skyTexture, wispTexture } from './sky';
import { makeTree } from './tree';

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
const TEXT_CENTER = new THREE.Vector3(0, 2.25, 0);

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture(stops: [number, string][]): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [at, c] of stops) g.addColorStop(at, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
}

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
    this.scene.fog = new THREE.Fog(SKY_COLORS.horizon, 24, 120);
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

    // Clouds at a few depths drift at different speeds; high wisps above them.
    const cloudSpots = [
      { x: -26, y: 11, z: -50, s: 1.2 },
      { x: -6, y: 19, z: -62, s: 1.5 },
      { x: 9, y: 7.2, z: -42, s: 0.75 },
      { x: 24, y: 15, z: -55, s: 1.15 },
      { x: 38, y: 8.5, z: -46, s: 0.85 },
      { x: -40, y: 22, z: -70, s: 1.3 },
    ];
    cloudSpots.forEach((c, i) => {
      const cloud = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 9),
        new THREE.MeshBasicMaterial({ map: cloudTexture(100 + i * 17), transparent: true, depthWrite: false, fog: false }),
      );
      cloud.position.set(c.x, c.y, c.z);
      cloud.scale.setScalar(c.s);
      cloud.userData.speed = 0.18 + (60 + c.z) * 0.008;
      this.clouds.push(cloud);
      this.scene.add(cloud);
    });
    for (let i = 0; i < 2; i++) {
      const wisp = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 15),
        new THREE.MeshBasicMaterial({ map: wispTexture(300 + i), transparent: true, depthWrite: false, fog: false, opacity: 0.8 }),
      );
      wisp.position.set(-20 + i * 45, 22 + i * 4, -80);
      wisp.userData.speed = 0.12;
      this.clouds.push(wisp);
      this.scene.add(wisp);
    }

    // Layers of land into the distance: a pale mountain, hills with lines of trees.
    const layers = [
      { fill: SKY_COLORS.mountain, trees: null, seed: 1, h: 150, w: 260, ht: 60, x: 0, y: 9, z: -90 },
      { fill: SKY_COLORS.hillFar, trees: SKY_COLORS.treeFar, seed: 3, h: 90, w: 150, ht: 36, x: -10, y: 4.5, z: -48 },
      { fill: SKY_COLORS.hillMid, trees: SKY_COLORS.treeNear, seed: 5, h: 70, w: 110, ht: 26, x: 12, y: 2.6, z: -34 },
      { fill: SKY_COLORS.hillNear, trees: null, seed: 8, h: 40, w: 90, ht: 22, x: 6, y: 1.4, z: -24 },
    ];
    for (const l of layers) {
      const hill = new THREE.Mesh(
        new THREE.PlaneGeometry(l.w, l.ht),
        new THREE.MeshBasicMaterial({ map: hillTexture(l.fill, l.seed, l.h, l.trees), transparent: true, depthWrite: false }),
      );
      hill.position.set(l.x, l.y, l.z);
      this.scene.add(hill);
    }

    this.scene.add(makeGround());
    this.scene.add(makeGrass(this.gust));
    this.scene.add(makeFlowers(this.gust));
    this.scene.add(makeTree(this.gust, SUN_AT, this.camera.position).group);
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
          // Words float in front of everything, leaves included.
          const material =
            reuse?.material ?? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
          if (material.map !== tex) {
            material.map = tex;
            material.needsUpdate = true;
          }
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.5, size * 1.5), material);
          mesh.renderOrder = 10;
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
      c.position.x += dt * (c.userData.speed + this.gust.value * 0.8);
      if (c.position.x > 48) c.position.x = -48;
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
