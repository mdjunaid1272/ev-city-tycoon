import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat, rbox, mesh } from '../world/Materials.js';
import { createBuilding } from '../world/Models.js';
import { makeLabel } from './StationView.js';
import { CAFE_LAYOUT } from './Cafe.js';
import { BAY_SLOTS } from './ChargingStation.js';
import { cafeBuildingInfo } from '../ui/BuildingInfo.js';

const FLOOR = 0.34;
const WALK = 2.3; // m/s
const SHIRTS = [0x2f8cff, 0xe8483f, 0x3fae4a, 0xffc43d, 0x9b5cff, 0x4cc9f0];
const SKIN = [0xf2c9a0, 0xd9a273, 0x8d5a3b, 0xf7d9bd];
const FIGURES_BY_QUALITY = { low: 3, medium: 5, high: 8 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _z = new THREE.Vector3(0, 0, 1);

/**
 * Visual layer of the café, built to be cheap on phones:
 *  - the counter, the machine and the product display are ONE merged mesh (vertex colours) = one draw call
 *  - tables and stools are three InstancedMeshes (tops, legs, stools) whatever the number of tables
 *  - customers are a small pool of light figures (2 meshes each, 3 / 5 / 8 by quality preset) that is created lazily and reused
 *  - one canvas texture for the menu board and one sprite for the order status
 * Nothing is allocated per frame.
 */
export class CafeView {
  constructor({ scene, assets, colliders, nav, bus, cafe, employees = null, settings = null }) {
    Object.assign(this, { scene, assets, colliders, nav, bus, cafe, employees, settings });
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.selectables = [];
    this.tableSlots = []; // { x, z, seats: [{x, z, taken}] }
    this.visibleTables = 0;
    this.figures = new Map(); // customer id -> figure
    this.pool = [];
    this.created = 0;
    this.t = 0;
    this.dirty = true;
    this.built = false;
    this.labelTimer = 0;
    this.syncTimer = 0;
    this.gone = []; // scratch list reused every frame: figures that finished walking out
    this.waiting = []; // scratch list: customer ids in queue order
    this.counterKey = '';
    this.offs = [
      bus.on('cafe:changed', () => { this.dirty = true; }),
      bus.on('hub:built', ({ key }) => { if (key === 'coffee') this.dirty = true; }),
    ];
    this.buildStructure();
    this.apply();
  }

  get maxFigures() { return FIGURES_BY_QUALITY[this.settings?.data?.quality] ?? 5; }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
    this.scene.remove(this.root);
    this.menuTex?.dispose();
    this.counterMesh?.geometry.dispose();
    this.bodyGeo?.dispose();
    this.headGeo?.dispose();
    this.label?.sprite.material.map?.dispose();
    this.label?.sprite.material.dispose();
  }

  // ---------- static structure ----------
  buildStructure() {
    const r = this.root, L = CAFE_LAYOUT, b = L.building;
    this.building = createBuilding(b.w, 3.8, b.d, 0xb8793e, { roofColor: 0xf4f7fa, awning: 0xffc43d, sign: { text: 'CAFE', bg: '#5a3a22', fg: '#ffffff' }, style: 'cafe', seed: 3 });
    this.building.position.set(b.x, FLOOR, b.z);
    this.building.userData.select = () => cafeBuildingInfo(this);
    this.building.userData.focus = new THREE.Vector3(b.x, 0, b.z);
    r.add(this.building);
    this.selectables.push(this.building);
    this.counterRect = { x: L.counter.x, z: L.counter.z, w: L.counter.w + 0.3, d: 1.1 };

    // counter: one mesh, rebuilt only when the menu changes (see rebuildCounter)
    this.counterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });
    this.counterMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.counterMat);
    this.counterMesh.castShadow = true;
    this.counterMesh.position.set(L.counter.x, FLOOR, L.counter.z);
    r.add(this.counterMesh);

    // menu board on the wall (one canvas texture, redrawn when prices / the menu change)
    this.menuCanvas = document.createElement('canvas');
    this.menuCanvas.width = 256; this.menuCanvas.height = 256;
    this.menuTex = new THREE.CanvasTexture(this.menuCanvas);
    this.menuTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: this.menuTex }));
    board.position.set(b.x - 2.2, 2.0, b.z + b.d / 2 + 0.04);
    r.add(board);

    // tables and stools: three instanced meshes for all of them (count = how many are unlocked)
    const n = L.tables.length;
    this.tops = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 14), mat(0xf1e2c8), n);
    this.legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 0.7, 8), mat(0x7a4a28), n);
    this.stools = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.22, 0.45, 10), mat(0x2f8cff), n * 2);
    L.tables.forEach((t, i) => {
      const seats = [];
      this.place(this.tops, i, t.x, FLOOR + 0.76, t.z);
      this.place(this.legs, i, t.x, FLOOR + 0.38, t.z);
      [-0.85, 0.85].forEach((sx, k) => { this.place(this.stools, i * 2 + k, t.x + sx, FLOOR + 0.22, t.z); seats.push({ x: t.x + sx, z: t.z + 0.1, taken: null }); });
      this.tableSlots.push({ x: t.x, z: t.z, seats, collider: null });
    });
    for (const m of [this.tops, this.legs, this.stools]) { m.count = 0; m.castShadow = true; m.frustumCulled = false; r.add(m); }

    // status label above the counter
    this.label = makeLabel(3.4);
    this.label.sprite.position.set(L.counter.x, 3.7, L.counter.z + 0.5);
    this.label.sprite.visible = false;
    r.add(this.label.sprite);
  }

  place(inst, i, x, y, z) {
    _p.set(x, y, z);
    inst.setMatrixAt(i, _m.compose(_p, _q.identity(), _s));
    inst.instanceMatrix.needsUpdate = true;
  }

  /** Counter + machine + the products that are on the menu, merged into one vertex-coloured mesh. */
  rebuildCounter() {
    const c = CAFE_LAYOUT.counter, products = this.cafe.products();
    const key = products.map((p) => (p.available ? 1 : 0)).join('');
    if (key === this.counterKey) return;
    this.counterKey = key;
    const parts = [
      { geo: rbox(c.w, 1.0, 0.9, 0.08, 1), color: 0x7a4a28, at: [0, 0.5, 0] },
      { geo: rbox(c.w + 0.2, 0.1, 1.05, 0.04, 1), color: 0xf1e2c8, at: [0, 1.05, 0] },
      { geo: rbox(0.9, 0.55, 0.5, 0.06, 1), color: 0xc9ced6, at: [-1.7, 1.4, 0] },
      { geo: new THREE.CylinderGeometry(0.1, 0.1, 0.25, 8), color: 0x2a2f36, at: [-1.95, 1.2, 0.28], own: true },
    ];
    const kinds = { espresso: [0x3a2415, 'cup'], croissant: [0xd9a14a, 'pastry'], latte: [0xf2e6d2, 'cup'], sandwich: [0xe0b96a, 'pastry'], iced: [0x9fd8ff, 'cup'] };
    products.forEach((p, i) => {
      if (!p.available) return;
      const [color, shape] = kinds[p.id] || [0xffffff, 'cup'];
      const geo = shape === 'cup' ? new THREE.CylinderGeometry(0.16, 0.12, 0.28, 10) : new THREE.CapsuleGeometry(0.12, 0.3, 3, 8);
      parts.push({ geo, color, at: [-0.2 + i * 0.55, 1.3, 0.12], rotZ: shape === 'cup' ? 0 : Math.PI / 2, own: true });
    });
    const pieces = parts.map(({ geo, color, at, rotZ = 0, own }) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.deleteAttribute('uv'); // only position / normal / colour so the pieces can be merged
      _p.set(at[0], at[1], at[2]); _q.setFromAxisAngle(_z, rotZ);
      g.applyMatrix4(_m.compose(_p, _q, _s));
      const col = new THREE.Color(color), arr = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < arr.length; k += 3) { arr[k] = col.r; arr[k + 1] = col.g; arr[k + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      if (own) geo.dispose(); // the one-off shapes are not cached anywhere
      return g;
    });
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    this.counterMesh.geometry.dispose();
    this.counterMesh.geometry = merged;
  }

  // ---------- state sync ----------
  /** Show / hide the café and add its colliders once it exists (the staff walking grid is rebuilt so nobody walks through it). */
  apply() {
    const built = this.cafe.built;
    if (built !== this.built) {
      this.built = built;
      this.root.visible = built;
      if (built && !this.colliderBoxes) {
        const b = CAFE_LAYOUT.building, cr = this.counterRect;
        this.colliderBoxes = [this.colliders.add(b.x, b.z, b.w + 0.3, b.d + 0.3, 5), this.colliders.add(cr.x, cr.z, cr.w, cr.d, 1.3)];
        this.nav?.rebuild(this.colliders);
      }
    }
    if (!built) return;
    // tables follow the seating level (2 seats per table)
    const want = Math.min(this.tableSlots.length, Math.ceil(this.cafe.seats / 2));
    this.visibleTables = want;
    this.tops.count = this.legs.count = want; this.stools.count = want * 2;
    let added = false;
    this.tableSlots.forEach((t, i) => { if (i < want && !t.collider) { t.collider = this.colliders.add(t.x, t.z, 2.4, 1.3, 1); added = true; } });
    if (added) this.nav?.rebuild(this.colliders);
    this.rebuildCounter();
    this.drawMenu();
    this.dirty = false;
  }

  drawMenu() {
    const g = this.menuCanvas.getContext('2d'), W = 256;
    g.fillStyle = '#2a2018'; g.fillRect(0, 0, W, W);
    g.strokeStyle = '#d9a14a'; g.lineWidth = 8; g.strokeRect(6, 6, W - 12, W - 12);
    g.fillStyle = '#ffd98a'; g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('MENU', W / 2, 44);
    g.font = 'bold 22px system-ui, sans-serif';
    let y = 80;
    for (const p of this.cafe.products()) {
      if (!p.unlocked) continue;
      g.fillStyle = p.available ? '#ffffff' : '#7a6f62';
      g.textAlign = 'left'; g.fillText(p.label, 22, y);
      g.textAlign = 'right'; g.fillText(p.available ? `$${p.price.toFixed(2)}` : 'off', W - 22, y);
      y += 32;
    }
    this.menuTex.needsUpdate = true;
  }

  // ---------- customers ----------
  /** A café guest: a capsule body and a head (2 draw calls, shared geometry and materials), bobbing when it walks. */
  makeFigure() {
    if (this.pool.length) return this.pool.pop();
    if (this.created >= this.maxFigures) return null; // the simulation never depends on how many figures are shown
    const i = this.created++;
    this.bodyGeo ||= new THREE.CapsuleGeometry(0.28, 1.0, 3, 8);
    this.headGeo ||= new THREE.SphereGeometry(0.26, 10, 8);
    const model = new THREE.Group();
    const body = mesh(this.bodyGeo, mat(SHIRTS[i % SHIRTS.length]), { y: 0.8 });
    const head = mesh(this.headGeo, mat(SKIN[i % SKIN.length]), { y: 1.78 });
    model.add(body, head);
    model.userData.body = body;
    this.root.add(model);
    return { model, phase: Math.random() * 6, x: 0, z: 0, target: null, leaving: false, seat: null };
  }

  /** Walking bob and a little sway; standing still breathes slowly. */
  animateGuest(f, moving, dt) {
    const b = f.model.userData.body;
    if (moving) { f.phase += dt * 7; b.position.y = 0.8 + Math.abs(Math.sin(f.phase)) * 0.07; b.rotation.z = Math.sin(f.phase * 0.5) * 0.08; }
    else { b.position.y = 0.8 + Math.sin(this.t * 2 + f.phase) * 0.012; b.rotation.z = 0; }
    f.model.children[1].position.y = b.position.y + 0.98;
  }

  startPoint(c) {
    if (c.kind === 'charging' && c.ref?.bayId != null) return { x: BAY_SLOTS[c.ref.bayId] + (BAY_SLOTS[c.ref.bayId] < 0 ? 2.4 : -2.4), z: 2.4 };
    return { ...CAFE_LAYOUT.entry };
  }

  assignSeat(f) {
    for (let i = 0; i < this.visibleTables; i++) {
      const s = this.tableSlots[i].seats.find((q) => !q.taken);
      if (s) { s.taken = f; f.seat = s; return s; }
    }
    return null;
  }

  releaseSeat(f) { if (f.seat) { f.seat.taken = null; f.seat = null; } }

  syncFigures() {
    // new customers get a figure
    for (const c of this.cafe.customers.values()) {
      if (this.figures.has(c.id)) continue;
      const f = this.makeFigure();
      if (!f) break;
      const p = this.startPoint(c);
      f.x = p.x; f.z = p.z; f.leaving = false; f.customer = c; f.model.visible = true;
      this.figures.set(c.id, f);
    }
    const waiting = this.waiting;
    waiting.length = 0;
    for (const o of this.cafe.orders) waiting.push(o.customer.id);
    for (const [id, f] of this.figures) {
      const c = this.cafe.customers.get(id);
      if (!c) { // customer is gone: walk out, then return the figure to the pool
        if (!f.leaving) { f.leaving = true; this.releaseSeat(f); f.target = f.customer?.kind === 'charging' ? this.startPoint(f.customer) : { ...CAFE_LAYOUT.entry }; }
        continue;
      }
      if (c.state === 'eating') {
        if (!f.seat && !f.sitTried) { f.sitTried = true; this.assignSeat(f); }
        f.target = f.seat ? f.seat : { x: CAFE_LAYOUT.queue[0].x + 6, z: CAFE_LAYOUT.queue[0].z - 1 };
      } else {
        const i = waiting.indexOf(id);
        f.target = CAFE_LAYOUT.queue[Math.max(0, Math.min(i < 0 ? 0 : i, CAFE_LAYOUT.queue.length - 1))];
      }
    }
  }

  moveFigures(dt) {
    const gone = this.gone;
    gone.length = 0;
    for (const [id, f] of this.figures) {
      const tg = f.target;
      let moving = false;
      if (tg) {
        const dx = tg.x - f.x, dz = tg.z - f.z, d = Math.hypot(dx, dz);
        if (d > 0.08) {
          const s = Math.min(d, WALK * dt);
          f.x += (dx / d) * s; f.z += (dz / d) * s;
          f.model.rotation.y = Math.atan2(-dx, -dz);
          moving = true;
        } else if (f.leaving) { // arrived at the exit: back to the pool
          f.model.visible = false; gone.push(id); this.pool.push(f); f.sitTried = false; f.target = null; continue;
        } else {
          f.model.rotation.y = f.seat ? Math.PI : 0; // standing in the queue: face the counter (north = -z); seated: face the table
        }
      }
      f.model.position.set(f.x, FLOOR + (f.seat ? -0.3 : 0), f.z);
      this.animateGuest(f, moving, dt);
    }
    for (const id of gone) this.figures.delete(id);
  }

  updateLabel() {
    const c = this.cafe, n = c.orders.length;
    this.label.sprite.visible = c.built && n > 0;
    if (!n) return;
    const o = c.orders.find((x) => x.state === 'preparing') || c.orders[0];
    const p = c.cfg.products[o.pid];
    this.label.draw({ title: `${n} order${n > 1 ? 's' : ''}`, sub: `${p.icon} ${p.label}${o.state === 'preparing' ? '' : ' · waiting'}`, pct: o.state === 'preparing' ? o.progress : 0, color: '#b8793e' });
  }

  update(dt) {
    this.t += dt;
    if (this.dirty || this.cafe.built !== this.built) this.apply();
    if (!this.built) return;
    this.syncTimer -= dt;
    if (this.syncTimer <= 0) { this.syncTimer = 0.2; this.syncFigures(); } // who goes where: 5x a second; walking is smooth every frame
    this.moveFigures(dt);
    this.labelTimer -= dt;
    if (this.labelTimer <= 0) { this.labelTimer = 0.25; this.updateLabel(); }
  }
}
