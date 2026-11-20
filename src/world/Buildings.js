import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat, nightMaterials, textTexture, wallMaterial } from './Materials.js';

/**
 * Procedural "premium" building facades. Every building keeps the exact footprint and height it was asked for (so colliders,
 * property placement and pathfinding never change) and gains: corner pilasters, belt courses, a cornice, a roof parapet,
 * a stepped crown, rooftop equipment, glazed storefronts with doors and striped awnings, balconies, signs and style-specific
 * features. All small parts of one building are merged into ONE vertex-coloured mesh plus ONE shared emissive-glass mesh.
 */
export const BUILDING_STYLES = ['office', 'apartment', 'hotel', 'shop', 'cafe', 'restaurant', 'ev', 'warehouse'];

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _c = new THREE.Color(), _w = new THREE.Color(), _k = new THREE.Color();
export const shade = (hex, f) => _c.set(hex).lerp(f >= 0 ? _w.set(0xffffff) : _k.set(0x000000), Math.abs(f)).getHex();

export class Kit {
  constructor() { this.parts = []; }
  add(geo, color) {
    if (geo.index) geo = geo.toNonIndexed(); // merged parts must all share one indexing mode
    const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    this.parts.push(geo);
  }
  box(x, y, z, sx, sy, sz, color) { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); this.add(g, color); }
  cyl(x, y, z, r, h, color, seg = 10) { const g = new THREE.CylinderGeometry(r, r, h, seg); g.translate(x, y, z); this.add(g, color); }
  build(material) {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    const m = new THREE.Mesh(g, material);
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

let sharedMat = null, glassMat = null;
const detailMaterial = () => (sharedMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }));
/** warm window-glass: pale blue by day, glowing at night (driven by DayNight through nightMaterials) */
export const glassMaterial = () => {
  if (!glassMat) {
    glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd3f2, roughness: 0.22, metalness: 0.15, emissive: 0xffc77a, emissiveIntensity: 0 });
    nightMaterials.add(glassMat);
  }
  return glassMat;
};

export function pickStyle(i, h) {
  if (h <= 6) return ['shop', 'cafe', 'restaurant', 'ev'][i % 4];
  if (h <= 14) return ['shop', 'restaurant', 'apartment', 'hotel'][i % 4];
  return ['office', 'apartment', 'hotel', 'office'][i % 4];
}

/**
 * Builds the building group. Options: { style, seed, roofColor, awning, sign }.
 * `style` is optional; without it callers get the same simple building they always did (business lots keep their look
 * until their own identity pass).
 */
export function createPremiumBuilding(w, h, d, color, { style = 'office', seed = 1, roofColor = 0xf4f7fa, awning = null, sign = null } = {}) {
  const r = seeded(seed * 9973 + Math.floor(h) * 31 + Math.floor(w));
  const g = new THREE.Group();
  const tone = shade(color, 0.0);
  const trim = shade(color, 0.55), dark = shade(color, -0.45);
  const kit = new Kit(), glass = new Kit();

  // --- body (top/bottom faces dropped: roof cap and ground slab cover them, saving two draw groups)
  const sideX = wallMaterial(color, d, h), sideZ = wallMaterial(color, w, h);
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.groups = geo.groups.filter((gr) => gr.materialIndex !== 2 && gr.materialIndex !== 3);
  const body = new THREE.Mesh(geo, [sideX, sideX, sideX, sideX, sideZ, sideZ]);
  body.position.y = h / 2; body.castShadow = body.receiveShadow = true;
  g.add(body);

  const hw = w / 2, hd = d / 2;
  const facesZ = [[1, hd], [-1, -hd]]; // front/back facades (+z / -z)

  // --- base plinth, belt courses, cornice, pilasters
  kit.box(0, 0.25, 0, w + 0.5, 0.5, d + 0.5, dark);
  const belts = h > 12 ? Math.floor(h / 8) : 0;
  for (let k = 1; k <= belts; k++) kit.box(0, k * (h / (belts + 1)), 0, w + 0.3, 0.28, d + 0.3, trim);
  kit.box(0, h - 0.15, 0, w + 0.8, 0.5, d + 0.8, trim); // cornice
  kit.box(0, h + 0.2, 0, w + 0.5, 0.5, d + 0.5, roofColor); // roof slab
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(sx * hw, h / 2, sz * hd, 0.7, h, 0.7, trim);

  // --- parapet around the roof
  const py = h + 0.9;
  kit.box(0, py, hd - 0.15, w + 0.3, 0.7, 0.3, trim); kit.box(0, py, -hd + 0.15, w + 0.3, 0.7, 0.3, trim);
  kit.box(hw - 0.15, py, 0, 0.3, 0.7, d - 0.3, trim); kit.box(-hw + 0.15, py, 0, 0.3, 0.7, d - 0.3, trim);

  // --- stepped crown / rooftop equipment (not on low shops)
  if (h >= 14) {
    const cw = w * (0.55 + r() * 0.15), cd = d * (0.55 + r() * 0.15), ch = 2.4 + r() * 2;
    kit.box((r() - 0.5) * 2, h + 0.45 + ch / 2, (r() - 0.5) * 2, cw, ch, cd, shade(color, 0.2));
    kit.box(0, h + 0.45 + ch + 0.2, 0, cw + 0.5, 0.4, cd + 0.5, roofColor);
    kit.box(hw * 0.5, h + 0.45 + ch + 2.2, -hd * 0.4, 0.14, 4, 0.14, 0x59616c); // antenna
  }
  const units = 2 + Math.floor(r() * 3);
  for (let k = 0; k < units; k++) {
    const ux = (r() - 0.5) * (w - 4), uz = (r() - 0.5) * (d - 4);
    if (k === 0 && h >= 8) { // water tank on legs
      kit.cyl(ux, h + 2.6, uz, 1.3, 2.4, 0x9b6b43, 12); kit.box(ux, h + 1.2, uz, 2.2, 1.0, 2.2, 0x59616c);
    } else kit.box(ux, h + 1.35, uz, 2 + r(), 1.1, 1.8 + r(), 0xb5bdc7);
  }

  // --- ground floor: glazed storefront on both street faces with mullions, door and awning
  const awnCol = awning ?? [0xff7a59, 0x35c28a, 0xffc43d, 0xb06cff, 0x2f8cff][Math.floor(r() * 5)];
  const bays = Math.max(2, Math.round(w / 4.2));
  for (const [s, zf] of facesZ) {
    const gw = (w - 2) / bays;
    for (let b = 0; b < bays; b++) {
      const x = -hw + 1 + gw * (b + 0.5);
      const door = style !== 'office' ? b === Math.floor(bays / 2) : b === Math.floor(bays / 2);
      if (door) {
        kit.box(x, 1.2, zf + s * 0.08, gw * 0.55, 2.4, 0.16, 0x6b4a2f);
        glass.box(x, 1.55, zf + s * 0.17, gw * 0.4, 1.4, 0.04);
        const stepCol = shade(awnCol, -0.1); // two red-ish shop steps leading to the door
        kit.box(x, 0.1, zf + s * 0.55, gw * 0.9, 0.2, 1.0, stepCol);
        kit.box(x, 0.24, zf + s * 0.3, gw * 0.75, 0.2, 0.55, shade(awnCol, 0.1));
      } else {
        glass.box(x, 1.55, zf + s * 0.06, gw - 0.35, 2.3, 0.1);
        kit.box(x, 2.85, zf + s * 0.09, gw - 0.25, 0.25, 0.16, dark);
      }
      kit.box(x - gw / 2, 1.5, zf + s * 0.08, 0.16, 2.6, 0.2, dark); // mullion
    }
    // striped awning (alternating segments, tilted look from a stepped lip)
    const seg = 0.9, n = Math.floor((w - 1) / seg);
    for (let i = 0; i < n; i++) {
      const x = -((n - 1) * seg) / 2 + i * seg;
      kit.box(x, 3.3, zf + s * 0.85, seg, 0.14, 1.7, i % 2 ? 0xffffff : awnCol);
      kit.box(x, 3.05, zf + s * 1.6, seg, 0.28, 0.08, i % 2 ? 0xffffff : awnCol);
    }
    // planters or bench-front details so storefronts differ
    if (style === 'shop' || style === 'cafe' || style === 'restaurant') {
      for (const px of [-hw + 2.2, hw - 2.2]) { kit.box(px, 0.4, zf + s * 1.1, 1.3, 0.55, 0.6, 0x8a5a35); kit.box(px, 0.82, zf + s * 1.1, 1.1, 0.35, 0.45, 0x3fae4a); }
    }
  }
  // side-face shopfront band (x faces get a darker ground band + two windows)
  for (const sx of [1, -1]) {
    glass.box(sx * (hw + 0.06), 1.55, -d * 0.22, 0.1, 2.0, d * 0.28);
    glass.box(sx * (hw + 0.06), 1.55, d * 0.22, 0.1, 2.0, d * 0.28);
  }

  // --- style features
  if (style === 'apartment') {
    const gap = 4.5, floors = Math.floor((h - 5) / gap);
    for (let f = 0; f < floors; f++) {
      const y = 5.6 + f * gap;
      const nb = Math.max(2, Math.round(w / 6));
      for (const [s, zf] of facesZ) for (let b = 0; b < nb; b++) {
        const x = -hw + 2.2 + b * ((w - 4.4) / (nb - 1));
        kit.box(x, y, zf + s * 0.6, 2.4, 0.2, 1.2, trim);
        kit.box(x, y + 0.5, zf + s * 1.15, 2.4, 0.8, 0.07, dark);
      }
    }
  } else if (style === 'hotel') {
    kit.box(hw + 0.25, h * 0.62, hd - 1.4, 0.4, 6.5, 2.4, shade(color, -0.2)); // vertical blade sign
    glass.box(hw + 0.48, h * 0.62, hd - 1.4, 0.06, 5.8, 1.8);
    kit.box(0, 3.7, hd + 1.9, 5.5, 0.22, 3, trim); // porte-cochere canopy
    for (const px of [-2.4, 2.4]) kit.box(px, 1.8, hd + 3.2, 0.28, 3.6, 0.28, 0xe9d9a6);
  } else if (style === 'office') {
    for (let k = 1; k < Math.floor(w / 3); k++) for (const [s, zf] of facesZ) kit.box(-hw + k * 3, h * 0.55, zf + s * 0.1, 0.12, h * 0.8, 0.16, dark); // vertical fins
    kit.box(0, h + 0.5, 0, w * 0.35, 0.12, d * 0.35, 0xf4c542); // helipad plate
  } else if (style === 'ev' || style === 'restaurant' || style === 'cafe') {
    kit.box(0, 4.3, hd + 0.12, Math.min(w * 0.7, 7.4), 1.25, 0.14, 0x20262f); // sign backing
    for (const px of [-hw + 0.6, hw - 0.6]) kit.box(px, h * 0.5, hd + 0.2, 0.18, h, 0.18, 0xffffff);
  } else if (style === 'warehouse') {
    for (let k = 0; k < 3; k++) kit.box(-hw * 0.5 + k * hw * 0.5, 2, hd + 0.1, 3.2, 4, 0.2, 0x59616c);
  }

  // --- EV-business identities: lit sign band under the cornice plus a rooftop icon visible from the management camera
  if (style === 'ev' || style === 'wash' || style === 'garage' || style === 'cafe') {
    for (const [s, zf] of facesZ) glass.box(0, h - 0.95, zf + s * 0.07, w * 0.8, 0.22, 0.05);
    const top = h + 0.9;
    if (style === 'ev') {
      const bolt = new THREE.Shape();
      bolt.moveTo(0.3, 1.6); bolt.lineTo(-0.7, -0.1); bolt.lineTo(-0.05, -0.1); bolt.lineTo(-0.3, -1.6); bolt.lineTo(0.7, 0.15); bolt.lineTo(0.05, 0.15); bolt.closePath();
      const bg = new THREE.ExtrudeGeometry(bolt, { depth: 0.35, bevelEnabled: false }); bg.scale(1.1, 1.1, 1); bg.translate(0, top + 2.2, -0.15); kit.add(bg, 0xffd23f);
      const disc = new THREE.CylinderGeometry(2.2, 2.2, 0.25, 24); disc.rotateX(Math.PI / 2); disc.translate(0, top + 2.2, -0.35); kit.add(disc, 0x17a35a);
      kit.cyl(0, top + 0.5, -0.3, 0.2, 1.0, 0x59616c, 6);
    } else if (style === 'wash') {
      [[-hw * 0.55, 0.9, 0xffffff], [-hw * 0.3, 0.6, 0x9fe6ff], [hw * 0.1, 1.1, 0xffffff], [hw * 0.45, 0.7, 0x9fe6ff], [hw * 0.7, 0.5, 0xffffff]].forEach(([bx, rad, col], i) => {
        const sp = new THREE.SphereGeometry(rad, 12, 10); sp.translate(bx, top + rad + (i % 2) * 0.9, -0.3); kit.add(sp, col);
      });
      for (const sx of [-1, 1]) { kit.cyl(sx * (hw - 0.6), 1.7, hd + 0.9, 0.38, 3.2, sx > 0 ? 0xff7a59 : 0x2f8cff, 10); kit.cyl(sx * (hw - 0.6), 3.4, hd + 0.9, 0.5, 0.25, 0xffffff, 10); }
    } else if (style === 'garage') {
      for (const sx of [-1, 1]) {
        kit.box(sx * w * 0.27, 1.6, hd + 0.14, w * 0.2, 3.1, 0.18, 0x59616c);
        for (let k = 0; k < 5; k++) kit.box(sx * w * 0.27, 0.5 + k * 0.6, hd + 0.25, w * 0.2 - 0.1, 0.08, 0.06, 0x8b929c);
      }
      const gear = new THREE.CylinderGeometry(1.2, 1.2, 0.35, 16); gear.rotateX(Math.PI / 2); gear.translate(0, top + 1.8, -0.2); kit.add(gear, 0xf4f7fa);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.283; kit.box(Math.cos(a) * 1.4, top + 1.8 + Math.sin(a) * 1.4, -0.2, 0.5, 0.5, 0.35, 0xf4f7fa); }
      kit.cyl(0, top + 1.8, -0.2, 0.45, 0.4, 0x2b3340, 10);
    } else {
      kit.cyl(0, top + 1.0, -0.3, 1.5, 0.15, 0xf4f7fa, 18); kit.cyl(0, top + 1.9, -0.3, 1.0, 1.6, 0xffffff, 18);
      const handle = new THREE.TorusGeometry(0.5, 0.12, 8, 14); handle.translate(1.15, top + 1.9, -0.3); kit.add(handle, 0x8a5a35);
      for (const [sx, sy] of [[-0.3, 3.2], [0.25, 3.8], [-0.1, 4.4]]) { const st = new THREE.SphereGeometry(0.22, 8, 6); st.translate(sx, top + sy, -0.3); kit.add(st, 0xf1f3f5); }
    }
  }
  g.add(kit.build(detailMaterial()));
  const gm = glass.build(glassMaterial());
  if (gm) { gm.castShadow = false; g.add(gm); }

  if (sign) {
    const t = textTexture(sign.text, { bg: sign.bg || '#ffffff', fg: sign.fg || '#1f2a37', w: 256, h: 64 });
    const sw = Math.min(w * 0.6, 7);
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 4), new THREE.MeshBasicMaterial({ map: t }));
    sm.position.set(0, 4.3, d / 2 + 0.22);
    g.add(sm);
    const sm2 = sm.clone(); sm2.position.z = -d / 2 - 0.22; sm2.rotation.y = Math.PI;
    g.add(sm2);
  }
  g.userData.size = { w, h, d };
  g.userData.style = style;
  return g;
}
