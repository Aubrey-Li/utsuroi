import * as THREE from 'three/webgpu';
import { positionWorld, smoothstep } from 'three/tsl';
import { BEACH, WATERLINE_Y, ZONE, type SandField } from '../sand/field';
import { createSandMaterial, SAND_COLORS } from './sand-material';

/** Dusk palette: one fixed, designed mood for the ocean scene. */
// Equirectangular rows: 0 is straight up, 0.5 the horizon. Only ~0.4-0.5 is usually in view.
const SKY = [
  { at: 0.0, color: '#1a2048' },
  { at: 0.3, color: '#323d78' },
  { at: 0.4, color: '#5e5f9a' },
  { at: 0.44, color: '#9c7fae' },
  { at: 0.468, color: '#d48f95' },
  { at: 0.486, color: '#f0b48e' },
  { at: 0.5, color: '#f9d6a2' },
  { at: 0.53, color: '#d9a07f' },
  { at: 1.0, color: '#6a5a6a' },
];
const FOG = '#f0c39a';
const SUN_DIR = new THREE.Vector3(-0.32, 0.15, -1).normalize();

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export const POSES = {
  // Looking down at the writing, with a strip of sea and sky at the top.
  writing: { position: new THREE.Vector3(0, 1.95, 3.7), target: new THREE.Vector3(0, -0.66, -5.4) },
  // Turned toward the sea: more horizon, the words still in view below.
  sea: { position: new THREE.Vector3(0, 1.6, 4.2), target: new THREE.Vector3(0, -0.96, -14) },
} satisfies Record<string, CameraPose>;

function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  for (const s of SKY) g.addColorStop(s.at, s.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Tileable normal map of soft swell for the open sea. */
function swellNormals(size = 256): THREE.DataTexture {
  const h = new Float32Array(size * size);
  const waves = Array.from({ length: 7 }, (_, i) => ({
    kx: Math.round(Math.cos(i * 2.4) * (2 + i)),
    ky: Math.round(Math.sin(i * 2.4) * (2 + i)) + 1,
    a: 1 / (1 + i * 0.6),
    p: i * 1.7,
  }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.p);
      h[y * size + x] = v;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (xx: number, yy: number) => h[((yy + size) % size) * size + ((xx + size) % size)]!;
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.6;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.6;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      data[o] = (-dx / len) * 127 + 128;
      data[o + 1] = (-dy / len) * 127 + 128;
      data[o + 2] = (1 / len) * 127 + 128;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 16);
  tex.needsUpdate = true;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStick(): THREE.Group {
  const length = 1.35;
  const geo = new THREE.CylinderGeometry(0.016, 0.027, length, 10, 30);
  geo.translate(0, length / 2, 0);
  // A little crookedness so it reads as driftwood, not a dowel.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / length;
    pos.setX(i, pos.getX(i) + Math.sin(t * 5.1) * 0.018 * t + Math.sin(t * 17) * 0.002);
    pos.setZ(i, pos.getZ(i) + Math.sin(t * 3.3 + 1) * 0.014 * t);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#a89077', roughness: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

export class World {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(44, 1, 0.05, 600);
  readonly stick = makeStick();
  readonly sand: THREE.Mesh;
  readonly carveTex: THREE.DataTexture;
  readonly waterTex: THREE.DataTexture;
  private readonly seaNormals: THREE.DataTexture;
  private readonly lookTarget = new THREE.Vector3();
  private readonly camFrom: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  private readonly camTo: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  private camT = 1;
  private camDur = 1;
  private readonly stickLean = new THREE.Vector3();
  private readonly lastTip = new THREE.Vector3();
  /** Half the width of the writing (m); the camera backs off until it fits. */
  fitHalfWidth = 3.2;
  /** 0 = in hand over the sand, 1 = set aside out of view. */
  stickAway = 0;
  private stickAwayTarget = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly field: SandField,
  ) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const sky = skyTexture();
    this.scene.background = sky;
    this.scene.environment = sky;
    this.scene.environmentIntensity = 0.75;
    this.scene.fog = new THREE.Fog(FOG, 22, 190);

    const sun = new THREE.DirectionalLight('#ffd0a0', 3.0);
    sun.position.copy(SUN_DIR).multiplyScalar(30).add(new THREE.Vector3(0, 0, -1));
    sun.target.position.set(0, 0, -1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -4.5;
    sc.right = 4.5;
    sc.top = 4;
    sc.bottom = -4;
    sc.near = 5;
    sc.far = 60;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight('#9da6d8', '#d4a37c', 0.85));

    // The sun, low over the water, with a soft glow around it.
    const sunAt = SUN_DIR.clone().multiplyScalar(320);
    sunAt.y = 9;
    const disc = new THREE.Mesh(
      new THREE.SphereGeometry(6.5, 24, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe6bd').multiplyScalar(3), fog: false }),
    );
    disc.position.copy(sunAt);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: '#ffd9a6',
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    halo.position.copy(sunAt);
    halo.scale.setScalar(120);
    this.scene.add(disc, halo);

    // Sand: one plane over the visible beach. Detail comes from the shader, not geometry.
    this.carveTex = new THREE.DataTexture(field.carveBytes, ZONE.w, ZONE.h, THREE.RedFormat, THREE.UnsignedByteType);
    this.carveTex.magFilter = THREE.LinearFilter;
    this.carveTex.minFilter = THREE.LinearFilter;
    this.carveTex.needsUpdate = true;
    this.waterTex = new THREE.DataTexture(field.waterBytes, BEACH.w, BEACH.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.waterTex.magFilter = THREE.LinearFilter;
    this.waterTex.minFilter = THREE.LinearFilter;
    this.waterTex.needsUpdate = true;

    const bw = BEACH.x1 - BEACH.x0;
    const bh = BEACH.y1 - BEACH.y0;
    const sandGeo = new THREE.PlaneGeometry(bw, bh, 32, 16);
    sandGeo.rotateX(-Math.PI / 2);
    sandGeo.translate((BEACH.x0 + BEACH.x1) / 2, 0, -(BEACH.y0 + BEACH.y1) / 2);
    this.sand = new THREE.Mesh(sandGeo, createSandMaterial(this.carveTex, this.waterTex));
    this.sand.receiveShadow = true;
    this.scene.add(this.sand);

    // Open sea, from just under the waterline out to the fog.
    this.seaNormals = swellNormals();
    const seaGeo = new THREE.PlaneGeometry(900, 400, 1, 1);
    seaGeo.rotateX(-Math.PI / 2);
    seaGeo.translate(0, 0.004, -WATERLINE_Y - 200);
    const seaMat = new THREE.MeshStandardNodeMaterial({
      color: SAND_COLORS.water,
      roughness: 0.24,
      metalness: 0,
      normalMap: this.seaNormals,
      normalScale: new THREE.Vector2(0.16, 0.16),
      transparent: true,
    });
    // Fade the sea in over the first meter so it blends into the shallow water drawn on the sand.
    seaMat.opacityNode = smoothstep(WATERLINE_Y + 0.1, WATERLINE_Y + 1.3, positionWorld.z.negate());
    this.scene.add(new THREE.Mesh(seaGeo, seaMat));

    this.scene.add(this.stick);
    this.setPose(POSES.writing, 0);
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
    // Tall screens get a wider lens so there's still sky and sea above the sand.
    this.camera.fov = this.camera.aspect < 0.8 ? 54 : 44;
    this.camera.updateProjectionMatrix();
  }

  /** Glides the camera to a pose. Narrow screens pull back so the writing still fits. */
  setPose(pose: CameraPose, seconds: number): void {
    this.camFrom.position.copy(this.camera.position);
    this.camFrom.target.copy(this.lookTarget);
    this.camTo.position.copy(pose.position);
    this.camTo.target.copy(pose.target);
    this.camT = seconds > 0 ? 0 : 1;
    this.camDur = Math.max(seconds, 1e-3);
    if (seconds <= 0) {
      this.camFrom.position.copy(pose.position);
      this.camFrom.target.copy(pose.target);
    }
  }

  setStickAway(away: boolean): void {
    this.stickAwayTarget = away ? 1 : 0;
  }

  /** Places the stick so its tip is at a sand position, leaning into its motion. */
  placeStick(x: number, y: number, lift: number, dt: number): void {
    const surface = this.field.carveAt(x, y);
    const tip = new THREE.Vector3(x, surface + lift - 0.002, -y);
    if (dt > 0) {
      const vx = (tip.x - this.lastTip.x) / dt;
      const vz = (tip.z - this.lastTip.z) / dt;
      const target = new THREE.Vector3(THREE.MathUtils.clamp(vx * 0.07, -0.25, 0.25), 0, THREE.MathUtils.clamp(vz * 0.07, -0.25, 0.25));
      this.stickLean.lerp(target, 1 - Math.exp(-dt * 8));
      this.stickAway += (this.stickAwayTarget - this.stickAway) * (1 - Math.exp(-dt * 2.2));
    }
    this.lastTip.copy(tip);
    const away = this.stickAway;
    tip.x += away * 2.2;
    tip.y += away * 1.6;
    tip.z += away * 1.2;
    const dir = new THREE.Vector3(0.34, 1, 0.62).add(this.stickLean).normalize();
    this.stick.position.copy(tip);
    this.stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.stick.visible = away < 0.98;
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
    this.seaNormals.offset.x += dt * 0.004;
    this.seaNormals.offset.y += dt * 0.011;

    if (this.camT < 1) this.camT = Math.min(1, this.camT + dt / this.camDur);
    const e = this.camT * this.camT * (3 - 2 * this.camT);
    // Distance from the writing pose to the middle of the text is about 4.9 m.
    const halfView = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect * 4.9;
    const fit = Math.min(2.2, Math.max(1, this.fitHalfWidth / halfView));
    const pos = this.camFrom.position.clone().lerp(this.camTo.position, e);
    this.lookTarget.copy(this.camFrom.target).lerp(this.camTo.target, e);
    // Pull back along the view direction on narrow screens.
    pos.sub(this.lookTarget).multiplyScalar(Math.pow(fit, 0.85)).add(this.lookTarget);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.lookTarget);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
