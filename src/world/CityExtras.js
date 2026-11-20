import * as THREE from 'three';
import { rbox } from './Materials.js';
import { parkFeatureAt } from './Streetscape.js';

/**
 * Visual richness for the city: textured grass and sidewalks, road edge lines, street furniture (hydrants, bins,
 * benches), bushes, flowers, pines, rocks, industrial clutter and a ring of scenery trees beyond the city limit.
 * Everything is instanced (a handful of draw calls); only solid furniture gets a small collider.
 */
const BLOCK_CENTERS = [-120, -60, 0, 60, 120];
const ROAD_LINES = [-90, -30, 30, 90];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(size, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.repeat.set(repeat, repeat);
  return t;
}

/** Grass with soft light / dark patches instead of one flat colour. */
export function groundMaterial() {
  const r = rng(5);
  const tex = canvasTex(512, (g, S) => {
    g.fillStyle = '#7ccf6a'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const x = r() * S, y = r() * S, rad = 14 + r() * 46;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const light = r() > 0.5;
      gr.addColorStop(0, light ? 'rgba(160,230,110,0.35)' : 'rgba(70,150,80,0.30)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 1400; i++) { g.fillStyle = r() > 0.5 ? 'rgba(120,200,90,0.5)' : 'rgba(60,140,70,0.4)'; g.fillRect(r() * S, r() * S, 2, 3); }
  }, 70);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
}

/** Paving slabs: light stone with a faint tile grid (shared by every block). */
let slabMat = null;
export function slabMaterial() {
  if (slabMat) return slabMat;
  const tex = canvasTex(128, (g, S) => {
    g.fillStyle = '#d9dde3'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(120,130,150,0.35)'; g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, S - 3, S - 3);
    g.strokeStyle = 'rgba(120,130,150,0.18)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
  }, 12);
  slabMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  return slabMat;
}

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function put(im, i, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
  Q.setFromAxisAngle(UP, ry);
  im.setMatrixAt(i, M.compose(V.set(x, y, z), Q, S.set(sx, sy, sz)));
}

export function buildExtras({ city, scene, colliders, settings }) {
  const detail = settings.quality.detail ?? 1;
  const root = new THREE.Group();
  scene.add(root);
  const r = rng(2024);
  const phong = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, flatShading: !!o.flat });
  const L = { bush: [], flower: [], hydrant: [], bin: [], bench: [], rock: [], cone: [], barrel: [], crate: [], pine: [], scenery: [] };
  const solid = (x, z, w, d, h = 1.2) => colliders.add(x, z, w, d, h);

  for (let ix = -2; ix <= 2; ix++) for (let iz = -2; iz <= 2; iz++) {
    const cx = BLOCK_CENTERS[ix + 2], cz = BLOCK_CENTERS[iz + 2], type = city.blockType(ix, iz);
    // ----- sidewalk furniture (every block except the home station block) -----
    if (type !== 'station' && type !== 'sale') {
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // outward normals
      sides.forEach(([nx, nz], si) => {
        const px = (t) => cx + nx * 22.8 + (nz !== 0 ? t : 0), pz = (t) => cz + nz * 22.8 + (nx !== 0 ? t : 0);
        const ry = Math.atan2(nx, nz); // bench / bin face the road
        if (r() > 0.45) { L.bin.push([px(-5), pz(-5), ry]); solid(px(-5), pz(-5), 0.7, 0.7); }
        if (type !== 'industrial' && type !== 'highway' && r() > 0.35) {
          const t = r() > 0.5 ? 14.5 : -14.5;
          L.bench.push([px(t), pz(t), ry]);
          solid(px(t), pz(t), nx !== 0 ? 0.9 : 2.3, nx !== 0 ? 2.3 : 0.9);
        }
        if (si % 2 === 0 && r() > 0.3) { const t = r() > 0.5 ? 17 : -17; L.hydrant.push([px(t), pz(t)]); solid(px(t), pz(t), 0.5, 0.5); }
        // low hedge along the inner edge for leafy blocks
        if (type === 'tall' || type === 'commercial' || type === 'park' || type === 'residential') {
          for (let t = -16; t <= 16; t += 3.2) {
            if (Math.abs(t) < 2.2 || Math.abs(Math.abs(t) - 9.6) < 1.6 || Math.abs(t - 14.5) < 2 || Math.abs(t + 14.5) < 2) continue; // gaps for lamps / trees / benches
            L.bush.push([cx + nx * 21.4 + (nz !== 0 ? t : 0), cz + nz * 21.4 + (nx !== 0 ? t : 0), 0.7 + r() * 0.35, r()]);
          }
        }
      });
    }
    // ----- block interiors -----
    if (type === 'residential') {
      for (const gap of [-7, 7]) for (let k = -18; k <= 18; k += 4) {
        L.bush.push([cx + gap, cz + k, 0.55 + r() * 0.3, r()]);
        L.bush.push([cx + k, cz + gap, 0.55 + r() * 0.3, r()]);
        if (r() > 0.4) L.flower.push([cx + gap + (r() - 0.5) * 2, cz + k + 1.5, r()]);
      }
      for (let i = 0; i < 26; i++) {
        const x = cx + (r() - 0.5) * 40, z = cz + (r() - 0.5) * 40;
        if (Math.abs(((x - cx + 7) % 14 + 14) % 14 - 7) < 6.2 && Math.abs(((z - cz + 7) % 14 + 14) % 14 - 7) < 5.5) continue; // inside a house plot
        L.flower.push([x, z, r()]);
      }
    } else if (type === 'park') {
      for (let i = 0; i < 70; i++) {
        const x = cx + (r() - 0.5) * 40, z = cz + (r() - 0.5) * 40;
        if (Math.hypot(x - cx - 6, z - cz - 4) < 8.5 || Math.abs(x - cx) < 2.6 || Math.abs(z - cz) < 2.6 || parkFeatureAt(x - cx, z - cz)) continue;
        L.flower.push([x, z, r()]);
      }
      for (let i = 0; i < 22; i++) { // bushes and rocks around the pond
        const a = (i / 22) * Math.PI * 2 + r() * 0.3, rad = 7.6 + r() * 1.2;
        const x = cx + 6 + Math.cos(a) * rad, z = cz + 4 + Math.sin(a) * rad;
        if (i % 3 === 0) { L.rock.push([x, z, 0.5 + r() * 0.6, r() * 6]); solid(x, z, 0.9, 0.9, 1); } else L.bush.push([x, z, 0.5 + r() * 0.4, r()]);
      }
      for (let i = 0; i < 9; i++) {
        const x = cx + (r() - 0.5) * 38, z = cz + (r() - 0.5) * 38;
        if (Math.hypot(x - cx - 6, z - cz - 4) < 10 || Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5 || parkFeatureAt(x - cx, z - cz)) continue;
        L.pine.push([x, z, 0.9 + r() * 0.6]);
      }
    } else if (type === 'industrial') {
      for (let i = 0; i < 5; i++) { L.cone.push([cx + 8 + i * 1.6, cz + 3.4]); }
      for (let i = 0; i < 4; i++) { L.barrel.push([cx + 9.5 + (i % 2) * 1.1, cz - 2.6 - Math.floor(i / 2) * 1.1, r()]); }
      solid(cx + 10, cz - 3.1, 2.4, 2.4, 1.4);
      L.crate.push([cx + 12.6, cz - 2.4, 0.2]); L.crate.push([cx + 12.6, cz - 2.4, 0.2, true]);
      solid(cx + 12.6, cz - 2.4, 1.7, 1.7, 2.4);
    }
  }
  // scenery trees and pines on the ground beyond the city so the horizon is not empty
  const sceneryN = Math.round(230 * detail);
  for (let i = 0; i < sceneryN; i++) {
    const a = r() * Math.PI * 2, d = 178 + r() * 200;
    L.scenery.push([Math.cos(a) * d, Math.sin(a) * d, 1 + r() * 1.5, r()]);
  }

  // thin the decorative instances on weaker quality levels (the horizon trees, bushes and flowers are the bulk of them)
  for (const k of ['bush', 'flower', 'scenery']) L[k] = L[k].filter((_, i) => (i % 100) < detail * 100);

  const inst = (geo, material, n, cast = false) => { const im = new THREE.InstancedMesh(geo, material, Math.max(1, n)); im.count = n; im.castShadow = cast; im.receiveShadow = true; root.add(im); return im; };
  const col = new THREE.Color();
  const GREENS = [0x3fae4a, 0x58c15a, 0x2e9a4f, 0x7dd05b], FLOWERS = [0xff7a59, 0xffc43d, 0xff8fb1, 0xb06cff, 0xffffff, 0x4cc9f0];

  // bushes
  let im = inst(new THREE.IcosahedronGeometry(0.8, 0), phong(0xffffff, { rough: 0.9, flat: true }), L.bush.length);
  L.bush.forEach(([x, z, s, c], i) => { put(im, i, x, 0.3 + 0.45 * s, z, s * 1.3, s * 0.85, s, c * 6); im.setColorAt(i, col.setHex(GREENS[Math.floor(c * 4) % 4])); });
  // flowers: three little blooms per patch
  im = inst(new THREE.IcosahedronGeometry(0.17, 0), phong(0xffffff, { rough: 0.7 }), L.flower.length * 3);
  L.flower.forEach(([x, z, c], i) => { for (let k = 0; k < 3; k++) { put(im, i * 3 + k, x + (k - 1) * 0.35, 0.5 + (k % 2) * 0.08, z + (k === 1 ? 0.3 : -0.1), 1, 1, 1, 0); im.setColorAt(i * 3 + k, col.setHex(FLOWERS[Math.floor((c * 6 + k) % 6)])); } });
  // fire hydrants (body + cap)
  const hy = inst(new THREE.CylinderGeometry(0.2, 0.24, 0.75, 8), phong(0xe03c31), L.hydrant.length, true), hc = inst(new THREE.SphereGeometry(0.22, 8, 6), phong(0xf2c230), L.hydrant.length);
  L.hydrant.forEach(([x, z], i) => { put(hy, i, x, 0.68, z); put(hc, i, x, 1.08, z, 1, 0.7, 1); });
  // litter bins
  const bn = inst(new THREE.CylinderGeometry(0.3, 0.26, 0.85, 10), phong(0x3b7d5a), L.bin.length, true), bl = inst(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 10), phong(0x2d3a45), L.bin.length);
  L.bin.forEach(([x, z], i) => { put(bn, i, x, 0.72, z); put(bl, i, x, 1.2, z); });
  // benches (seat + back + two legs as one wide block of slats)
  const bs = inst(rbox(2.2, 0.14, 0.6, 0.05, 1), phong(0x9a6a3c), L.bench.length, true), bb = inst(rbox(2.2, 0.5, 0.1, 0.04, 1), phong(0x9a6a3c), L.bench.length, true), bg = inst(rbox(2.0, 0.42, 0.4, 0.04, 1), phong(0x4a525d, { metal: 0.4 }), L.bench.length);
  L.bench.forEach(([x, z, ry], i) => {
    const bx = Math.sin(ry), bz = Math.cos(ry);
    put(bs, i, x, 0.72, z, 1, 1, 1, ry); put(bb, i, x - bx * 0.28, 1.0, z - bz * 0.28, 1, 1, 1, ry); put(bg, i, x, 0.5, z, 1, 1, 1, ry);
  });
  // rocks
  im = inst(new THREE.DodecahedronGeometry(0.8, 0), phong(0x9aa3ad, { rough: 1, flat: true }), L.rock.length, true);
  L.rock.forEach(([x, z, s, rot], i) => put(im, i, x, 0.3 + s * 0.35, z, s * 1.2, s * 0.8, s, rot));
  // traffic cones, barrels, crates
  const cn = inst(new THREE.ConeGeometry(0.28, 0.75, 8), phong(0xff7a2a), L.cone.length, true);
  L.cone.forEach(([x, z], i) => put(cn, i, x, 0.7, z));
  const br = inst(new THREE.CylinderGeometry(0.5, 0.5, 1.05, 12), phong(0xffffff), L.barrel.length, true);
  L.barrel.forEach(([x, z, c], i) => { put(br, i, x, 0.85, z); br.setColorAt(i, col.setHex([0x2f8cff, 0xe8483f, 0xffc43d][Math.floor(c * 3) % 3])); });
  const cr = inst(rbox(1.6, 1.2, 1.6, 0.08, 1), phong(0xb98a5a), L.crate.length, true);
  L.crate.forEach(([x, z, rot, top], i) => put(cr, i, x, top ? 2.15 : 0.9, z, 1, 1, 1, top ? rot + 0.5 : rot));
  // pines (trunk + two cones)
  const pt = inst(new THREE.CylinderGeometry(0.16, 0.24, 1.2, 6), phong(0x6b4a2c), L.pine.length, true);
  const p1 = inst(new THREE.ConeGeometry(1.5, 2.6, 8), phong(0x2f7d4a, { rough: 0.9, flat: true }), L.pine.length, true), p2 = inst(new THREE.ConeGeometry(1.1, 2.2, 8), phong(0x3a8f55, { rough: 0.9, flat: true }), L.pine.length, true);
  L.pine.forEach(([x, z, s], i) => { put(pt, i, x, 0.9 * s, z, s, s, s); put(p1, i, x, 0.3 + 2.4 * s, z, s, s, s); put(p2, i, x, 0.3 + 4.0 * s, z, s, s, s); if (s > 0.9) solid(x, z, 0.6, 0.6, 4); });
  // scenery: alternating round trees and pines
  const rt = inst(new THREE.IcosahedronGeometry(1.4, 0), phong(0xffffff, { rough: 0.9, flat: true }), L.scenery.length);
  const rk = inst(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 6), phong(0x6b4a2c), L.scenery.length);
  L.scenery.forEach(([x, z, s, c], i) => {
    put(rk, i, x, 1.1 * s, z, s, s, s);
    put(rt, i, x, 3.0 * s, z, s * 1.3, s * 1.1, s * 1.3, c * 6);
    rt.setColorAt(i, col.setHex(c > 0.72 ? 0x2f7d4a : GREENS[Math.floor(c * 5) % 4]));
  });
  for (const m of root.children) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.frustumCulled = false; }

  // ----- road details: solid edge lines and manhole covers -----
  const edge = [];
  for (const l of ROAD_LINES) {
    for (let t = -146; t < 146; t += 6) {
      if (ROAD_LINES.some((o) => Math.abs(t + 3 - o) < 6 + 10)) continue; // keep the intersections and crosswalks clear
      for (const s of [-1, 1]) { edge.push([t + 3, l + s * 5.55, 0]); edge.push([l + s * 5.55, t + 3, Math.PI / 2]); }
    }
  }
  const el = new THREE.InstancedMesh(new THREE.BoxGeometry(5.4, 0.02, 0.16), new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 0.9 }), edge.length);
  edge.forEach(([x, z, ry], i) => put(el, i, x, 0.052, z, 1, 1, 1, ry));
  el.receiveShadow = true; root.add(el);
  const mh = [];
  for (const a of ROAD_LINES) for (const b of [-60, 0, 60]) { mh.push([a + 2.8, b + 17]); mh.push([b - 17, a - 2.8]); }
  const mc = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 14), new THREE.MeshStandardMaterial({ color: 0x2b303a, roughness: 0.6, metalness: 0.5 }), mh.length);
  mh.forEach(([x, z], i) => put(mc, i, x, 0.055, z));
  root.add(mc);
  return { root, counts: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v.length])) };
}
