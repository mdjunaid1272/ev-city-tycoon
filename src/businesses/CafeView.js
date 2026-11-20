import * as THREE from 'three';
import { mat, rbox, mesh, textTexture } from '../world/Materials.js';
import { createBuilding, animateCharacter } from '../world/Models.js';
import { makeLabel } from './StationView.js';
import { CAFE_LAYOUT } from './Cafe.js';
import { BAY_SLOTS } from './ChargingStation.js';
import { cafeBuildingInfo } from '../ui/BuildingInfo.js';

const FLOOR = 0.34;
const MAX_FIGURES = 8;          // customer figures are pooled: never more than this many exist
const WALK = 2.3;               // m/s
const SHIRTS = [0x2f8cff, 0xe8483f, 0x3fae4a, 0xffc43d, 0x9b5cff, 0x4cc9f0];
const SKIN = [0xf2c9a0, 0xd9a273, 0x8d5a3b, 0xf7d9bd];

/**
 * Visual layer of the café: building, counter with product display, menu board, tables and stools, pooled customer figures
 * that queue at the counter and sit down with their order, and a status label above the counter.
 * Light on purpose: a few dozen meshes that share materials and geometries, one canvas texture for the menu, a pool of 8 figures.
 */
export class CafeView {
  constructor({ scene, assets, colliders, nav, bus, cafe, employees = null }) {
    Object.assign(this, { scene, assets, colliders, nav, bus, cafe, employees });
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.selectables = [];
    this.tables = []; // { group, x, z, collider, seats: [{x,z,taken}] }
    this.figures = new Map(); // customer id -> figure
    this.pool = [];
    this.t = 0;
    this.dirty = true;
    this.built = false;
    this.labelTimer = 0;
    this.offs = [
      bus.on('cafe:changed', () => { this.dirty = true; }),
      bus.on('hub:built', ({ key }) => { if (key === 'coffee') this.dirty = true; }),
    ];
    this.buildStructure();
    this.apply();
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
    this.scene.remove(this.root);
  }

  // ---------- static structure ----------
  buildStructure() {
    const r = this.root, L = CAFE_LAYOUT;
    const b = L.building;
    this.building = createBuilding(b.w, 3.8, b.d, 0xb8793e, { roofColor: 0xf4f7fa, awning: 0xffc43d, sign: { text: 'CAFE', bg: '#5a3a22', fg: '#ffffff' } });
    this.building.position.set(b.x, FLOOR, b.z);
    this.building.userData.select = () => cafeBuildingInfo(this);
    this.building.userData.focus = new THREE.Vector3(b.x, 0, b.z);
    r.add(this.building);
    this.selectables.push(this.building);

    // counter with a lighter top, the espresso machine and the product display
    const c = L.counter;
    const counter = new THREE.Group();
    counter.add(mesh(rbox(c.w, 1.0, 0.9, 0.08, 1), mat(0x7a4a28), { y: 0.5 }), mesh(rbox(c.w + 0.2, 0.1, 1.05, 0.04, 1), mat(0xf1e2c8), { y: 1.05 }));
    const machine = new THREE.Group();
    machine.add(mesh(rbox(0.9, 0.55, 0.5, 0.06, 1), mat(0xc9ced6, { metal: 0.5, rough: 0.35 }), { y: 1.4 }), mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.25, 8), mat(0x2a2f36), { x: -0.25, y: 1.0 + 0.2, z: 0.28 }));
    machine.position.set(-1.7, 0, 0);
    counter.add(machine);
    this.display = {}; // one small model per product: visible only while it is on the menu
    const kinds = { espresso: [0x3a2415, 'cup'], croissant: [0xd9a14a, 'pastry'], latte: [0xf2e6d2, 'cup'], sandwich: [0xe0b96a, 'pastry'], iced: [0x9fd8ff, 'cup'] };
    Object.keys(this.cafe.cfg.products).forEach((pid, i) => {
      const [color, shape] = kinds[pid] || [0xffffff, 'cup'];
      const g = shape === 'cup' ? new THREE.CylinderGeometry(0.16, 0.12, 0.28, 10) : new THREE.CapsuleGeometry(0.12, 0.3, 3, 8);
      const m = mesh(g, mat(color), { x: -0.2 + i * 0.55, y: 1.3, z: 0.12 });
      if (shape !== 'cup') m.rotation.z = Math.PI / 2;
      counter.add(m);
      this.display[pid] = m;
    });
    counter.position.set(c.x, FLOOR, c.z);
    r.add(counter);
    this.counterRect = { x: c.x, z: c.z, w: c.w + 0.3, d: 1.1 };

    // menu board on the wall (one canvas texture, redrawn when prices / the menu change)
    this.menuCanvas = document.createElement('canvas');
    this.menuCanvas.width = 256; this.menuCanvas.height = 256;
    this.menuTex = new THREE.CanvasTexture(this.menuCanvas);
    this.menuTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: this.menuTex }));
    board.position.set(b.x - 2.2, 2.0, b.z + b.d / 2 + 0.04);
    r.add(board);

    // tables with two stools each; more appear with the seating upgrade
    const tableMat = mat(0xf1e2c8), legMat = mat(0x7a4a28), stoolMat = mat(0x2f8cff);
    const topGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.08, 14), legGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.7, 8), stoolGeo = new THREE.CylinderGeometry(0.26, 0.22, 0.45, 10);
    L.tables.forEach((t, i) => {
      const g = new THREE.Group();
      g.add(mesh(topGeo, tableMat, { y: 0.76 }), mesh(legGeo, legMat, { y: 0.38 }));
      const seats = [];
      for (const sx of [-0.85, 0.85]) { g.add(mesh(stoolGeo, stoolMat, { x: sx, y: 0.22 })); seats.push({ x: t.x + sx, z: t.z + 0.1, taken: null }); }
      g.position.set(t.x, FLOOR, t.z);
      g.visible = false;
      r.add(g);
      this.tables.push({ group: g, x: t.x, z: t.z, seats, collider: null, i });
    });

    // status label above the counter
    this.label = makeLabel(3.4);
    this.label.sprite.position.set(c.x, 3.7, c.z + 0.5);
    this.label.sprite.visible = false;
    r.add(this.label.sprite);
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
    const want = Math.min(this.tables.length, Math.ceil(this.cafe.seats / 2));
    this.tables.forEach((t, i) => {
      t.group.visible = i < want;
      if (i < want && !t.collider) { t.collider = this.colliders.add(t.x, t.z, 2.4, 1.3, 1); this.nav?.rebuild(this.colliders); }
    });
    for (const [pid, m] of Object.entries(this.display)) m.visible = !!this.cafe.products().find((p) => p.id === pid)?.available;
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
  makeFigure() {
    if (this.pool.length) return this.pool.pop();
    if (this.figures.size + this.pool.length >= MAX_FIGURES) return null;
    const i = this.figures.size + this.pool.length;
    const model = this.assets.create('character', { shirt: SHIRTS[i % SHIRTS.length], hat: SHIRTS[(i + 2) % SHIRTS.length], pants: 0x2b3a55, skin: SKIN[i % SKIN.length] });
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.root.add(model);
    return { model, phase: Math.random() * 6, x: 0, z: 0, target: null, leaving: false, seat: null };
  }

  startPoint(c) {
    if (c.kind === 'charging' && c.ref?.bayId != null) return { x: BAY_SLOTS[c.ref.bayId] + (BAY_SLOTS[c.ref.bayId] < 0 ? 2.4 : -2.4), z: 2.4 };
    return { ...CAFE_LAYOUT.entry };
  }

  assignSeat(f) {
    for (const t of this.tables) {
      if (!t.group.visible) continue;
      const s = t.seats.find((q) => !q.taken);
      if (s) { s.taken = f; f.seat = s; return s; }
    }
    return null;
  }

  releaseSeat(f) { if (f.seat) { f.seat.taken = null; f.seat = null; } }

  syncFigures() {
    const customers = [...this.cafe.customers.values()];
    // new customers get a figure (up to the pool size: the simulation never depends on the figures)
    for (const c of customers) {
      if (this.figures.has(c.id)) continue;
      const f = this.makeFigure();
      if (!f) break;
      const p = this.startPoint(c);
      f.x = p.x; f.z = p.z; f.leaving = false; f.customer = c; f.model.visible = true;
      this.figures.set(c.id, f);
    }
    // queue order = order of the orders
    const waiting = this.cafe.orders.map((o) => o.customer.id);
    for (const [id, f] of this.figures) {
      const c = this.cafe.customers.get(id);
      if (!c) { // customer is gone: walk out, then return the figure to the pool
        if (!f.leaving) { f.leaving = true; this.releaseSeat(f); f.target = f.customer?.kind === 'charging' ? this.startPoint(f.customer) : { ...CAFE_LAYOUT.entry }; }
        continue;
      }
      if (c.state === 'eating') {
        if (!f.seat && !f.sitTried) { f.sitTried = true; this.assignSeat(f); }
        f.target = f.seat ? { x: f.seat.x, z: f.seat.z } : { x: CAFE_LAYOUT.queue[0].x + 6, z: CAFE_LAYOUT.queue[0].z - 1 };
      } else {
        const i = waiting.indexOf(id);
        f.target = CAFE_LAYOUT.queue[Math.max(0, Math.min(i < 0 ? 0 : i, CAFE_LAYOUT.queue.length - 1))];
      }
    }
  }

  moveFigures(dt) {
    for (const [id, f] of [...this.figures]) {
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
          f.model.visible = false; this.figures.delete(id); this.pool.push(f); f.sitTried = false; f.target = null; continue;
        } else {
          f.model.rotation.y = f.seat ? Math.PI : 0; // standing in the queue: face the counter (north = -z); seated: face the table
        }
      }
      f.model.position.set(f.x, FLOOR + (f.seat ? -0.3 : 0), f.z);
      if (moving) { f.phase += dt * 7; animateCharacter(f.model, f.phase, 1, this.t); } else animateCharacter(f.model, 0, 0, this.t);
    }
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
    this.syncFigures();
    this.moveFigures(dt);
    this.labelTimer -= dt;
    if (this.labelTimer <= 0) { this.labelTimer = 0.25; this.updateLabel(); }
  }
}
