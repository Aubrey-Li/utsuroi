import * as THREE from 'three/webgpu';
import { attribute, color, dot, mix, mx_noise_float, normalWorld, positionLocal, sin, smoothstep, texture, time, uniform, uv, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../strokes/random';

const floatUniform = () => uniform(0);
type FloatUniform = ReturnType<typeof floatUniform>;

export const TREE_COLORS = {
  barkShadow: '#4a3332',
  barkMid: '#6f4d3d',
  barkLit: '#a17a5b',
  leafDeep: '#24553a',
  leafDark: '#2f6b3f',
  leafMid: '#4f9a48',
  leafLit: '#8cc85a',
  leafGlow: '#d9f28c',
};

/** Where light comes from for the bark and leaves: the sun, high on the right. */
const KEY = new THREE.Vector3(0.62, 0.7, 0.35).normalize();

interface Limb {
  curve: THREE.CatmullRomCurve3;
  r0: number;
  r1: number;
}

/** A tube that narrows from r0 to r1 along its curve. */
function taperedTube(limb: Limb, tubular = 22, radial = 9): THREE.BufferGeometry {
  const geo = new THREE.TubeGeometry(limb.curve, tubular, 1, radial, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const center = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    limb.curve.getPointAt(t, center);
    const r = limb.r0 + (limb.r1 - limb.r0) * Math.pow(t, 0.8);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(center).multiplyScalar(r).add(center);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** Leaf shapes drawn in gray, so each leaf can be tinted its own green. Four variants side by side. */
function leafAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const shapes = [
    { w: 0.42, tip: 0.0 },
    { w: 0.5, tip: 0.05 },
    { w: 0.34, tip: -0.03 },
    { w: 0.46, tip: 0.08 },
  ];
  shapes.forEach((s, i) => {
    const x0 = i * 256;
    const cx = x0 + 128;
    const w = 128 * s.w;
    ctx.save();
    // Blade: pointed at the top, rounded at the base, slightly asymmetric.
    ctx.beginPath();
    ctx.moveTo(cx, 242);
    ctx.bezierCurveTo(cx - w * 1.3, 200, cx - w * 1.1, 70, cx + s.tip * 128, 10);
    ctx.bezierCurveTo(cx + w * 1.15, 70, cx + w * 1.25, 200, cx, 242);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
    g.addColorStop(0, 'rgb(170,170,170)');
    g.addColorStop(0.5, 'rgb(235,235,235)');
    g.addColorStop(1, 'rgb(200,200,200)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    // Midrib and veins, lighter than the blade.
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, 244);
    ctx.quadraticCurveTo(cx + s.tip * 60, 120, cx + s.tip * 128, 12);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    for (let k = 0; k < 6; k++) {
      const y = 200 - k * 30;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s.tip * (244 - y) * 0.5, y);
        ctx.quadraticCurveTo(cx + side * w * 0.6, y - 18, cx + side * w * 0.95, y - 44);
        ctx.stroke();
      }
    }
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function barkMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const lam = dot(normalWorld, vec3(KEY.x, KEY.y, KEY.z));
  const base = mix(mix(color(TREE_COLORS.barkShadow), color(TREE_COLORS.barkMid), smoothstep(-0.25, 0.1, lam)), color(TREE_COLORS.barkLit), smoothstep(0.35, 0.6, lam));
  // Long streaks of bark running along each limb.
  const streak = mx_noise_float(vec3(uv().y.mul(9), uv().x.mul(70), 4.2)).mul(0.5).add(0.5);
  m.colorNode = mix(base, base.mul(0.62), smoothstep(0.55, 0.8, streak));
  return m;
}

export interface Tree {
  group: THREE.Group;
}

/**
 * A tree at the left of the meadow whose branches reach over the top of the
 * view. Limbs are generated, then leaf clusters grow at their ends.
 */
export function makeTree(gust: FloatUniform, sunAt: THREE.Vector3, cameraAt: THREE.Vector3): Tree {
  const rng = createRng(42);
  const limbs: Limb[] = [];
  const clusters: { c: THREE.Vector3; r: number }[] = [];

  const trunk: Limb = {
    curve: new THREE.CatmullRomCurve3([
      new THREE.Vector3(-4.45, -0.3, 1.5),
      new THREE.Vector3(-4.3, 1.4, 1.38),
      new THREE.Vector3(-4.05, 3.0, 1.25),
      new THREE.Vector3(-4.12, 4.7, 1.05),
      new THREE.Vector3(-4.35, 6.6, 0.9),
    ]),
    r0: 0.46,
    r1: 0.16,
  };
  limbs.push(trunk);
  const radiusAt = (l: Limb, t: number) => l.r0 + (l.r1 - l.r0) * Math.pow(t, 0.8);

  // Main branches reach right and up over the meadow.
  const mains = [0.42, 0.5, 0.58, 0.66, 0.74, 0.84];
  mains.forEach((t, i) => {
    const start = trunk.curve.getPointAt(t);
    const len = 3.2 + rng() * 3.2 - i * 0.2;
    const rise = 0.35 + rng() * 0.5 + i * 0.08;
    const dz = (rng() - 0.4) * 1.4;
    const end = start.clone().add(new THREE.Vector3(len, rise * len * 0.35, dz));
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.35 + rng() * 0.3, (rng() - 0.5) * 0.4));
    const limb: Limb = { curve: new THREE.CatmullRomCurve3([start, mid, end]), r0: radiusAt(trunk, t) * 0.42, r1: 0.02 };
    limbs.push(limb);
    clusters.push({ c: end.clone().add(new THREE.Vector3(0.1, 0.1, 0)), r: 0.95 });
    // Smaller branches off each one.
    const subs = 3 + Math.floor(rng() * 2);
    for (let k = 0; k < subs; k++) {
      const st = 0.3 + (k / subs) * 0.6 + rng() * 0.08;
      const s0 = limb.curve.getPointAt(st);
      const ang = (rng() < 0.5 ? 1 : -1) * (0.4 + rng() * 0.5) + 0.35;
      const sl = 0.8 + rng() * 1.3;
      const s1 = s0.clone().add(new THREE.Vector3(Math.cos(ang) * sl, Math.sin(ang) * sl * 0.7, (rng() - 0.5) * 1.2));
      const sm = s0.clone().lerp(s1, 0.5).add(new THREE.Vector3(0, 0.12, 0));
      limbs.push({ curve: new THREE.CatmullRomCurve3([s0, sm, s1]), r0: radiusAt(limb, st) * 0.6, r1: 0.01 });
      clusters.push({ c: s1, r: 0.65 + rng() * 0.3 });
      clusters.push({ c: s0.clone().lerp(s1, 0.55).add(new THREE.Vector3(0, 0.15, 0)), r: 0.5 + rng() * 0.25 });
    }
  });
  // A bough reaching across the sun, so its light comes through the leaves.
  const bough0 = limbs[3]!.curve.getPointAt(0.55);
  const boughEnd = new THREE.Vector3(2.4, 3.55, 1.45);
  limbs.push({
    curve: new THREE.CatmullRomCurve3([bough0, bough0.clone().lerp(boughEnd, 0.5).add(new THREE.Vector3(0, 0.25, 0)), boughEnd]),
    r0: 0.05,
    r1: 0.01,
  });
  for (const [x, y, z, r] of [
    [1.4, 3.45, 1.5, 0.6],
    [2.1, 3.3, 1.4, 0.55],
    [2.7, 3.6, 1.3, 0.5],
    [1.0, 3.8, 1.2, 0.55],
  ] as const)
    clusters.push({ c: new THREE.Vector3(x, y, z), r });
  // The crown above the trunk.
  for (let k = 0; k < 5; k++) clusters.push({ c: new THREE.Vector3(-4.2 + rng() * 1.6, 5.4 + rng() * 1.2, 0.6 + rng() * 0.8), r: 0.8 });

  const group = new THREE.Group();
  const wood = mergeGeometries(limbs.map((l, i) => taperedTube(l, i === 0 ? 30 : 18, i === 0 ? 14 : 8)));
  group.add(new THREE.Mesh(wood, barkMaterial()));
  // Root flare where the trunk meets the ground.
  const flare = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.9, 14, 1, true), barkMaterial());
  flare.position.set(-4.45, 0.2, 1.5);
  group.add(flare);

  group.add(makeLeaves(clusters, gust, sunAt, cameraAt, rng));
  return { group };
}

function makeLeaves(
  clusters: { c: THREE.Vector3; r: number }[],
  gust: FloatUniform,
  sunAt: THREE.Vector3,
  cameraAt: THREE.Vector3,
  rng: () => number,
): THREE.Mesh {
  const perCluster = 210;
  const count = clusters.length * perCluster;
  const pos = new Float32Array(count * 4 * 3);
  const uvs = new Float32Array(count * 4 * 2);
  const shade = new Float32Array(count * 4 * 3);
  const anchor = new Float32Array(count * 4 * 3);
  const flex = new Float32Array(count * 4);
  const phase = new Float32Array(count * 4);
  const index: number[] = [];
  const deep = new THREE.Color(TREE_COLORS.leafDeep);
  const dark = new THREE.Color(TREE_COLORS.leafDark);
  const mid = new THREE.Color(TREE_COLORS.leafMid);
  const lit = new THREE.Color(TREE_COLORS.leafLit);
  const glow = new THREE.Color(TREE_COLORS.leafGlow);
  const sunDir = sunAt.clone().sub(new THREE.Vector3(0, 4, 1)).normalize();
  const toSun = sunAt.clone().sub(cameraAt).normalize();

  let leaf = 0;
  for (const { c, r: R } of clusters) {
    for (let i = 0; i < perCluster; i++) {
      // A point in a flattened, irregular ball around the cluster center.
      const u = rng() * 2 - 1;
      const a = rng() * Math.PI * 2;
      const rr = R * Math.pow(rng(), 0.45);
      const s = Math.sqrt(1 - u * u);
      const out = new THREE.Vector3(Math.cos(a) * s, u * 0.75, Math.sin(a) * s).normalize();
      const center = c.clone().add(out.clone().multiplyScalar(rr).multiply(new THREE.Vector3(1.25, 0.8, 1)));
      const size = 0.15 + rng() * 0.09;
      // Leaves point outward and droop a little, facing roughly toward the viewer.
      const axis = out.clone().add(new THREE.Vector3((rng() - 0.5) * 0.6, -0.45 + (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.6)).normalize();
      const facing = cameraAt.clone().sub(center).normalize().lerp(out, 0.4).normalize();
      const side = new THREE.Vector3().crossVectors(axis, facing).normalize().multiplyScalar(size * 0.5);
      const base = center.clone().addScaledVector(axis, -size * 0.15);
      const tip = center.clone().addScaledVector(axis, size);
      const corners = [base.clone().sub(side), base.clone().add(side), tip.clone().add(side), tip.clone().sub(side)];

      // Color: deep inside the cluster, lit on its sunny side, glowing where the sun shines through.
      const depth = rr / R;
      const sunny = out.dot(sunDir) * 0.5 + 0.5;
      const col = deep.clone().lerp(dark, depth).lerp(mid, sunny * depth * 0.9);
      if (sunny > 0.55 && rng() < 0.6) col.lerp(lit, (sunny - 0.55) * 2);
      const through = cameraAt.clone().sub(center).normalize().negate().dot(toSun);
      const backlit = THREE.MathUtils.smoothstep(through, 0.93, 0.995) * depth;
      col.lerp(glow, backlit * 0.85);
      col.offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.05);

      const variant = Math.floor(rng() * 4);
      const u0 = variant / 4;
      const u1 = (variant + 1) / 4;
      const ph = rng() * Math.PI * 2;
      const leafUV = [
        [u0, 0],
        [u1, 0],
        [u1, 1],
        [u0, 1],
      ];
      for (let k = 0; k < 4; k++) {
        const v = leaf * 4 + k;
        pos.set([corners[k]!.x, corners[k]!.y, corners[k]!.z], v * 3);
        uvs.set(leafUV[k]!, v * 2);
        shade.set([col.r, col.g, col.b], v * 3);
        anchor.set([c.x, c.y, c.z], v * 3);
        flex[v] = k < 2 ? 0.15 : 1;
        phase[v] = ph;
      }
      const o = leaf * 4;
      index.push(o, o + 1, o + 2, o, o + 2, o + 3);
      leaf++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('shade', new THREE.BufferAttribute(shade, 3));
  geo.setAttribute('anchor', new THREE.BufferAttribute(anchor, 3));
  geo.setAttribute('flex', new THREE.BufferAttribute(flex, 1));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setIndex(index);

  const atlas = leafAtlas();
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
  const anchorAt = attribute('anchor', 'vec3');
  const ph = attribute('phase', 'float');
  const fl = attribute('flex', 'float');
  // Each cluster sways as one; each leaf flutters on its own, more in the gust.
  const clusterSway = sin(time.mul(1.1).add(anchorAt.x.mul(0.7)).add(anchorAt.y)).mul(gust.mul(0.08).add(0.025)).add(gust.mul(0.1));
  const flutter = sin(time.mul(6.5).add(ph)).mul(fl).mul(gust.mul(0.05).add(0.008));
  m.positionNode = positionLocal.add(
    vec3(clusterSway.add(flutter), sin(time.mul(1.6).add(anchorAt.x)).mul(0.012).add(flutter.mul(0.8)), flutter.mul(0.5)),
  );
  const tex = texture(atlas, uv());
  // Leaves catch the light as they turn.
  const glint = smoothstep(0.7, 1.0, sin(time.mul(2.4).add(ph.mul(3))).mul(0.5).add(0.5)).mul(0.14);
  m.colorNode = mix(attribute('shade', 'vec3'), color(TREE_COLORS.leafGlow), glint).mul(tex.r.mul(0.55).add(0.5));
  m.opacityNode = tex.a;
  const mesh = new THREE.Mesh(geo, m);
  return mesh;
}
