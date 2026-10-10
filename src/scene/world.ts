import * as THREE from 'three/webgpu';
import { color, dot, mix, normalLocal, normalWorld, positionLocal, smoothstep, vec3 } from 'three/tsl';
import { BEACH, WATERLINE_Y, ZONE, type SandField } from '../sand/field';
import { createSandMaterial, createSeaMaterial, KEY_LIGHT, SUN_DIR, type SandMaterial, type SeaMaterial } from './sand-material';

// Painted dusk sky. Equirectangular rows: 0 is straight up, 0.5 the horizon.
const SKY = [
  { at: 0.0, color: '#2e2f6b' },
  { at: 0.3, color: '#4a4489' },
  { at: 0.4, color: '#8a63a1' },
  { at: 0.445, color: '#d9849a' },
  { at: 0.475, color: '#f6a98f' },
  { at: 0.5, color: '#ffd8a4' },
  { at: 0.52, color: '#f2b49a' },
  { at: 1.0, color: '#7a6a8a' },
];
const FOG = '#f4c0a0';

/**
 * The view is one tilt between two ends: looking down at the sand (0) and
 * out to the horizon (1). The eye also lowers as you look up, the way you'd
 * crouch to watch the sea. Yaw turns left and right.
 */
const VIEW = {
  down: { position: new THREE.Vector3(0, 3.35, 2.8), pitch: -Math.atan2(3.35, 4.15) },
  up: { position: new THREE.Vector3(0, 1.7, 3.4), pitch: THREE.MathUtils.degToRad(2) },
  maxYaw: 0.6,
};

function skyTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const s of SKY) g.addColorStop(s.at, s.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // A few long, thin bands of cloud near the horizon, lit from below by the setting sun.
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 14; i++) {
    const y = h * (0.415 + rnd() * 0.07);
    const x = rnd() * w;
    const len = 260 + rnd() * 520;
    const thick = 1.6 + rnd() * 3.2;
    const low = y / h > 0.45;
    ctx.fillStyle = low ? 'rgba(255,205,175,0.7)' : 'rgba(205,140,185,0.6)';
    ctx.beginPath();
    ctx.ellipse(x, y, len / 2, thick, 0, 0, Math.PI * 2);
    ctx.fill();
    // Brighter underside.
    ctx.fillStyle = 'rgba(255,232,200,0.55)';
    ctx.beginPath();
    ctx.ellipse(x + len * 0.05, y + thick * 0.6, len * 0.4, thick * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // A solid disc inside stepped rings, for a painted sun.
  for (const ring of [
    { r: 0.5, a: 0.1 },
    { r: 0.34, a: 0.16 },
    { r: 0.22, a: 0.24 },
  ]) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * ring.r * 0.8, size / 2, size / 2, size * ring.r);
    grad.addColorStop(0, `rgba(255,255,255,${ring.a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * ring.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.065, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Two-tone shading lit by the key light. */
function toonMaterial(light: string, dark: string): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const lam = dot(normalWorld, vec3(KEY_LIGHT.x, KEY_LIGHT.y, KEY_LIGHT.z));
  m.colorNode = mix(color(dark), color(light), smoothstep(0.1, 0.2, lam));
  return m;
}

function makeStick(): THREE.Group {
  const length = 1.35;
  const geo = new THREE.CylinderGeometry(0.017, 0.028, length, 10, 30);
  geo.translate(0, length / 2, 0);
  // A little crookedness so it reads as driftwood, not a dowel.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / length;
    pos.setX(i, pos.getX(i) + Math.sin(t * 5.1) * 0.018 * t + Math.sin(t * 17) * 0.002);
    pos.setZ(i, pos.getZ(i) + Math.sin(t * 3.3 + 1) * 0.014 * t);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, toonMaterial('#c99a78', '#8d5f5a'));
  // Inverted hull: a slightly larger back-facing copy draws the outline.
  const outlineMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  outlineMat.colorNode = color('#5a3442');
  outlineMat.positionNode = positionLocal.add(normalLocal.mul(0.0045));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, outlineMat), body);
  return group;
}

export class World {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 1, 0.05, 600);
  readonly stick = makeStick();
  readonly carveTex: THREE.DataTexture;
  readonly waterTex: THREE.DataTexture;
  private readonly sand: SandMaterial;
  private readonly sea: SeaMaterial;
  /** Where the view is heading, and where it is now. */
  private readonly view = { tilt: 0, yaw: 0, rate: 10 };
  private tiltNow = 0;
  private yawNow = 0;
  private readonly stickLean = new THREE.Vector3();
  private readonly lastTip = new THREE.Vector3();

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly field: SandField,
  ) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Colors are designed, not lit, so they go to the screen as chosen.
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(FOG, 30, 210);

    // The sun, low over the water, with a stepped halo.
    const sunAt = SUN_DIR.clone().multiplyScalar(320);
    sunAt.y = 11;
    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff0cc', transparent: true, depthWrite: false, fog: false }),
    );
    sun.position.copy(sunAt);
    sun.scale.setScalar(110);
    this.scene.add(sun);

    // Sand: one plane over the visible beach. Detail comes from the shader, not geometry.
    this.carveTex = new THREE.DataTexture(field.carveBytes, ZONE.w, ZONE.h, THREE.RedFormat, THREE.UnsignedByteType);
    this.carveTex.magFilter = THREE.LinearFilter;
    this.carveTex.minFilter = THREE.LinearFilter;
    this.carveTex.needsUpdate = true;
    this.waterTex = new THREE.DataTexture(field.waterBytes, BEACH.w, BEACH.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.waterTex.magFilter = THREE.LinearFilter;
    this.waterTex.minFilter = THREE.LinearFilter;
    this.waterTex.needsUpdate = true;

    const sandGeo = new THREE.PlaneGeometry(BEACH.x1 - BEACH.x0, BEACH.y1 - BEACH.y0, 32, 16);
    sandGeo.rotateX(-Math.PI / 2);
    sandGeo.translate((BEACH.x0 + BEACH.x1) / 2, 0, -(BEACH.y0 + BEACH.y1) / 2);
    this.sand = createSandMaterial(this.carveTex, this.waterTex);
    this.scene.add(new THREE.Mesh(sandGeo, this.sand.material));

    const seaGeo = new THREE.PlaneGeometry(900, 400, 1, 1);
    seaGeo.rotateX(-Math.PI / 2);
    seaGeo.translate(0, 0.004, -WATERLINE_Y - 200);
    this.sea = createSeaMaterial();
    this.scene.add(new THREE.Mesh(seaGeo, this.sea.material));

    this.scene.add(this.stick);
  }

  async init(): Promise<void> {
    await this.renderer.init();
  }

  get usingWebGPU(): boolean {
    const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    return Boolean(backend?.isWebGPUBackend);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Tall screens get a wider lens so the waterline stays in view above the writing.
    this.camera.fov = this.camera.aspect < 0.8 ? 58 : 46;
    this.camera.updateProjectionMatrix();
  }

  get tilt(): number {
    return this.view.tilt;
  }

  get yaw(): number {
    return this.view.yaw;
  }

  /**
   * Sets where the view should go. `rate` is how quickly it follows:
   * high while dragging, low for a slow glide.
   */
  setView(tilt: number, yaw: number, rate = 12): void {
    this.view.tilt = THREE.MathUtils.clamp(tilt, 0, 1);
    this.view.yaw = THREE.MathUtils.clamp(yaw, -VIEW.maxYaw, VIEW.maxYaw);
    this.view.rate = rate;
  }

  /** Moves the view there immediately. */
  jumpView(tilt: number, yaw: number): void {
    this.setView(tilt, yaw);
    this.tiltNow = this.view.tilt;
    this.yawNow = this.view.yaw;
  }

  /** Places the stick so its tip is at a sand position, leaning into its motion. */
  placeStick(x: number, y: number, lift: number, dt: number): void {
    const surface = this.field.carveAt(x, y);
    const tip = new THREE.Vector3(x, surface + lift - 0.002, -y);
    if (dt > 0) {
      const vx = (tip.x - this.lastTip.x) / dt;
      const vz = (tip.z - this.lastTip.z) / dt;
      const target = new THREE.Vector3(
        THREE.MathUtils.clamp(vx * 0.07, -0.25, 0.25),
        0,
        THREE.MathUtils.clamp(vz * 0.07, -0.25, 0.25),
      );
      this.stickLean.lerp(target, 1 - Math.exp(-dt * 8));
    }
    this.lastTip.copy(tip);
    const dir = new THREE.Vector3(0.42, 1, 0.22).add(this.stickLean).normalize();
    this.stick.position.copy(tip);
    this.stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.sand.stickTip.value.copy(tip);
    this.sand.stickTop.value.copy(tip).addScaledVector(dir, 1.35);
  }

  /** Converts a pointer position (CSS pixels) to a sand position, or null if it misses the beach. */
  pick(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    return { x: hit.x, y: -hit.z };
  }

  update(dt: number, carveChanged: boolean): void {
    if (carveChanged) this.carveTex.needsUpdate = true;
    this.waterTex.needsUpdate = true;

    const follow = 1 - Math.exp(-dt * this.view.rate);
    this.tiltNow += (this.view.tilt - this.tiltNow) * follow;
    this.yawNow += (this.view.yaw - this.yawNow) * follow;
    const e = this.tiltNow * this.tiltNow * (3 - 2 * this.tiltNow);
    const pos = VIEW.down.position.clone().lerp(VIEW.up.position, e);
    const pitch = VIEW.down.pitch + (VIEW.up.pitch - VIEW.down.pitch) * e;
    const dir = new THREE.Vector3(
      Math.sin(this.yawNow) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(this.yawNow) * Math.cos(pitch),
    );
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.clone().add(dir));
    this.sea.cameraX.value = pos.x;
    this.sea.cameraZ.value = pos.z;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
