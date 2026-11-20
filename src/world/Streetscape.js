import * as THREE from 'three';
import { rbox, nightMaterials } from './Materials.js';

/**
 * Sidewalk and park dressing: planter boxes, phone booths, and fully composed parks (fountain plaza, playground, flower beds,
 * hedge rows, garden lights, autumn / conifer feature trees, stepping stones). Everything is instanced and merged into a few
 * layers; solid pieces register small colliders so the player and pathfinding keep working.
 */
const BLOCK_CENTERS = [-120, -60, 0, 60, 120];
const EUL = new THREE.Euler(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();

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

// ---- layout shared with the random scatter in CityManager / CityExtras so trees, pines and flowers keep out of features
const BEDS = [[8.5, -11.5], [14, -7], [14.5, -15]];
const PLAYGROUND = [-11, -11], FOUNTAIN = [-10, 10];
const ORANGE = [[-17, -3.5], [17, 15], [8, 17]], CONIFER = [[-19, 19], [19, -19], [-19, -19]];
/** true when a park-local (dx, dz) point is occupied by a designed feature */
export function parkFeatureAt(dx, dz) {
  if (Math.hypot(dx - PLAYGROUND[0], dz - PLAYGROUND[1]) < 7.5 || Math.hypot(dx - FOUNTAIN[0], dz - FOUNTAIN[1]) < 6.5) return true;
  if (BEDS.some(([x, z]) => Math.hypot(dx - x, dz - z) < 3)) return true;
  if (ORANGE.concat(CONIFER).some(([x, z]) => Math.hypot(dx - x, dz - z) < 2.2)) return true;
  return Math.abs(Math.abs(dx) - 2.7) < 1.0 && dz > -20.5 && dz < -3.5; // hedge rows
}

export class Layer {
  constructor(geo, { color = 0xffffff, rough = 0.8, metal = 0, material = null, cast = false } = {}) {
    this.geo = geo; this.items = []; this.cast = cast;
    this.material = material || new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: metal });
    this.defColor = color;
  }
  add(x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, color = this.defColor, rx = 0, rz = 0) { this.items.push([x, y, z, sx, sy, sz, ry, color, rx, rz]); }
  finish(root) {
    if (!this.items.length) return null;
    const im = new THREE.InstancedMesh(this.geo, this.material, this.items.length);
    const c = new THREE.Color();
    this.items.forEach(([x, y, z, sx, sy, sz, ry, col, rx, rz], i) => {
      EUL.set(rx, ry, rz); Q.setFromEuler(EUL);
      im.setMatrixAt(i, M.compose(V.set(x, y, z), Q, S.set(sx, sy, sz)));
      if (!this.material.emissive || this.material.emissive.getHex() === 0) im.setColorAt(i, c.setHex(col));
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = this.cast; im.receiveShadow = true; im.frustumCulled = false;
    root.add(im);
    return im;
  }
}

export function buildStreetscape({ city, scene, colliders, settings }) {
  const detail = settings?.quality?.detail ?? 1;
  const root = new THREE.Group();
  scene.add(root);
  const r = rng(777);
  const solid = (x, z, w, d, h = 1.4) => colliders.add(x, z, w, d, h);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);

  const L = {
    planterBox: new Layer(rbox(2.4, 0.55, 0.9, 0.08, 1), { rough: 0.85, cast: true }),
    planterTop: new Layer(rbox(2.2, 0.4, 0.7, 0.15, 1), { rough: 0.9 }),
    boothBody: new Layer(box(1, 2.4, 1), { rough: 0.6, cast: true }),
    boothGlass: new Layer(box(0.7, 1.6, 0.06), { rough: 0.2 }),
    plaza: new Layer(cyl(5.2, 5.2, 0.07, 28), { rough: 0.9 }),
    ring: new Layer(cyl(1.9, 1.9, 0.6, 20), { rough: 0.8, cast: true }),
    water: new Layer(cyl(1.7, 1.7, 0.05, 20), { rough: 0.1, metal: 0.1 }),
    pillar: new Layer(cyl(0.3, 0.4, 1.5, 10), { rough: 0.8, cast: true }),
    bowl: new Layer(cyl(1.0, 0.55, 0.28, 14), { rough: 0.8, cast: true }),
    sand: new Layer(box(3.8, 0.16, 3.8), { rough: 1 }),
    wood: new Layer(box(1, 1, 1), { rough: 0.8, cast: true }),
    bed: new Layer(cyl(1.6, 1.7, 0.4, 16), { rough: 0.9 }),
    soil: new Layer(cyl(1.45, 1.45, 0.42, 16), { rough: 1 }),
    bloom: new Layer(new THREE.IcosahedronGeometry(0.22, 0), { rough: 0.7 }),
    hedge: new Layer(rbox(3.0, 1.1, 1.0, 0.25, 2), { rough: 0.95, cast: true }),
    pole: new Layer(cyl(0.06, 0.08, 1.8, 6), { color: 0x3b4450, metal: 0.3 }),
    trunk: new Layer(cyl(0.22, 0.34, 2.0, 7), { color: 0x6b4a2c, cast: true }),
    blob: new Layer(new THREE.IcosahedronGeometry(1.7, 1), { rough: 0.85, cast: true }),
    cone1: new Layer(new THREE.ConeGeometry(1.7, 3.0, 9), { rough: 0.9, cast: true }),
    cone2: new Layer(new THREE.ConeGeometry(1.2, 2.5, 9), { rough: 0.9, cast: true }),
    stone: new Layer(cyl(0.45, 0.5, 0.06, 9), { color: 0xd8cfb8, rough: 0.95 }),
  };
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffc66b, emissiveIntensity: 0 });
  nightMaterials.add(bulbMat);
  L.bulb = new Layer(new THREE.SphereGeometry(0.2, 10, 8), { material: bulbMat });

  const FLOWERS = [0xff7a59, 0xffc43d, 0xff8fb1, 0xb06cff, 0xffffff, 0xff4f6d];
  const GROUND = 0.33; // lawn / slab surface

  for (let ix = -2; ix <= 2; ix++) for (let iz = -2; iz <= 2; iz++) {
    const cx = BLOCK_CENTERS[ix + 2], cz = BLOCK_CENTERS[iz + 2], type = city.blockType(ix, iz);

    // ---------- sidewalks: planter boxes + the odd red phone booth on busy blocks
    if (type === 'tall' || type === 'commercial') {
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([nx, nz], si) => {
        const ry = nx !== 0 ? Math.PI / 2 : 0;
        for (const t of [-9.6, 9.6]) {
          if (type === 'commercial' && nz > 0) continue; // the car lot opens on this side
          const x = cx + nx * 22.9 + (nz !== 0 ? t : 0), z = cz + nz * 22.9 + (nx !== 0 ? t : 0);
          L.planterBox.add(x, GROUND + 0.27, z, 1, 1, 1, ry, 0xa86a3c);
          L.planterTop.add(x, GROUND + 0.62, z, 1, 1, 1, ry, [0x58c15a, 0x7dd05b, 0x3fae4a][Math.floor(r() * 3)]);
          solid(x, z, nx !== 0 ? 1.0 : 2.5, nx !== 0 ? 2.5 : 1.0, 1);
        }
        if (si === Math.floor(r() * 4) && !(type === 'commercial' && nz > 0)) {
          const t = -13.5, x = cx + nx * 22.9 + (nz !== 0 ? t : 0), z = cz + nz * 22.9 + (nx !== 0 ? t : 0);
          L.boothBody.add(x, GROUND + 1.2, z, 1, 1, 1, ry, 0xd7332b);
          L.boothGlass.add(x + nx * 0.52, GROUND + 1.35, z + nz * 0.52, 1, 1, 1, ry, 0x9fd3f2);
          solid(x, z, 1.1, 1.1, 2.4);
        }
      });
    }

    // ---------- parks
    if (type !== 'park') continue;
    const P = (dx, dz) => [cx + dx, cz + dz];

    // fountain plaza
    {
      const [fx, fz] = P(...FOUNTAIN);
      L.plaza.add(fx, GROUND + 0.04, fz, 1, 1, 1, 0, 0xe3d9bd);
      L.ring.add(fx, GROUND + 0.3, fz, 1, 1, 1, 0, 0xb7b1a3);
      L.water.add(fx, GROUND + 0.58, fz, 1, 1, 1, 0, 0x4cc9f0);
      L.pillar.add(fx, GROUND + 1.15, fz, 1, 1, 1, 0, 0xcfc8b8);
      L.bowl.add(fx, GROUND + 1.95, fz, 1, 1, 1, 0, 0xcfc8b8);
      L.water.add(fx, GROUND + 2.11, fz, 0.5, 1, 0.5, 0, 0x6fd8ff);
      solid(fx, fz, 3.9, 3.9, 2.4);
      for (const a of [0.8, 2.4, 4.0, 5.6]) { // little plaza benches on the diagonals
        const bx = fx + Math.cos(a) * 4.1, bz = fz + Math.sin(a) * 4.1;
        L.wood.add(bx, GROUND + 0.5, bz, 1.8, 0.14, 0.5, -a + Math.PI / 2, 0x9a6a3c);
        L.wood.add(bx, GROUND + 0.25, bz, 1.5, 0.4, 0.3, -a + Math.PI / 2, 0x4a525d);
      }
    }

    // playground: sandpit, slide, swings
    {
      const [px, pz] = P(...PLAYGROUND);
      L.sand.add(px - 2.5, GROUND + 0.08, pz - 2.5, 1, 1, 1, 0, 0xe9d49a);
      for (const [dx, dz, sx, sz] of [[0, -1.95, 4.1, 0.2], [0, 1.95, 4.1, 0.2], [-2.0, 0, 0.2, 3.8], [2.0, 0, 0.2, 3.8]]) L.wood.add(px - 2.5 + dx, GROUND + 0.2, pz - 2.5 + dz, sx, 0.3, sz, 0, 0x9a6a3c);
      // slide tower
      const tx = px + 3, tz = pz - 3;
      L.wood.add(tx, GROUND + 1.55, tz, 1.5, 0.14, 1.5, 0, 0xffc43d);
      for (const [dx, dz] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) L.wood.add(tx + dx, GROUND + 0.8, tz + dz, 0.12, 1.6, 0.12, 0, 0x2f8cff);
      L.wood.add(tx, GROUND + 2.2, tz - 0.7, 1.5, 0.9, 0.08, 0, 0xff7a59);
      L.wood.add(tx, GROUND + 0.9, tz + 3.0, 0.9, 0.1, 3.4, 0, 0xff4f6d, 0.52); // the slide itself (tilted)
      solid(tx, tz + 1.5, 1.8, 4.6, 2.2);
      // swing set
      const sx = px + 1, sz = pz + 4.5;
      for (const dx of [-1.8, 1.8]) L.wood.add(sx + dx, GROUND + 1.25, sz, 0.14, 2.5, 0.14, 0, 0x2f8cff);
      L.wood.add(sx, GROUND + 2.55, sz, 3.8, 0.16, 0.16, 0, 0x2f8cff);
      for (const dx of [-0.8, 0.8]) {
        L.wood.add(sx + dx, GROUND + 0.9, sz, 0.55, 0.07, 0.28, 0, 0xff7a59);
        L.wood.add(sx + dx - 0.22, GROUND + 1.75, sz, 0.03, 1.7, 0.03, 0, 0x59616c);
        L.wood.add(sx + dx + 0.22, GROUND + 1.75, sz, 0.03, 1.7, 0.03, 0, 0x59616c);
      }
      solid(sx, sz, 4.0, 0.8, 2.6);
    }

    // flower beds
    BEDS.forEach(([dx, dz]) => {
      const [bx, bz] = P(dx, dz);
      L.bed.add(bx, GROUND + 0.2, bz, 1, 1, 1, 0, 0xc9bda3);
      L.soil.add(bx, GROUND + 0.2, bz, 1, 1, 1, 0, 0x4f9a43);
      const palette = [FLOWERS[Math.floor(r() * 6)], FLOWERS[Math.floor(r() * 6)]];
      for (let k = 0; k < 11; k++) {
        const a = r() * 6.28, rr = Math.sqrt(r()) * 1.25;
        L.bloom.add(bx + Math.cos(a) * rr, GROUND + 0.5 + r() * 0.1, bz + Math.sin(a) * rr, 1, 1, 1, 0, palette[k % 2]);
      }
    });

    // hedge rows along the north half of the long path, garden lights along both paths
    for (let z = -19; z <= -5; z += 3.1) for (const sx of [-1, 1]) L.hedge.add(cx + sx * 2.7, GROUND + 0.55, cz + z, 1, 1, 1, Math.PI / 2, sx > 0 ? 0x3f9a4a : 0x2f8a46);
    for (const [dx, dz] of [[-2.8, -14], [2.8, -14], [-2.8, 14], [2.8, 17], [-2.8, -5], [2.8, -5], [-14, 2.6], [14, -2.6]]) {
      const [lx, lz] = P(dx, dz);
      L.pole.add(lx, GROUND + 0.9, lz); L.bulb.add(lx, GROUND + 2.0, lz);
    }
    // stepping stones from the fountain to the path crossing
    for (let k = 0; k < 6; k++) { const t = k / 5, [qx, qz] = P(-10 + 8 * t + Math.sin(t * 3) * 0.5, 10 - 8 * t); L.stone.add(qx, GROUND + 0.04, qz, 1, 1, 1, k); }

    // feature trees
    ORANGE.forEach(([dx, dz]) => {
      const [tx, tz] = P(dx, dz);
      L.trunk.add(tx, GROUND + 1.0, tz); L.blob.add(tx, GROUND + 3.2, tz, 1, 0.9, 1, r() * 6, [0xf5a623, 0xe8792e, 0xf2c230][Math.floor(r() * 3)]);
      solid(tx, tz, 0.9, 0.9, 4);
    });
    CONIFER.forEach(([dx, dz]) => {
      const [tx, tz] = P(dx, dz);
      L.trunk.add(tx, GROUND + 0.8, tz, 0.8, 0.8, 0.8); L.cone1.add(tx, GROUND + 2.5, tz, 1, 1, 1, 0, 0x2f8a56); L.cone2.add(tx, GROUND + 4.2, tz, 1, 1, 1, 0, 0x3aa766);
      solid(tx, tz, 0.9, 0.9, 5);
    });
  }

  for (const key of Object.keys(L)) L[key].finish(root);
  return { root, counts: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v.items.length])), detail };
}
