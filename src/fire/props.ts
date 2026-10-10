import * as THREE from 'three/webgpu';
import { cameraPosition, dot, float, length, max, mix, normalize, normalWorld, positionLocal, positionWorld, pow, reflect, smoothstep, uniform, vec3 } from 'three/tsl';

const vec3Uniform = (v: THREE.Vector3) => uniform(v);
const floatUniform = (v = 0) => uniform(v);
type Vec3Uniform = ReturnType<typeof vec3Uniform>;
type FloatUniform = ReturnType<typeof floatUniform>;

/** A palette color as a vec3 node (linear), for arithmetic with lighting. */
export function rgb(hex: string) {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
}

const LIGHT_COLORS = { candle: '#ffb86b', fire: '#ff9a4a', ambient: '#050303' };

/** Lighting shared by every surface: the candle, the burning page, and the dark. */
export function lightAt(
  candle: ReturnType<typeof vec3Uniform>,
  flicker: ReturnType<typeof floatUniform>,
  firePos: ReturnType<typeof vec3Uniform>,
  fire: ReturnType<typeof floatUniform>,
) {
  const dc = length(positionWorld.sub(candle));
  const df = length(positionWorld.sub(firePos));
  // Candlelight falls off quickly: the room beyond the desk stays dark.
  const fromCandle = rgb(LIGHT_COLORS.candle).mul(flicker.mul(1.55).div(dc.mul(dc).mul(1.5).add(1)));
  const fromFire = rgb(LIGHT_COLORS.fire).mul(fire.mul(flicker).mul(1.15).div(df.mul(df).mul(1.1).add(1)));
  return rgb(LIGHT_COLORS.ambient).add(fromCandle).add(fromFire);
}


/** The lighting term every surface multiplies by. */
type LightNode = ReturnType<typeof lightAt>;

export const PROP_COLORS = {
  waxShadow: '#7d6a55',
  waxLit: '#e6d5b6',
  waxGlow: '#ffd59a',
  waxPool: '#f1cf98',
  brassDark: '#3a2814',
  brass: '#7a5a2c',
  brassShine: '#ffd58a',
  lacquer: '#16141f',
  lacquerShine: '#e9c48f',
  gold: '#b88a3e',
  nib: '#c9b28a',
};

/** Glossy highlight of the candle flame on a surface: how directly it mirrors the flame toward the eye. */
export function flameShine(flame: Vec3Uniform, flicker: FloatUniform, sharpness: number, reach = 2.2) {
  const toFlame = normalize(flame.sub(positionWorld));
  const toEye = normalize(cameraPosition.sub(positionWorld));
  const mirror = reflect(toEye.negate(), normalWorld);
  const d = length(flame.sub(positionWorld));
  const falloff = float(1).div(d.mul(d).mul(1 / reach).add(1));
  return pow(max(dot(mirror, toFlame), 0), sharpness).mul(falloff).mul(flicker);
}

/** A pillar candle that has burned a while: a melt pool, a raised rim, and drips down the side. */
function candleGeometry(): THREE.BufferGeometry {
  const profile = [
    [0, 0],
    [0.14, 0],
    [0.142, 0.05],
    [0.139, 0.42],
    [0.136, 0.55],
    [0.13, 0.582],
    [0.121, 0.6],
    [0.108, 0.588],
    [0.07, 0.569],
    [0, 0.562],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(profile, 48);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const drips = [
    { a: 0.7, w: 0.13, end: 0.26 },
    { a: 2.2, w: 0.09, end: 0.38 },
    { a: 3.9, w: 0.15, end: 0.18 },
    { a: 5.3, w: 0.08, end: 0.33 },
  ];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.12 || y > 0.59) continue;
    const a = Math.atan2(z, x) + Math.PI;
    let bump = 0;
    for (const d of drips) {
      const da = Math.atan2(Math.sin(a - d.a), Math.cos(a - d.a));
      // A drip is thickest at its rounded bottom end and runs up to the rim.
      const along = THREE.MathUtils.smoothstep(y, d.end - 0.02, d.end + 0.03) * (1 - THREE.MathUtils.smoothstep(y, 0.57, 0.6) * 0.5);
      bump += 0.011 * Math.exp(-((da / d.w) ** 2)) * along * (1 + 0.6 * Math.exp(-(((y - d.end - 0.02) / 0.03) ** 2)));
    }
    const k = (r + bump) / r;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function holderGeometry(): THREE.BufferGeometry {
  const profile = [
    [0, 0],
    [0.29, 0],
    [0.31, 0.012],
    [0.305, 0.034],
    [0.28, 0.04],
    [0.18, 0.026],
    [0.16, 0.03],
    [0, 0.028],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(profile, 56);
}

/** The candle and its brass holder. Its own flame lights it from above. */
export function makeCandle(at: THREE.Vector3, light: LightNode, flame: Vec3Uniform, flicker: FloatUniform): THREE.Group {
  const group = new THREE.Group();

  const wax = new THREE.MeshBasicNodeMaterial();
  const h = smoothstep(0.0, 0.6, positionLocal.y);
  const top = smoothstep(0.3, 0.95, normalWorld.y);
  const lit = mix(rgb(PROP_COLORS.waxShadow), rgb(PROP_COLORS.waxLit), h.mul(0.75).add(top.mul(0.25)));
  // Wax near the flame glows warm, the way it lets light through.
  const glow = mix(lit, rgb(PROP_COLORS.waxGlow), pow(h, 5).mul(0.55));
  const pool = smoothstep(0.075, 0.05, length(vec3(positionLocal.x, 0, positionLocal.z))).mul(smoothstep(0.55, 0.565, positionLocal.y));
  wax.colorNode = mix(glow, rgb(PROP_COLORS.waxPool), pool)
    .mul(flicker.mul(0.2).add(0.7))
    .mul(h.mul(0.6).add(0.22))
    .add(flameShine(flame, flicker, 18, 0.6).mul(0.25));
  const body = new THREE.Mesh(candleGeometry(), wax);

  const brass = new THREE.MeshBasicNodeMaterial();
  brass.colorNode = mix(rgb(PROP_COLORS.brassDark), rgb(PROP_COLORS.brass), smoothstep(0.2, 1, normalWorld.y))
    .mul(light)
    .add(rgb(PROP_COLORS.brassShine).mul(flameShine(flame, flicker, 14, 1.2).mul(1.4)));
  const holder = new THREE.Mesh(holderGeometry(), brass);

  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.07, 6), new THREE.MeshBasicMaterial({ color: '#1a1210' }));
  wick.position.y = 0.6;
  wick.rotation.z = 0.12;

  body.position.y = 0.03;
  group.add(holder, body, wick);
  group.position.copy(at);
  return group;
}

/** A fountain pen left beside the page, catching the candlelight along its barrel. */
export function makePen(light: LightNode, flame: Vec3Uniform, flicker: FloatUniform): THREE.Group {
  const group = new THREE.Group();
  const lacquer = new THREE.MeshBasicNodeMaterial();
  lacquer.colorNode = rgb(PROP_COLORS.lacquer)
    .mul(light.mul(1.4).add(0.04))
    .add(rgb(PROP_COLORS.lacquerShine).mul(flameShine(flame, flicker, 40, 1.6)));
  const metal = new THREE.MeshBasicNodeMaterial();
  metal.colorNode = rgb(PROP_COLORS.gold).mul(light).add(rgb(PROP_COLORS.brassShine).mul(flameShine(flame, flicker, 20, 1.6).mul(1.2)));
  const nibMat = new THREE.MeshBasicNodeMaterial();
  nibMat.colorNode = rgb(PROP_COLORS.nib).mul(light).add(rgb('#ffffff').mul(flameShine(flame, flicker, 30, 1.6)));

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.032, 0.62, 20), lacquer);
  barrel.position.y = 0.31;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.038, 0.36, 20), lacquer);
  cap.position.y = 0.62 + 0.18;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.035, 20), metal);
  band.position.y = 0.64;
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.26, 0.012), metal);
  clip.position.set(0, 0.84, 0.043);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.1, 16), metal);
  grip.position.y = -0.05;
  const nib = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.1, 16), nibMat);
  nib.position.y = -0.15;
  nib.rotation.x = Math.PI;
  group.add(barrel, cap, band, clip, grip, nib);
  // Lying on the desk, angled a little toward the page.
  group.rotation.set(0, 0, 0);
  group.rotateZ(Math.PI / 2);
  group.position.set(1.75, 0.04, 0.85);
  const holder = new THREE.Group();
  holder.add(group);
  holder.rotation.y = 0.5;
  holder.position.set(0, 0, 0);
  return holder;
}
