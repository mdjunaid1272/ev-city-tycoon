import * as THREE from 'three';
import { mat, rbox, mesh, nightMaterials, textTexture } from './Materials.js';
import { createBuilding, createHouse, createCar } from './Models.js';
import { districtOfBlock } from './DistrictManager.js';
import { groundMaterial, slabMaterial, buildExtras } from './CityExtras.js';
import { buildRoadArt } from './RoadArt.js';
import { pickStyle, setBuildingDetail } from './Buildings.js';
import { buildStreetscape, parkFeatureAt } from './Streetscape.js';
import { buildProps } from './Props.js';

export const ROAD_W = 12;
export const LINES = [-90, -30, 30, 90];
export const ROAD_EXTENT = 150;
export const BLOCK_CENTERS = [-120, -60, 0, 60, 120];
const BLOCK_HALF = 24;
export const CITY_LIMIT = 160;

const PALETTE = [0xff7a59, 0x2f8cff, 0xffc43d, 0x35c28a, 0xb06cff, 0xff8fb1, 0x4cc9f0, 0xf4a259];
/** wider, softer facade palette for varied streetscapes: brick, cream, teal, mustard, sage, slate, coral, sky */
const FACADES = [0xd9674a, 0xf2d7a1, 0x3aa8a0, 0xe9b949, 0x9bc28a, 0x6f86a8, 0xf08a7a, 0x78b7e6, 0xb06cff, 0xff8fb1];
const SHOPS = ['CAFE', 'MARKET', 'BANK', 'PIZZA', 'HOTEL', 'PHARMA', 'BOOKS', 'GYM'];

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

const DISTRICT_NAMES = {
  station: 'Downtown', tall: 'Downtown', commercial: 'Commercial District', residential: 'Residential District',
  industrial: 'Industrial District', park: 'City Park', highway: 'Highway Zone', sale: 'Downtown',
};

/** Procedural parking-lot floor texture (asphalt + painted bays). */
export function lotTexture(w, d, cols, rows = 1) {
  const S = 32, c = document.createElement('canvas');
  c.width = w * S; c.height = d * S;
  const g = c.getContext('2d');
  g.fillStyle = '#3d4350'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#f4f7fa'; g.lineWidth = 4;
  const cw = c.width / cols;
  for (let i = 0; i <= cols; i++) {
    g.beginPath(); g.moveTo(i * cw, 0); g.lineTo(i * cw, (c.height * 0.3) / rows); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/**
 * Builds the bounded city: roads, sidewalks, blocks (buildings, parks, lots), props.
 * Each block lives in its own chunk group which is shown/hidden by distance (streaming-lite).
 */
export class CityManager {
  constructor({ scene, colliders, settings }) {
    this.scene = scene;
    this.colliders = colliders;
    this.settings = settings;
    this.chunks = [];
    this.treePos = [];
    this.lampPos = [];
    this.roofSigns = [];
    this.properties = [];
    this.markers = [];
    this.rand = rng(1337);
    this.root = new THREE.Group();
    scene.add(this.root);
  }

  blockType(ix, iz) {
    if (ix === 0 && iz === 0) return 'station';
    if ((ix === 0 && iz === -1) || (ix === -1 && iz === 0) || (ix === 2 && iz === 0) || (ix === 0 && iz === 2) || (ix === 1 && iz === 1) || (ix === -2 && iz === 1)) return 'sale';
    if (ix === -2) return 'residential';
    if (ix === 2) return 'highway';
    if (iz === 2) return 'industrial';
    if (iz === -2) return 'park';
    if (iz === 1) return 'commercial';
    return 'tall';
  }

  districtAt(x, z) {
    const ix = Math.round(x / 60), iz = Math.round(z / 60);
    if (Math.abs(ix) > 2 || Math.abs(iz) > 2) return 'Outskirts';
    return { downtown: 'Downtown', residential: 'Residential District', commercial: 'Commercial District', industrial: 'Industrial District', highway: 'Highway Zone', park: 'City Park' }[districtOfBlock(ix, iz)];
  }

  build() {
    this.buildTerrain();
    setBuildingDetail(this.settings?.quality?.detail ?? 1);
    this.buildRoads();
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) this.buildBlock(i - 2, j - 2);
    }
    this.buildInstancedProps();
    this.extras = buildExtras({ city: this, scene: this.scene, colliders: this.colliders, settings: this.settings });
    this.streetscape = buildStreetscape({ city: this, scene: this.scene, colliders: this.colliders, settings: this.settings });
    this.props = buildProps({ city: this, scene: this.scene, colliders: this.colliders, roofSigns: this.roofSigns, settings: this.settings });
  }

  buildTerrain() {
    const ground = mesh(new THREE.PlaneGeometry(1800, 1800), groundMaterial(), { cast: false, receive: true });
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.root.add(ground);
    // distant stylised hills for a believable horizon
    const r = rng(9);
    const hillMats = [mat(0x6cc06a), mat(0x5aa85f), mat(0x7bb8c9)];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + r() * 0.2;
      const dist = 330 + r() * 150;
      const s = 50 + r() * 70;
      const h = mesh(new THREE.SphereGeometry(1, 16, 10), hillMats[i % 3], { cast: false });
      h.scale.set(s * 1.6, s * (0.4 + r() * 0.5), s * 1.2);
      h.position.set(Math.cos(a) * dist, -4, Math.sin(a) * dist);
      this.root.add(h);
    }
  }

  buildRoads() {
    this.roadArt = buildRoadArt({ root: this.root, lines: LINES, extent: ROAD_EXTENT, roadW: ROAD_W, blockCenters: BLOCK_CENTERS, quality: this.settings?.quality });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);

    const stripes = [];
    for (const lx of LINES) {
      for (const lz of LINES) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (let k = -4; k <= 4; k++) {
            const along = 8.3;
            const x = lx + dx * along + (dz !== 0 ? k * 1.2 : 0);
            const z = lz + dz * along + (dx !== 0 ? k * 1.2 : 0);
            stripes.push([x, z, dx !== 0 ? 0 : Math.PI / 2]);
          }
        }
      }
    }
    const cw = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.02, 0.55), mat(0xf4f7fa), stripes.length);
    stripes.forEach(([x, z, r], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
      cw.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0.05, z), q, s));
    });
    this.root.add(cw);
  }

  addTree(x, z, sc = 1) {
    this.treePos.push([x, z, sc]);
  }

  chunk(cx, cz) {
    const g = new THREE.Group();
    this.root.add(g);
    const c = { group: g, cx, cz };
    this.chunks.push(c);
    return c;
  }

  buildBlock(ix, iz) {
    const cx = BLOCK_CENTERS[ix + 2], cz = BLOCK_CENTERS[iz + 2];
    const type = this.blockType(ix, iz);
    const ch = this.chunk(cx, cz);
    const g = ch.group;
    const r = this.rand;
    // sidewalk slab + kerb
    const slab = mesh(rbox(48, 0.3, 48, 0.1, 1), slabMaterial(), { x: cx, y: 0.1, z: cz, cast: false, receive: true });
    g.add(slab);
    const inner = (color, size = 42) => {
      const m = mesh(rbox(size, 0.1, size, 0.05, 1), mat(color, { rough: 0.95 }), { x: cx, y: 0.27, z: cz, cast: false, receive: true });
      g.add(m);
      return m;
    };
    // street lamps on corners / mid-sides
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
      if (sx === 0 && sz === 0) continue;
      if (type === 'station' && sx === 0) continue;
      this.lampPos.push([cx + sx * 22.2, cz + sz * 22.2, Math.atan2(sx, sz)]);
    }

    if (type === 'station') {
      inner(0x4a505c);
    } else if (type === 'tall') {
      inner(0x9aa6b2);
      let n = 0;
      for (const ox of [-10.5, 10.5]) for (const oz of [-10.5, 10.5]) {
        const h = 10 + Math.floor(r() * 4) * 6 + (ix === 0 ? 6 : 0);
        const b = createBuilding(18, h, 18, FACADES[(ix * 5 + iz * 3 + n * 7 + 8) % FACADES.length], {
          awning: PALETTE[(n + 3) % PALETTE.length], sign: { text: SHOPS[(Math.floor(r() * 99) + n) % SHOPS.length] },
          style: pickStyle(ix + iz + n, h), seed: ix * 31 + iz * 17 + n + 1,
        });
        b.position.set(cx + ox, 0.3, cz + oz);
        b.rotation.y = oz > 0 ? 0 : Math.PI;
        b.rotation.y = 0;
        g.add(b);
        this.colliders.add(cx + ox, cz + oz, 18.2, 18.2, h + 1);
        if (n === 1 && h >= 16) this.roofSigns.push({ x: cx + ox, y: h + 0.5, z: cz + oz + (oz > 0 ? 6.2 : -6.2) });
        n++;
      }
      this.addTree(cx - 21, cz, 0.9); this.addTree(cx + 21, cz, 0.9); this.addTree(cx, cz - 21, 0.9); this.addTree(cx, cz + 21, 0.9);
    } else if (type === 'commercial') {
      inner(0x4a505c);
      const mall = createBuilding(34, 10, 16, 0x2f8cff, { roofColor: 0xffffff, awning: 0xffc43d, sign: { text: 'CITY MALL', bg: '#ffc43d' }, style: 'shop', seed: 5 });
      mall.position.set(cx, 0.3, cz - 14);
      g.add(mall);
      this.colliders.add(cx, cz - 14, 34.2, 16.2, 11);
      const lot = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), new THREE.MeshStandardMaterial({ map: lotTexture(40, 14, 10), roughness: 0.95 }));
      lot.rotation.x = -Math.PI / 2; lot.position.set(cx, 0.33, cz + 11); lot.receiveShadow = true;
      g.add(lot);
      const cols = [0xff7a59, 0x35c28a, 0xf4f7fa, 0xb06cff, 0xffc43d];
      for (let i = 0; i < 5; i++) {
        const c = createCar(['compact', 'suv', 'sports'][i % 3], cols[i]);
        c.position.set(cx - 16 + i * 7.9 + 0.2, 0.3, cz + 7);
        c.rotation.y = Math.PI;
        g.add(c);
      }
      for (const sx of [-1, 1]) this.addTree(cx + sx * 20.5, cz - 1, 1);
    } else if (type === 'residential') {
      inner(0x80d06c);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const w = 9 + r() * 1.5, d = 8 + r() * 1.5;
        const h = createHouse(w, d, PALETTE[(i * 3 + j + iz + 5) % PALETTE.length], [0xc0453a, 0x3a6ea5, 0x7a5a3a, 0x4a8a5a][(i + j) % 4]);
        const hx = cx + (i - 1) * 14, hz = cz + (j - 1) * 14;
        h.position.set(hx, 0.3, hz);
        h.rotation.y = j === 0 ? Math.PI : 0;
        g.add(h);
        this.colliders.add(hx, hz, w + 0.3, d + 0.3, 6);
        if (r() > 0.4) this.addTree(hx + (r() > 0.5 ? 5.5 : -5.5), hz + (r() - 0.5) * 8, 0.8 + r() * 0.4);
      }
    } else if (type === 'industrial') {
      inner(0x8b929c);
      for (const oz of [-12, 12]) {
        const w = createBuilding(34, 8, 15, oz < 0 ? 0xf4a259 : 0x8fb8de, { roofColor: 0xcfd6df, style: 'warehouse', seed: oz });
        w.position.set(cx - 2, 0.3, cz + oz);
        g.add(w);
        this.colliders.add(cx - 2, cz + oz, 34.2, 15.2, 9);
      }
      const cc = [0xff7a59, 0x2f8cff, 0x35c28a, 0xffc43d];
      for (let i = 0; i < 6; i++) {
        const c = mesh(rbox(6, 2.6, 2.4, 0.1, 1), mat(cc[i % 4]), { x: cx - 14 + (i % 3) * 6.4, y: 1.6 + Math.floor(i / 3) * 2.7, z: cz });
        g.add(c);
      }
      this.colliders.add(cx - 8, cz, 19.5, 3, 6);
      g.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 7, 20), mat(0xf4f7fa, { metal: 0.3 }), { x: cx + 17, y: 3.8, z: cz }));
      g.add(mesh(new THREE.CylinderGeometry(0.7, 1, 12, 12), mat(0xc0453a), { x: cx + 17, y: 6.3, z: cz + 8 }));
      this.colliders.add(cx + 17, cz, 4.6, 4.6, 8);
      this.colliders.add(cx + 17, cz + 8, 2, 2, 12);
    } else if (type === 'park') {
      inner(0x6cc760);
      const pond = mesh(new THREE.CylinderGeometry(7, 7, 0.1, 32), mat(0x4cc9f0, { rough: 0.15, metal: 0.1 }), { x: cx + 6, y: 0.34, z: cz + 4, cast: false, receive: true });
      g.add(pond);
      const path = mesh(rbox(3, 0.05, 42, 0.02, 1), mat(0xe8d9b0), { x: cx, y: 0.34, z: cz, cast: false, receive: true });
      const path2 = mesh(rbox(42, 0.05, 3, 0.02, 1), mat(0xe8d9b0), { x: cx, y: 0.34, z: cz, cast: false, receive: true });
      g.add(path, path2);
      for (let i = 0; i < 26; i++) {
        const x = cx + (r() - 0.5) * 40, z = cz + (r() - 0.5) * 40;
        if (Math.hypot(x - cx - 6, z - cz - 4) < 9 || Math.abs(x - cx) < 2.5 || Math.abs(z - cz) < 2.5 || parkFeatureAt(x - cx, z - cz)) continue;
        this.addTree(x, z, 0.9 + r() * 0.7);
      }
      for (const [bx, bz, ry] of [[-3.5, -8, 0], [3.5, 10, Math.PI]]) {
        const b = new THREE.Group();
        b.add(mesh(rbox(2.2, 0.15, 0.7, 0.05, 1), mat(0x8a5a35), { y: 0.55 }), mesh(rbox(2.2, 0.6, 0.12, 0.05, 1), mat(0x8a5a35), { y: 0.9, z: -0.3 }));
        b.position.set(cx + bx, 0.3, cz + bz); b.rotation.y = ry;
        g.add(b);
      }
    } else if (type === 'highway') {
      inner(0x4a505c);
      const lot = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshStandardMaterial({ map: lotTexture(40, 12, 8), roughness: 0.95 }));
      lot.rotation.x = -Math.PI / 2; lot.position.set(cx, 0.33, cz); lot.receiveShadow = true;
      g.add(lot);
      const bb = new THREE.Group();
      bb.add(mesh(rbox(0.5, 7, 0.5, 0.1, 1), mat(0x8b929c), { x: -6, y: 3.5 }), mesh(rbox(0.5, 7, 0.5, 0.1, 1), mat(0x8b929c), { x: 6, y: 3.5 }));
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.5), new THREE.MeshBasicMaterial({ map: textTexture('FAST CHARGING • NEXT EXIT', { w: 512, h: 160, bg: '#1f8a4c', font: 'bold 44px system-ui' }) }));
      sign.position.set(0, 8.5, 0.3);
      const sign2 = sign.clone(); sign2.position.z = -0.3; sign2.rotation.y = Math.PI;
      bb.add(sign, sign2);
      bb.position.set(cx, 0.3, cz - 17);
      g.add(bb);
      this.colliders.add(cx - 6, cz - 17, 1, 1, 8); this.colliders.add(cx + 6, cz - 17, 1, 1, 8);
      for (let i = 0; i < 3; i++) {
        const v = createCar('van', [0xf4f7fa, 0xffc43d, 0x2f8cff][i]);
        v.position.set(cx - 12 + i * 12.5, 0.3, cz - 2);
        g.add(v);
      }
      for (const sx of [-1, 1]) for (let i = -2; i <= 2; i++) this.addTree(cx + sx * 21, cz + i * 8, 1);
    } else if (type === 'sale') {
      inner(0x8b929c);
      this.buildForSale(g, cx, cz, ix, iz);
    }

    // sidewalk street trees along the block's sides facing the road
    if (type !== 'park' && type !== 'station') {
      for (let k = -1; k <= 1; k += 2) {
        this.addTree(cx + k * 22.5, cz - 10, 0.8); this.addTree(cx + k * 22.5, cz + 10, 0.8);
      }
    }
  }

  buildForSale(g, cx, cz, ix, iz) {
    const defs = {
      '0,-1': { category: 'EV Garage site', price: 5000, stage: 2, facility: 'garage', label: 'EV GARAGE' },
      '-1,0': { category: 'Car Wash site', price: 3000, stage: 2, facility: 'wash', label: 'CAR WASH' },
      '1,1': { category: 'Commercial business lot', price: 40000, stage: 3, facility: 'hub_commercial', label: 'COMMERCIAL HUB' },
      '-2,1': { category: 'Small charging lot', price: 8000, stage: 2, facility: 'hub_small', label: 'SMALL LOT' },
      '0,2': { category: 'Industrial fleet depot', price: 55000, stage: 3, facility: 'hub_industrial', label: 'FLEET DEPOT' },
      '2,0': { category: 'Highway charging lot', price: 120000, stage: 4, facility: 'hub_highway', label: 'HIGHWAY HUB' },
    };
    const def = defs[`${ix},${iz}`];
    const sale = new THREE.Group(); // everything that disappears when the lot is built on
    g.add(sale);
    // fence
    const post = mat(0xf4f7fa);
    for (let i = -10; i <= 10; i++) {
      for (const [x, z] of [[i * 2, -20], [i * 2, 20], [-20, i * 2], [20, i * 2]]) {
        if (Math.abs(x) > 20 || Math.abs(z) > 20) continue;
        sale.add(mesh(rbox(0.2, 1.2, 0.2, 0.05, 1), post, { x: cx + x, y: 0.9, z: cz + z, cast: false }));
      }
    }
    for (const [x, z, w, d] of [[0, -20, 40, 0.12], [0, 20, 40, 0.12], [-20, 0, 0.12, 40], [20, 0, 0.12, 40]]) {
      sale.add(mesh(rbox(w, 0.12, d, 0.03, 1), mat(0xffc43d), { x: cx + x, y: 1.2, z: cz + z, cast: false }));
    }
    const board = new THREE.Group();
    board.add(mesh(rbox(0.3, 3, 0.3, 0.05, 1), mat(0x6b4a2b), { x: -2.2, y: 1.5 }), mesh(rbox(0.3, 3, 0.3, 0.05, 1), mat(0x6b4a2b), { x: 2.2, y: 1.5 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.2), new THREE.MeshBasicMaterial({ map: textTexture(def.facility ? `BUILD ${def.label}  $${def.price.toLocaleString('en-US')}` : `FOR SALE  $${def.price.toLocaleString('en-US')}`, { w: 512, h: 200, bg: '#e8483f', font: 'bold 54px system-ui' }) }));
    face.position.set(0, 3, 0.2);
    const back = face.clone(); back.position.z = -0.2; back.rotation.y = Math.PI;
    board.add(face, back);
    board.position.set(cx, 0.3, cz + 16);
    sale.add(board);
    for (let i = 0; i < 6; i++) {
      const cone = mesh(new THREE.ConeGeometry(0.35, 0.8, 10), mat(0xff7a1a), { x: cx - 8 + i * 3.2, y: 0.7, z: cz - 6 + (i % 2) * 3 });
      sale.add(cone);
    }
    // floating marker so purchasable lots are easy to spot (also from the isometric view)
    const mc = document.createElement('canvas');
    mc.width = mc.height = 128;
    const mg = mc.getContext('2d');
    mg.fillStyle = '#1fb86a'; mg.beginPath(); mg.arc(64, 60, 50, 0, Math.PI * 2); mg.fill();
    mg.beginPath(); mg.moveTo(40, 98); mg.lineTo(64, 126); mg.lineTo(88, 98); mg.fill();
    mg.strokeStyle = '#fff'; mg.lineWidth = 7; mg.beginPath(); mg.arc(64, 60, 46, 0, Math.PI * 2); mg.stroke();
    mg.fillStyle = '#fff'; mg.font = 'bold 66px system-ui, sans-serif'; mg.textAlign = 'center'; mg.textBaseline = 'middle';
    mg.fillText('$', 64, 64);
    const mt = new THREE.CanvasTexture(mc);
    mt.colorSpace = THREE.SRGBColorSpace;
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: mt, transparent: true, depthWrite: false }));
    marker.scale.set(4, 4, 1);
    marker.position.set(cx, 9, cz);
    marker.renderOrder = 9;
    sale.add(marker);
    this.markers.push({ marker, baseY: 9 });
    this.properties.push({ id: `lot_${ix}_${iz}`, ...def, x: cx, z: cz, owned: false, sale, markerObj: marker });
  }

  buildInstancedProps() {
    const q = this.settings.quality;
    // trees
    const n = this.treePos.length;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 1.8, 7), mat(0x7a5232), n);
    const leaf = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.25, 1), mat(0xffffff, { rough: 0.9 }), n);
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), c = new THREE.Color();
    const r = rng(77);
    const cols = [0x3fae4a, 0x58c15a, 0x2e9a4f, 0x7dd05b, 0xf4a259];
    this.treePos.forEach(([x, z, s], i) => {
      m4.compose(new THREE.Vector3(x, 0.3 + 0.9 * s, z), q4, new THREE.Vector3(s, s, s));
      trunk.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x, 0.3 + 2.7 * s, z), q4, new THREE.Vector3(s, s * (0.9 + r() * 0.3), s));
      leaf.setMatrixAt(i, m4);
      leaf.setColorAt(i, c.setHex(cols[Math.floor(r() * (r() > 0.9 ? 5 : 3))]));
      if (s > 0.85) this.colliders.add(x, z, 0.7, 0.7, 4);
    });
    trunk.castShadow = leaf.castShadow = q.treeShadows;
    this.root.add(trunk, leaf);
    this.treeMeshes = [trunk, leaf];

    // street lamps (pole + glowing head, instanced)
    const lampN = this.lampPos.length;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 6, 8), mat(0x56606b, { metal: 0.4 }), lampN);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff4c4, emissive: 0xffe08a, emissiveIntensity: 0 });
    nightMaterials.add(lampMat);
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 12, 10), lampMat, lampN);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 1.2), mat(0x56606b, { metal: 0.4 }), lampN);
    this.lampPos.forEach(([x, z, ang], i) => {
      q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      const off = new THREE.Vector3(0, 0, 0.6).applyQuaternion(q4);
      m4.compose(new THREE.Vector3(x, 3.3, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      pole.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x + off.x, 6.1, z + off.z), q4, new THREE.Vector3(1, 1, 1));
      arm.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x + off.x * 2, 6.0, z + off.z * 2), new THREE.Quaternion(), new THREE.Vector3(1, 0.7, 1));
      head.setMatrixAt(i, m4);
    });
    pole.castShadow = true;
    this.root.add(pole, arm, head);
  }

  /** Distance-based chunk visibility (simple streaming of detailed block content). */
  update(playerPos, time = 0, zoom = 1) {
    const sc = 4 * Math.max(1, zoom);
    for (const m of this.markers) {
      m.marker.position.y = m.baseY * Math.max(1, zoom * 0.8) + Math.sin(time * 2 + m.marker.position.x) * 0.5;
      m.marker.scale.set(sc, sc, 1);
    }
    const d = this.settings.quality.cullDist;
    // chunk visibility only changes when the view moved a little or the quality (cull distance) changed
    const lc = this._lastCull;
    if (lc && lc.d === d && Math.abs(lc.x - playerPos.x) < 1 && Math.abs(lc.z - playerPos.z) < 1) return;
    this._lastCull = { x: playerPos.x, z: playerPos.z, d };
    for (const c of this.chunks) {
      const dist = Math.hypot(c.cx - playerPos.x, c.cz - playerPos.z);
      const vis = dist < d + 34;
      if (c.group.visible !== vis) c.group.visible = vis;
    }
  }
}
