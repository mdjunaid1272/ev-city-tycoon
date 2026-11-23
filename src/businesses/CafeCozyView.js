import * as THREE from 'three';
import { Kit, glassMaterial } from '../world/Buildings.js';
import { createCharacter, animateCharacter } from '../world/Models.js';
import { nightFades } from '../world/Materials.js';
import { CAFE_LAYOUT } from './Cafe.js';

const FLOOR = 0.34;
const WALK = 2.5;
const MAX_BY_QUALITY = { low: 3, medium: 4, high: 5 };
const _c = new THREE.Color();

/**
 * The 3D side of the cozy café, drawn inside CafeView's room:
 *  - machines on the back counter, a bakery counter (display case, mixer, oven) along the west wall
 *  - the decoration (tables with stools, plants, lamps, pictures, curtains, rugs, counter props), one merged mesh per placed item
 *  - the theme (wall tint, floor colours)
 *  - the customers: real 3D characters with their own colours, walking in, queueing with an order bubble, sitting at a table
 *    to enjoy their order, and leaving
 * It only draws what CafeCozy says and never changes game state. Everything is pooled / rebuilt only when something changed.
 */
export class CafeCozyView {
  constructor({ cafeView, cozy, settings = null }) {
    this.cv = cafeView; this.cozy = cozy; this.settings = settings;
    this.group = new THREE.Group();
    cafeView.root.add(this.group);
    this.decorGroup = new THREE.Group(); this.group.add(this.decorGroup);
    this.vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
    this.picMats = {};
    this.decorVersion = -1;
    this.figs = new Map(); this.pool = []; this.created = 0; this.t = 0;
    this.shownGuests = false;
    this.pickupSprites = [];
    this.buildMachines();
    for (let i = 0; i < cozy.cfg.quality.pickupMax; i++) { const sp = this.makeSprite(0.9, 0.9, 1.0); sp.visible = false; this.group.add(sp); this.pickupSprites.push(sp); }
    this.baseWall = new THREE.Color(0xb8793e);
  }

  get maxFigures() { return MAX_BY_QUALITY[this.settings?.data?.quality] ?? 4; }

  dispose() {
    this.cv.root.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); } });
    this.vmat.dispose();
    for (const m of Object.values(this.picMats)) { m.map?.dispose(); m.dispose(); }
    for (const m of this.pools || []) m.material.dispose();
  }

  // ---------- machines and counters (static) ----------
  buildMachines() {
    const k = new Kit(), g = new Kit(), b = CAFE_LAYOUT.building, z0 = b.z - b.d / 2, x0 = b.x - b.w / 2;
    const cz = z0 + 0.6; // back counter depth centre (against the back wall)
    const steel = 0xc9ced6, dark = 0x2a2f36, wood = 0x7a4a28, top = 0xf1e2c8;
    // back counter with the drink machines
    k.box(17.6, 0.45, cz, 5.2, 0.9, 0.7, wood); k.box(17.6, 0.93, cz, 5.3, 0.08, 0.8, top);
    // grinder: body + bean hopper
    k.box(15.5, 1.25, cz, 0.45, 0.5, 0.4, dark); { const h = new THREE.ConeGeometry(0.26, 0.4, 10); h.rotateX(Math.PI); h.translate(15.5, 1.7, cz); k.add(h, 0x6b4a2c); }
    // espresso machine: wide body, two group heads, a drip tray
    k.box(16.4, 1.3, cz, 0.95, 0.6, 0.55, steel); k.box(16.4, 1.65, cz, 1.0, 0.1, 0.6, dark); k.box(16.1, 1.05, cz + 0.32, 0.12, 0.2, 0.12, dark); k.box(16.7, 1.05, cz + 0.32, 0.12, 0.2, 0.12, dark); k.box(16.4, 0.99, cz + 0.33, 0.8, 0.04, 0.2, dark);
    // milk steamer: tank + wand
    k.cyl(17.3, 1.3, cz, 0.22, 0.6, 0xdfe5ec, 14); k.box(17.5, 1.1, cz + 0.28, 0.04, 0.5, 0.04, steel);
    // drip & tea machine: box with a glass carafe
    k.box(18.1, 1.35, cz, 0.55, 0.7, 0.42, 0x3a4a6b); { const car = new THREE.CylinderGeometry(0.14, 0.14, 0.3, 12); car.translate(18.1, 1.1, cz + 0.2); g.add(car, 0x9fd3f2); }
    // blender
    k.cyl(18.85, 1.12, cz, 0.18, 0.28, dark, 12); { const jar = new THREE.CylinderGeometry(0.2, 0.15, 0.5, 12); jar.translate(18.85, 1.5, cz); g.add(jar, 0xbfe6ff); } k.cyl(18.85, 1.78, cz, 0.21, 0.06, dark, 12);
    // cup rack
    for (let i = 0; i < 3; i++) k.cyl(19.55 + i * 0.28, 1.05, cz, 0.1, 0.14, 0xf4f7fa, 10);
    // bakery counter along the west wall: oven, mixer, display case
    const bx = x0 + 0.55;
    k.box(bx, 0.45, b.z - 3.6, 0.7, 0.9, 3.2, wood); k.box(bx, 0.93, b.z - 3.6, 0.8, 0.08, 3.3, top);
    k.box(bx, 1.35, b.z - 5.0, 0.6, 0.8, 0.9, 0x59616c); { const win = new THREE.BoxGeometry(0.04, 0.4, 0.55); win.translate(bx + 0.32, 1.35, b.z - 5.0); g.add(win, 0xffb36b); } k.box(bx, 1.8, b.z - 5.0, 0.62, 0.08, 0.92, dark); // oven
    k.cyl(bx, 1.15, b.z - 3.7, 0.26, 0.4, 0xff8fb1, 14); k.cyl(bx, 1.4, b.z - 3.7, 0.3, 0.1, 0xffd1e0, 14); k.box(bx, 1.7, b.z - 3.7, 0.08, 0.5, 0.08, steel); // mixer bowl on a stand
    k.box(bx, 1.08, b.z - 2.5, 0.6, 0.26, 1.2, 0xfff3d6); { const glass = new THREE.BoxGeometry(0.56, 0.4, 1.12); glass.translate(bx, 1.4, b.z - 2.5); g.add(glass, 0xcfe8ff); } // display case (desserts are drawn by showDisplay)
    this.machMesh = k.build(this.vmat); this.machMesh.castShadow = true; this.machMesh.position.y = FLOOR; this.group.add(this.machMesh);
    this.machGlass = g.build(glassMaterial()); this.machGlass.castShadow = false; this.machGlass.position.y = FLOOR; this.group.add(this.machGlass);
    // desserts in the display case: three little instanced shapes (donut ring, croissant crescent, cookie) refreshed from the stock
    const dg = new THREE.TorusGeometry(0.1, 0.045, 8, 14); dg.rotateX(Math.PI / 2);
    this.donuts = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ color: 0xe9a35b, roughness: 0.7 }), 8); this.donuts.count = 0;
    this.croissants = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.06, 0.12, 3, 8), new THREE.MeshStandardMaterial({ color: 0xd9a14a, roughness: 0.7 }), 8); this.croissants.count = 0;
    for (const m of [this.donuts, this.croissants]) { m.frustumCulled = false; this.group.add(m); }
    this.displayKey = '';
  }

  showDisplay() {
    const d = this.cozy.display, key = `${d.donut}|${d.croissant}`;
    if (key === this.displayKey) return;
    this.displayKey = key;
    const b = CAFE_LAYOUT.building, bx = b.x - b.w / 2 + 0.55, M = new THREE.Matrix4();
    const put = (inst, n, row) => { inst.count = n; for (let i = 0; i < n; i++) { M.makeTranslation(bx + (row === 0 ? -0.12 : 0.14), FLOOR + 1.26, b.z - 2.5 - 0.5 + (i % 4) * 0.3 + (i >= 4 ? 0.12 : 0)); if (i >= 4) M.setPosition(bx + (row === 0 ? -0.12 : 0.14), FLOOR + 1.3, b.z - 2.5 - 0.5 + (i - 4) * 0.3 + 0.12); inst.setMatrixAt(i, M); } inst.instanceMatrix.needsUpdate = true; };
    put(this.donuts, Math.min(8, d.donut || 0), 0); put(this.croissants, Math.min(8, d.croissant || 0), 1);
  }

  // ---------- decoration ----------
  picMat(id, it) {
    if (this.picMats[id]) return this.picMats[id];
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const g = c.getContext('2d'); g.fillStyle = it.color; g.fillRect(0, 0, 96, 96); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(6, 6, 84, 84);
    g.font = '58px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(it.icon, 48, 52);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return (this.picMats[id] = new THREE.MeshBasicMaterial({ map: t }));
  }

  /** One placed item as a Group (a merged vertex-coloured mesh, plus a glowing part for lamps). Origin = the slot position on the floor. */
  decorModel(id, it, slot) {
    const k = new Kit(), g = new Kit(), grp = new THREE.Group(), col = it.color;
    const fx = (x, y, z, sx, sy, sz, c) => k.box(x, y, z, sx, sy, sz, c);
    switch (it.kind) {
      case 'table': {
        if (it.sofa) { fx(0, 0.28, 0, 2.2, 0.42, 0.9, col); fx(0, 0.75, -0.38, 2.2, 0.7, 0.16, col); fx(-1.05, 0.5, 0, 0.18, 0.6, 0.9, it.leg); fx(1.05, 0.5, 0, 0.18, 0.6, 0.9, it.leg); fx(0, 0.58, 0.05, 2.0, 0.12, 0.8, '#ffffff'); fx(0, 0.38, 0.62, 1.4, 0.1, 0.5, 0xf1e2c8); break; }
        if (/Square|Glass/.test(id)) fx(0, 0.76, 0, 1.15, 0.08, 1.15, col); else k.cyl(0, 0.76, 0, 0.55, 0.08, col, 18);
        k.cyl(0, 0.38, 0, 0.08, 0.7, it.leg, 8);
        for (const sx of [-0.85, 0.85]) k.cyl(sx, 0.22, 0.1, 0.26, 0.45, 0x2f8cff, 10);
        break;
      }
      case 'floor': {
        if (id === 'plantFern') { k.cyl(0, 0.2, 0, 0.26, 0.4, 0xb5653a, 10); for (const [x, z, s] of [[0, 0, 0.5], [0.18, 0.1, 0.38], [-0.2, -0.05, 0.4]]) { const l = new THREE.IcosahedronGeometry(s, 1); l.translate(x, 0.65 + s * 0.3, z); k.add(l, col); } }
        else if (id === 'plantPalm') { k.cyl(0, 0.2, 0, 0.3, 0.4, 0xb5653a, 10); k.cyl(0, 0.9, 0, 0.07, 1.1, 0x7a5232, 6); for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283, l = new THREE.ConeGeometry(0.16, 0.8, 5); l.rotateZ(Math.PI / 2.4); l.rotateY(a); l.translate(Math.cos(a) * 0.3, 1.55, Math.sin(a) * 0.3); k.add(l, col); } }
        else if (id === 'plantBloom') { k.cyl(0, 0.18, 0, 0.24, 0.36, 0xf4f7fa, 10); const l = new THREE.IcosahedronGeometry(0.34, 1); l.translate(0, 0.62, 0); k.add(l, 0x3fae4a); for (const [x, y, z, c] of [[0.14, 0.9, 0.05, col], [-0.12, 0.85, 0.12, 0xffc43d], [0.02, 0.95, -0.14, 0xffffff]]) { const f = new THREE.SphereGeometry(0.1, 8, 6); f.translate(x, y, z); k.add(f, c); } }
        else if (id === 'floorLamp' || id === 'deskLamp' || id === 'glowLamp' || id === 'greenLantern') {
          k.cyl(0, 0.05, 0, 0.18, 0.1, 0x3b4450, 10); k.cyl(0, 0.8, 0, 0.03, 1.5, 0x3b4450, 6);
          const sh = id === 'glowLamp' ? new THREE.SphereGeometry(0.22, 12, 10) : id === 'greenLantern' ? new THREE.CylinderGeometry(0.2, 0.2, 0.4, 8) : new THREE.ConeGeometry(0.32, 0.4, 10, 1, true); sh.translate(0, 1.65, 0); g.add(sh, col);
        } else if (id === 'bookShelf') { fx(0, 0.9, 0, 0.9, 1.8, 0.35, col); for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) fx(-0.34 + i * 0.13, 0.35 + r * 0.42, 0.1, 0.1, 0.3, 0.2, [0xe8483f, 0x2f8cff, 0xffc43d, 0x35c28a, 0xb06cff, 0xffffff][(i + r) % 6]); }
        else if (id === 'bakeryCase') { fx(0, 0.45, 0, 0.9, 0.9, 0.5, 0xfff3d6); const gl = new THREE.BoxGeometry(0.86, 0.5, 0.46); gl.translate(0, 1.15, 0); g.add(gl, 0xcfe8ff); for (const x of [-0.25, 0, 0.25]) { const c = new THREE.SphereGeometry(0.09, 8, 6); c.translate(x, 1.0, 0); k.add(c, [0xff8fb1, 0xe9a35b, 0xffffff][Math.round((x + 0.25) * 4) % 3]); } }
        else { fx(0, 0.5, 0, 0.5, 1.0, 0.5, col); }
        break;
      }
      case 'wall': {
        const w = id === 'muralSunrise' ? 2.2 : id === 'wallClock' || id === 'mirror' || id === 'paperLantern' ? 0.7 : 1.0, h = id === 'muralSunrise' ? 1.2 : id === 'shelfWood' ? 0.12 : 0.8;
        if (id === 'shelfWood') { fx(0, 0, 0.12, 1.2, 0.07, 0.3, col); for (let i = 0; i < 4; i++) k.cyl(-0.45 + i * 0.3, 0.16, 0.12, 0.08, 0.2, [0xd9a14a, 0xf2e6d2, 0x3fae4a, 0xe8483f][i], 8); }
        else if (id === 'paperLantern') { const s = new THREE.SphereGeometry(0.28, 12, 10); s.translate(0, 0, 0.3); g.add(s, col); }
        else if (id === 'wallClock') { k.cyl(0, 0, 0.05, 0.32, 0.06, 0xf4f7fa, 20); k.box(0, 0.08, 0.1, 0.04, 0.2, 0.02, 0x2a2f36); k.box(0.07, 0, 0.1, 0.16, 0.04, 0.02, 0x2a2f36); }
        else if (id === 'mirror') { k.cyl(0, 0, 0.05, 0.34, 0.05, 0x8a5a35, 20); const m = new THREE.CylinderGeometry(0.28, 0.28, 0.03, 20); m.rotateX(Math.PI / 2); m.translate(0, 0, 0.08); g.add(m, col); }
        else { fx(0, 0, 0.04, w + 0.1, h + 0.1, 0.06, 0x6b4a2c); const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.picMat(id, it)); p.position.set(0, 0, 0.08); p.userData.pic = true; grp.add(p); }
        break;
      }
      case 'window': {
        for (const sx of [-0.8, 0.8]) { fx(sx, 0, 0.02, 0.6, 2.0, 0.08, col); }
        fx(0, 1.05, 0.02, 2.4, 0.06, 0.08, 0x6b4a2c);
        break;
      }
      case 'rug': { if (id === 'rugRed') fx(0, 0.02, 0, 1.7, 0.03, 8.6, col); else fx(0, 0.02, 0, 2.6, 0.03, 2.2, col); break; }
      case 'counter': {
        if (id === 'cakeStand') { k.cyl(0, 0.12, 0, 0.3, 0.05, 0xf4f7fa, 14); k.cyl(0, 0.0, 0, 0.05, 0.25, 0xf4f7fa, 8); const c = new THREE.CylinderGeometry(0.22, 0.24, 0.2, 14); c.translate(0, 0.3, 0); k.add(c, 0xff8fb1); const cr = new THREE.SphereGeometry(0.06, 8, 6); cr.translate(0, 0.45, 0); k.add(cr, 0xe8483f); }
        else if (id === 'counterPlant') { k.cyl(0, 0.1, 0, 0.13, 0.2, 0xb5653a, 10); const l = new THREE.IcosahedronGeometry(0.2, 1); l.translate(0, 0.35, 0); k.add(l, col); }
        else for (let i = 0; i < 3; i++) k.cyl(i * 0.2 - 0.2, 0.08, 0, 0.09, 0.16, col, 10);
        break;
      }
      case 'ceiling': {
        if (id === 'chandelier') { k.cyl(0, -0.4, 0, 0.02, 0.8, 0x6b5a2a, 6); const r = new THREE.TorusGeometry(0.5, 0.04, 6, 20); r.rotateX(Math.PI / 2); r.translate(0, -0.9, 0); k.add(r, col); for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283, f = new THREE.SphereGeometry(0.07, 8, 6); f.translate(Math.cos(a) * 0.5, -0.8, Math.sin(a) * 0.5); g.add(f, col); } }
        else { k.cyl(0, -0.4, 0, 0.015, 0.8, 0x2a2f36, 6); const s = new THREE.SphereGeometry(id === 'lampGlobe' ? 0.3 : 0.24, 12, 10); s.translate(0, -0.95, 0); g.add(s, col); }
        break;
      }
      default: fx(0, 0.3, 0, 0.5, 0.6, 0.5, col);
    }
    return { k, g, pics: [...grp.children] }; // merged into ONE mesh (+ one glow mesh) with every other placed item by rebuildDecor
  }

  /** (Re)build every placed decoration; only when the decoration changed. */
  rebuildDecor() {
    for (const ch of [...this.decorGroup.children]) { this.decorGroup.remove(ch); ch.geometry?.dispose?.(); }
    this.decorSlots = {};
    const allK = new Kit(), allG = new Kit(), M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), P4 = new THREE.Vector3(), S4 = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
    const D = this.cozy.decor, slots = D.slots, nTables = this.cv.visibleTables ?? 0;
    for (const [slot, p] of Object.entries(D.placed)) {
      if (!p) continue;
      const s = slots[slot], it = D.items[p.item];
      if (s.kind === 'table') { const idx = Number(slot.replace('table', '')) - 1; if (idx >= nTables) continue; }
      const m = this.decorModel(p.item, it, s);
      let y = FLOOR, ry = (p.rot * Math.PI) / 180;
      if (s.kind === 'wall') { y = FLOOR + 1.8; ry = { east: Math.PI / 2, west: -Math.PI / 2, south: 0 }[s.face] ?? 0; }
      else if (s.kind === 'window') y = FLOOR + 1.9;
      else if (s.kind === 'counter') y = FLOOR + 0.97;
      else if (s.kind === 'ceiling') y = FLOOR + 3.3;
      else if (s.kind === 'rug') y = FLOOR + 0.03;
      let x = s.x; const z = s.z;
      if (s.kind === 'wall') x += s.face === 'east' ? 0.05 : s.face === 'west' ? -0.05 : 0;
      M4.compose(P4.set(x, y, z), Q4.setFromAxisAngle(UP, ry), S4);
      for (const part of m.k.parts) { part.applyMatrix4(M4); allK.parts.push(part); }
      for (const part of m.g.parts) { part.applyMatrix4(M4); allG.parts.push(part); }
      for (const pic of m.pics) { pic.position.applyMatrix4(M4); pic.rotation.y = ry; pic.userData.slot = slot; this.decorGroup.add(pic); }
      this.decorSlots[slot] = { item: p.item, x, y, z, ry };
    }
    if (allK.parts.length) { const mesh = allK.build(this.vmat); mesh.castShadow = true; this.decorGroup.add(mesh); }
    if (allG.parts.length) { const gm = allG.build(glassMaterial()); gm.castShadow = false; this.decorGroup.add(gm); }
    // wall tint and floor colours follow the theme
    const th = D.themes[D.theme];
    if (this.cv.wallMesh) { _c.set(th.wall); this.cv.wallMesh.material.color.setRGB(_c.r / this.baseWall.r, _c.g / this.baseWall.g, _c.b / this.baseWall.b); }
    const fc = this.cv.floorTex?.image;
    if (fc?.getContext) { const [a, b] = D.floorColors(), g = fc.getContext('2d'); g.fillStyle = a; g.fillRect(0, 0, 64, 64); g.fillStyle = b; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32); this.cv.floorTex.needsUpdate = true; }
    this.decorVersion = D.version; this.tablesShown = nTables;
    // the café's own instanced tables are replaced by the decorated ones
    for (const m of [this.cv.tops, this.cv.legs, this.cv.stools]) if (m) m.visible = false;
    // warm light pools under the lamps (fade in at night)
    this.rebuildPools();
  }

  rebuildPools() {
    for (const m of this.pools || []) { this.group.remove(m); m.geometry.dispose(); m.material.map?.dispose(); nightFades.delete(m.material); m.material.dispose(); }
    this.pools = [];
    const D = this.cozy.decor;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,214,140,.9)'); gr.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    for (const [slot, p] of Object.entries(D.placed)) {
      if (!p || !['ceiling', 'floor'].includes(D.slots[slot].kind) || !/amp|antern|chandelier/i.test(p.item)) continue;
      const mt = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }); mt.userData.max = 0.55; nightFades.add(mt);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2), mt); m.position.set(D.slots[slot].x, FLOOR + 0.06, D.slots[slot].z); this.group.add(m); this.pools.push(m);
    }
  }

  // ---------- customers ----------
  makeSprite(w, h, k = 2.4) {
    const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * (h / w));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(w * k, h * k, 1); sp.userData.canvas = c; sp.userData.key = null;
    return sp;
  }

  makeFigure() {
    if (this.pool.length) return this.pool.pop();
    if (this.created >= this.maxFigures) return null;
    this.created++;
    const model = createCharacter({ shirt: 0x2f8cff, hat: 0xe8483f, skin: 0xf2c9a0 });
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const ud = model.userData;
    const shirt = [ud.torso, ud.armL?.children[0], ud.armR?.children[0]].filter(Boolean);
    const hat = model.children.filter((o) => o.isMesh && o.material?.color?.getHex() === 0xe8483f);
    const bubble = this.makeSprite(1.7, 0.7, 1.15); bubble.position.set(0, 2.9, 0); model.add(bubble);
    this.group.add(model);
    return { model, shirt, hat, head: ud.head, bubble, phase: Math.random() * 6, x: 0, z: 0, target: null, leaving: false, seat: null, cid: null };
  }

  paint(f, colors) {
    const set = (m, hex) => { if (!m.userData.own) { m.material = m.material.clone(); m.userData.own = true; } m.material.color.set(hex); };
    for (const m of f.shirt) set(m, colors.shirt);
    for (const m of f.hat) set(m, colors.hat);
    set(f.head, colors.skin);
  }

  drawBubble(f, c) {
    const frac = Math.max(0, Math.min(1, c.patience / c.maxPatience));
    const key = `${c.lines.map((l) => (l.done ? '✓' : '') + l.pid + l.requests.join('+')).join()}|${c.state}|${c.chatReady}|${Math.round(frac * 10)}`;
    if (f.bubble.userData.key === key) return;
    f.bubble.userData.key = key;
    const cv = f.bubble.userData.canvas, g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    if (c.state === 'eating') { // a little "enjoying it" heart (and a chat hint when they have a story to tell)
      g.fillStyle = '#fffaf0'; g.strokeStyle = '#ff8fb1'; g.lineWidth = 8; g.beginPath(); g.roundRect(60, 10, W - 120, H - 50, 22); g.fill(); g.stroke();
      g.font = '54px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c.chatReady ? '💬' : '💗', W / 2, (H - 50) / 2 + 10);
    } else {
      g.fillStyle = '#fffaf0'; g.strokeStyle = frac < 0.34 ? '#e8483f' : '#b8793e'; g.lineWidth = 8;
      g.beginPath(); g.roundRect(6, 6, W - 12, H - 40, 24); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(W / 2 - 14, H - 34); g.lineTo(W / 2, H - 8); g.lineTo(W / 2 + 14, H - 34); g.fill();
      g.font = '50px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(c.icon, 46, (H - 40) / 2 + 6);
      const n = c.lines.length, step = Math.min(66, (W - 110) / n), x0 = 120 + (W - 130 - step * n) / 2;
      c.lines.forEach((l, i) => { g.globalAlpha = l.done ? 0.3 : 1; g.fillText(this.cozy.productIcon(l.pid), x0 + i * step + step / 2, (H - 40) / 2 + 6); g.globalAlpha = 1; if (l.requests.length && !l.done) { g.font = '24px system-ui'; g.fillText('✨', x0 + i * step + step - 6, 24); g.font = '50px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; } });
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(22, H - 52, W - 44, 8); g.fillStyle = frac < 0.34 ? '#e8483f' : frac < 0.67 ? '#ffc43d' : '#38d996'; g.fillRect(22, H - 52, (W - 44) * frac, 8);
    }
    f.bubble.material.map.needsUpdate = true;
  }

  syncCustomers() {
    const cz = this.cozy, s = cz.session, active = cz.state === 'open' && !!s, present = new Set();
    if (active) {
      let qi = 0;
      for (const c of s.customers) {
        present.add(c.id);
        let f = this.figs.get(c.id);
        if (!f) {
          f = this.makeFigure(); if (!f) continue;
          this.paint(f, c.colors); const p = CAFE_LAYOUT.entry; f.x = p.x; f.z = p.z; f.model.visible = true; f.leaving = false; f.cid = c.id; f.seat = null; f.sat = false; f.bubble.userData.key = null; f.bubble.visible = true;
          this.figs.set(c.id, f);
        }
        if (c.state === 'waiting') { f.target = CAFE_LAYOUT.queue[Math.min(qi++, CAFE_LAYOUT.queue.length - 1)]; if (f.seat) { this.cv.releaseSeat?.(f); } }
        else { // eating: take a free seat (or wait near the door when the café is full)
          if (!f.seat && !f.tried) { f.tried = true; this.cv.assignSeat?.(f); }
          f.target = f.seat || { x: CAFE_LAYOUT.door.x + 2.4, z: CAFE_LAYOUT.door.z - 1.8 };
        }
        this.drawBubble(f, c);
      }
    }
    for (const [id, f] of this.figs) if (!present.has(id) && !f.leaving) { f.leaving = true; f.bubble.visible = false; this.cv.releaseSeat?.(f); f.target = { ...CAFE_LAYOUT.entry }; }
    // finished products on the pickup counter
    const c0 = CAFE_LAYOUT.counter;
    this.pickupSprites.forEach((sp, i) => {
      const p = active ? s.pickup[i] : null; sp.visible = !!p;
      if (!p) return;
      sp.position.set(c0.x + 1.1 - i * 0.7, FLOOR + 1.9, c0.z + 0.25);
      if (sp.userData.key !== p.id) {
        sp.userData.key = p.id;
        const cv = sp.userData.canvas, g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
        g.fillStyle = 'rgba(255,250,240,.95)'; g.beginPath(); g.arc(cv.width / 2, cv.height / 2, cv.width / 2 - 14, 0, Math.PI * 2); g.fill();
        g.strokeStyle = p.mistakes === 0 && p.q >= 0.92 ? '#ffc43d' : '#b8793e'; g.lineWidth = 10; g.stroke();
        g.font = '110px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(cz.productIcon(p.pid), cv.width / 2, cv.height / 2 + 8);
        sp.material.map.needsUpdate = true;
      }
    });
  }

  moveFigures(dt) {
    const gone = [];
    for (const [id, f] of this.figs) {
      const goal = f.target, tg = goal ? this.cv.stopFor(f, goal) : null;
      let moving = false;
      if (tg) {
        const dx = tg.x - f.x, dz = tg.z - f.z, d = Math.hypot(dx, dz);
        if (d > 0.08) { const s = Math.min(d, WALK * dt); f.x += (dx / d) * s; f.z += (dz / d) * s; f.model.rotation.y = Math.atan2(-dx, -dz); moving = true; }
        else if (tg !== goal) { f.x = tg.x; f.z = tg.z; }
        else if (f.leaving) { f.model.visible = false; f.bubble.visible = false; gone.push(id); this.pool.push(f); f.target = null; f.tried = false; continue; }
        else f.model.rotation.y = f.seat ? Math.PI : this.cv.cutaway ? Math.PI + (f.cid && (f.cid.charCodeAt(f.cid.length - 1) % 2 ? 0.55 : -0.55)) : 0; // in the front view they turn to the viewer (the barista)
      }
      f.model.position.set(f.x, FLOOR + (f.seat && !moving ? -0.32 : 0), f.z);
      animateCharacter(f.model, f.phase += moving ? dt * 7 : 0, moving ? 1 : 0, this.t);
    }
    for (const id of gone) this.figs.delete(id);
  }

  update(dt) {
    this.t += dt;
    if (!this.cozy.cfg) return;
    if (this.decorVersion !== this.cozy.decor.version || (this.tablesShown ?? -1) !== (this.cv.visibleTables ?? 0)) this.rebuildDecor();
    this.showDisplay();
    const open = this.cozy.state === 'open';
    if (open !== this.shownGuests) { this.shownGuests = open; this.cv.suppressGuests = open; }
    if (!open && !this.figs.size) return;
    this.syncCustomers();
    this.moveFigures(dt);
  }
}
