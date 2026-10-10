import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  color,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { CARVE_RANGE, WATERLINE_Y, ZONE } from '../sand/field';

/**
 * The ocean scene's palette. The look is painted rather than photographed:
 * a few designed tones per surface, colored shadows and crisp foam, the way
 * Journey and The Witness handle light.
 */
export const PALETTE = {
  sandLight: '#ffd9a8',
  sandMid: '#f2b48c',
  sandShadow: '#c9837c',
  groove: '#9c5f6c',
  sandWet: '#d4928a',
  sandWetShadow: '#a96f78',
  sparkle: '#fff8e8',
  shallow: '#8fe0d2',
  shallowDeep: '#5cc2c2',
  foam: '#fff6ea',
  shadowTint: '#8a5f86',
  seaNear: '#5cc2c2',
  seaMid: '#3d97b3',
  seaFar: '#7a8cc4',
  seaLine: '#bff2e6',
  glint: '#fff1cf',
};

/** Direction the sand's relief is lit from: high and over the sea, so grooves read like ink. */
export const KEY_LIGHT = new THREE.Vector3(-0.4, 0.62, -0.68).normalize();

/** Direction of the low evening sun, for the glitter on the water. */
export const SUN_DIR = new THREE.Vector3(-0.32, 0.15, -1).normalize();

/** Shadows are cast from higher than the sun really is, so they stay close to what casts them. */
export const SHADOW_DIR = new THREE.Vector3(-0.3, 0.55, -1).normalize();

const vec3Uniform = () => uniform(new THREE.Vector3());
const floatUniform = () => uniform(0);
type Vec3Uniform = ReturnType<typeof vec3Uniform>;
type FloatUniform = ReturnType<typeof floatUniform>;

/** Cheap hash of a 2D cell, for sparkles. */
function hash2(p: Parameters<typeof dot>[0]) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));
}

export interface SandMaterial {
  material: THREE.MeshBasicNodeMaterial;
  /** Ends of the stick, so the sand can draw its shadow. */
  stickTip: Vec3Uniform;
  stickTop: Vec3Uniform;
}

export function createSandMaterial(carveTex: THREE.Texture, waterTex: THREE.Texture): SandMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const stickTip = vec3Uniform();
  const stickTop = vec3Uniform();

  const sx = positionWorld.x;
  const sy = positionWorld.z.negate();
  const zoneUV = vec2(sx.sub(ZONE.x0).div(ZONE.x1 - ZONE.x0), sy.sub(ZONE.y0).div(ZONE.y1 - ZONE.y0));
  const inZone = step(0.0005, zoneUV.x)
    .mul(step(zoneUV.x, 0.9995))
    .mul(step(0.0005, zoneUV.y))
    .mul(step(zoneUV.y, 0.9995));

  const decode = (255 / 127) * CARVE_RANGE;
  const carveAt = (du: number, dv: number) =>
    texture(carveTex, zoneUV.add(vec2(du, dv))).r.sub(128 / 255).mul(decode).mul(inZone);

  const tx = 1 / ZONE.w;
  const ty = 1 / ZONE.h;
  const dxWorld = (ZONE.x1 - ZONE.x0) / ZONE.w;
  const dyWorld = (ZONE.y1 - ZONE.y0) / ZONE.h;

  const c0 = carveAt(0, 0);
  const dcdx = carveAt(tx, 0).sub(carveAt(-tx, 0)).div(2 * dxWorld);
  const dcdy = carveAt(0, ty).sub(carveAt(0, -ty)).div(2 * dyWorld);
  const ring = carveAt(3 * tx, 3 * ty)
    .add(carveAt(-3 * tx, 3 * ty))
    .add(carveAt(3 * tx, -3 * ty))
    .add(carveAt(-3 * tx, -3 * ty))
    .mul(0.25);
  const cavity = clamp(ring.sub(c0).div(0.004), 0, 1);

  const water = texture(waterTex, uv());
  const wet = water.r;
  const depth = water.g.mul(0.9); // meters behind the wave front
  const foam = water.b;

  // Relief lighting in a few soft bands instead of a physical falloff.
  // Height field y = h(x, z) with z = -sand y: n = (-dh/dx, 1, dh/dy).
  const n = normalize(vec3(dcdx.negate(), 1, dcdy));
  const lam = dot(n, vec3(KEY_LIGHT.x, KEY_LIGHT.y, KEY_LIGHT.z));
  const toMid = smoothstep(0.5, 0.56, lam);
  const toLight = smoothstep(0.74, 0.8, lam);

  // Broad, painterly variation across the beach instead of fine grain.
  const patch = mx_noise_float(vec3(sx.mul(0.35), sy.mul(0.35), 1.3)).mul(0.5).add(0.5);
  const mid = mix(color(PALETTE.sandMid), color(PALETTE.sandLight), patch.mul(0.25));
  let col = mix(mix(color(PALETTE.sandShadow), mid, toMid), color(PALETTE.sandLight), toLight);

  // Soft wind ripples, as tint only, away from the water.
  const u = float(WATERLINE_Y).sub(sy);
  const warp = mx_noise_float(vec3(sx.mul(0.8), sy.mul(0.8), 3.1)).mul(6.0);
  const ripple = sin(sx.mul(0.4).add(sy).mul((Math.PI * 2) / 0.11).add(warp)).mul(0.5).add(0.5);
  const rippleAmt = smoothstep(1.5, 4.5, u).mul(smoothstep(0.1, 0.7, patch)).mul(0.07);
  col = mix(col, color(PALETTE.sandShadow), ripple.mul(rippleAmt));

  // Grooves get an inked bottom.
  col = mix(col, color(PALETTE.groove), smoothstep(0.15, 0.9, cavity).mul(0.75));

  // Wet sand: darker and cooler, keeping its banding.
  const wetCol = mix(mix(color(PALETTE.sandWetShadow), color(PALETTE.sandWet), toMid), col, 0.35);
  col = mix(col, wetCol, smoothstep(0.05, 0.6, wet));

  // Long shadow of the stick, projected along the low sun. Softer toward the far end.
  const project = (p: Vec3Uniform) =>
    vec2(p.x.sub(p.y.mul(SHADOW_DIR.x / SHADOW_DIR.y)), p.z.sub(p.y.mul(SHADOW_DIR.z / SHADOW_DIR.y)));
  const a = project(stickTip);
  const b = project(stickTop);
  const pa = vec2(positionWorld.x, positionWorld.z).sub(a);
  const ba = b.sub(a);
  const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0, 1);
  const dist = length(pa.sub(ba.mul(h)));
  const width = float(0.016).add(h.mul(0.04));
  const shadow = float(1).sub(smoothstep(width.mul(0.55), width, dist)).mul(float(1).sub(h.mul(0.55)));
  col = mix(col, col.mul(color(PALETTE.shadowTint)), shadow.mul(0.7));

  // Journey-style sparkle on dry, lit sand.
  const hs = hash2(floor(vec2(sx, sy).mul(85)));
  const twinkle = pow(sin(time.mul(2.2).add(hs.mul(80))).mul(0.5).add(0.5), 14);
  const near = float(1).sub(smoothstep(4, 9, length(positionWorld.sub(cameraPosition))));
  const sparkle = step(0.992, hs).mul(twinkle).mul(float(1).sub(wet)).mul(toMid).mul(near);
  col = mix(col, color(PALETTE.sparkle), sparkle);

  // Shallow water running over the sand, turquoise and clear.
  const sheet = smoothstep(0.0, 0.18, depth);
  const waterCol = mix(color(PALETTE.shallow), color(PALETTE.shallowDeep), smoothstep(0.15, 0.8, depth));
  col = mix(col, waterCol, sheet.mul(0.9));

  // A crisp line of foam at the wave's edge, and streaks of it left behind.
  const edgeNoise = mx_noise_float(vec3(sx.mul(3.0), time.mul(0.4), 2.0)).mul(0.035);
  const edge = smoothstep(0.0, 0.012, depth).mul(
    float(1).sub(smoothstep(edgeNoise.add(0.06), edgeNoise.add(0.075), depth)),
  );
  const streaks = mx_noise_float(vec3(sx.mul(4), sy.mul(16), time.mul(0.25)))
    .mul(0.65)
    .add(mx_noise_float(vec3(sx.mul(11), sy.mul(30), 5)).mul(0.35))
    .mul(0.5)
    .add(0.5);
  const foamAmt = clamp(max(edge, foam.mul(step(0.62, streaks)).mul(0.85)), 0, 1);
  col = mix(col, color(PALETTE.foam), foamAmt);

  m.colorNode = col;
  return { material: m, stickTip, stickTop };
}

export interface SeaMaterial {
  material: THREE.MeshBasicNodeMaterial;
  cameraX: FloatUniform;
  cameraZ: FloatUniform;
}

/** Flat, banded sea with lines of swell rolling in and glitter toward the sun. */
export function createSeaMaterial(): SeaMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true });
  const cameraX = floatUniform();
  const cameraZ = floatUniform();
  const d = positionWorld.z.negate().sub(WATERLINE_Y); // meters out from the waterline

  let col = mix(color(PALETTE.seaNear), color(PALETTE.seaMid), smoothstep(0.5, 9, d));
  col = mix(col, color(PALETTE.seaFar), smoothstep(12, 90, d));

  // Swell lines rolling toward the shore.
  const wob = mx_noise_float(vec3(positionWorld.x.mul(0.12), d.mul(0.08), 1.7)).mul(3.0);
  const crest = sin(d.mul(1.3).add(wob).add(time.mul(1.1))).mul(0.5).add(0.5);
  const line = smoothstep(0.9, 0.96, crest).mul(float(1).sub(smoothstep(3, 28, d)));
  col = mix(col, color(PALETTE.seaLine), line.mul(0.55));

  // Glitter along the path toward the sun.
  const along = positionWorld.z.sub(cameraZ);
  const sunX = cameraX.add(along.mul(SUN_DIR.x / SUN_DIR.z));
  const spread = abs(along).mul(0.09).add(0.4);
  const onPath = smoothstep(1, 0, abs(positionWorld.x.sub(sunX)).div(spread));
  const hs = hash2(floor(vec2(positionWorld.x.mul(7), d.mul(12))));
  const twinkle = pow(sin(time.mul(3).add(hs.mul(60))).mul(0.5).add(0.5), 6);
  col = mix(col, color(PALETTE.glint), step(0.86, hs).mul(twinkle).mul(onPath));

  m.colorNode = col;
  // Fade in over the first meter so the sea blends into the shallow water drawn on the sand.
  m.opacityNode = smoothstep(0.1, 1.3, d);
  return { material: m, cameraX, cameraZ };
}
