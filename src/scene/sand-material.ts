import * as THREE from 'three/webgpu';
import {
  clamp,
  color,
  cos,
  float,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  smoothstep,
  step,
  texture,
  time,
  transformNormalToView,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { CARVE_RANGE, WATERLINE_Y, ZONE } from '../sand/field';

export const SAND_COLORS = {
  dry: '#dcb68c',
  wet: '#8d6c50',
  water: '#4f7c86',
  foam: '#eef0ea',
};

/**
 * Sand shading, built in TSL so it runs on WebGPU and the WebGL2 fallback.
 *
 * The CPU only uploads two small textures: carve depth (writing area) and
 * water state (whole beach). Normals, cavity darkening, wet sand, foam and
 * wind ripples are all derived here per pixel.
 */
export function createSandMaterial(carveTex: THREE.Texture, waterTex: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();

  const sx = positionWorld.x;
  const sy = positionWorld.z.negate();
  const zoneUV = vec2(sx.sub(ZONE.x0).div(ZONE.x1 - ZONE.x0), sy.sub(ZONE.y0).div(ZONE.y1 - ZONE.y0));
  const inZone = step(0.0005, zoneUV.x)
    .mul(step(zoneUV.x, 0.9995))
    .mul(step(0.0005, zoneUV.y))
    .mul(step(zoneUV.y, 0.9995));

  const decode = 255 / 127 * CARVE_RANGE;
  const carveAt = (du: number, dv: number) =>
    texture(carveTex, zoneUV.add(vec2(du, dv))).r.sub(128 / 255).mul(decode).mul(inZone);

  const tx = 1 / ZONE.w;
  const ty = 1 / ZONE.h;
  const dxWorld = (ZONE.x1 - ZONE.x0) / ZONE.w;
  const dyWorld = (ZONE.y1 - ZONE.y0) / ZONE.h;

  const c0 = carveAt(0, 0);
  const dcdx = carveAt(tx, 0).sub(carveAt(-tx, 0)).div(2 * dxWorld);
  const dcdy = carveAt(0, ty).sub(carveAt(0, -ty)).div(2 * dyWorld);
  // Average of a wider ring: grooves sit below it, so this gives cavity shading.
  const ring = carveAt(3 * tx, 3 * ty)
    .add(carveAt(-3 * tx, 3 * ty))
    .add(carveAt(3 * tx, -3 * ty))
    .add(carveAt(-3 * tx, -3 * ty))
    .mul(0.25);
  const cavity = clamp(ring.sub(c0).div(0.0045), 0, 1);

  const water = texture(waterTex, uv());
  const wet = water.r;
  const depth = water.g;
  const foam = water.b;

  // Wind ripples on dry sand, fading out toward the waterline where waves smooth them.
  const u = float(WATERLINE_Y).sub(sy);
  const k = (Math.PI * 2) / 0.07;
  const wobble = mx_noise_float(vec3(sx.mul(0.9), sy.mul(0.9), 3.1))
    .mul(7.0)
    .add(mx_noise_float(vec3(sx.mul(3.1), sy.mul(3.1), 5.3)).mul(1.6));
  const phase = sx.mul(0.42).add(sy).mul(k).add(wobble);
  // Patchy, low ripples: strongest far from the water, absent in places.
  const patch = smoothstep(-0.25, 0.55, mx_noise_float(vec3(sx.mul(0.32), sy.mul(0.32), 8.7)));
  const rippleAmp = smoothstep(1.2, 4.0, u).mul(0.00022).mul(patch).mul(float(1).sub(wet.mul(0.85)));
  const ripple = cos(phase).mul(rippleAmp).mul(k);

  const gx = dcdx.add(ripple.mul(0.42));
  const gy = dcdy.add(ripple);
  // Height field y = h(x, z) with z = -sand y: n = (-dh/dx, 1, -dh/dz) = (-dh/dx, 1, dh/dy).
  const n = normalize(vec3(gx.negate(), 1, gy));
  m.normalNode = transformNormalToView(n);

  const grain = mx_noise_float(vec3(sx.mul(7), sy.mul(7), 0.5))
    .mul(0.07)
    .add(mx_noise_float(vec3(sx.mul(95), sy.mul(95), 1.7)).mul(0.06));
  const dry = color(SAND_COLORS.dry).mul(grain.add(1));
  const wetSand = color(SAND_COLORS.wet).mul(grain.mul(0.6).add(1));
  let col = mix(dry, wetSand, clamp(wet.mul(0.9).add(cavity.mul(0.25)), 0, 1));
  col = col.mul(float(1).sub(cavity.mul(0.32)));

  const under = smoothstep(0.0, 0.5, depth);
  col = mix(col, color(SAND_COLORS.water), under.mul(0.85));
  // Foam is lacy: fine streaks along the shore, drifting slowly.
  const laceA = mx_noise_float(vec3(sx.mul(6), sy.mul(22), time.mul(0.3)));
  const laceB = mx_noise_float(vec3(sx.mul(17), sy.mul(40), time.mul(0.5).add(4)));
  const lace = smoothstep(0.05, 0.6, laceA.mul(0.65).add(laceB.mul(0.35)).mul(0.5).add(0.5));
  const foamAmt = clamp(foam.mul(lace.mul(0.75).add(0.25)), 0, 1);
  col = mix(col, color(SAND_COLORS.foam), foamAmt.mul(0.85));
  m.colorNode = col;

  let rough = mix(float(0.96), float(0.62), wet);
  rough = mix(rough, float(0.07), smoothstep(0.0, 0.12, depth));
  rough = mix(rough, float(0.75), foamAmt);
  m.roughnessNode = rough;
  m.metalnessNode = float(0);
  return m;
}
