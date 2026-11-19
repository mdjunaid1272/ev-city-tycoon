import * as THREE from 'three';
import { mat, rbox, mesh, textTexture } from '../world/Materials.js';
import { createBuilding, setCarDirt } from '../world/Models.js';
import { PathFollower } from '../vehicles/PathFollower.js';
import { NavGrid } from '../employees/NavGrid.js';
import { makeLabel } from './StationView.js';
import { Emitter } from '../world/Particles.js';
let avoidSeq = 0; // arrival order of lot cars (priority when paths cross)

const FLOOR = 0.34;
const CAR_Y = 0.34;
export const BAY_X = [-16, -8, 0]; // local x of the three bays (cars face north at z = BAY_Z)
export const BAY_Z = -6;
export const QUEUE_LOCAL = [{ x: -12, z: 17 }, { x: -4, z: 17 }]; // z = 17 (row of the through-traffic is z = 21.5): queued cars never touch passing ones
const ENTRY_X = 8, EXIT_X = 17, LANE_Z = 27, HANDOFF_X = 9, MERGE_X = 13;

/**
 * Generic drive-through service lot (used by the car wash and the garage).
 * Local frame (origin = block centre): road lane at z=27 (south), entrance column x=8, bays in a row at
 * z=-6 facing north, exit loop along z=-13.6 then south down x=17 and back onto the lane.
 * Subclasses add the machinery (buildBay / updateBay / bayInfo / bayLabel) and the building.
 */
export class ServiceLotView {
  constructor({ id, scene, assets, colliders, bus, business, traffic, road, parking, employees, origin, edge, economy, accent = 0x1f8a4c, onBuilt = null, rot = 0, spawnEdge = null }) {
    Object.assign(this, { id, scene, assets, colliders, bus, biz: business, traffic, road, parking, employees, origin, edge, economy, accent, onBuilt, rot, spawnEdge });
    this.cs = Math.cos(rot);
    this.sn = Math.sin(rot);
    this.root = new THREE.Group();
    scene.add(this.root);
    this.built = false;
    this.mgmt = false;
    this.mgFactor = 1;
    this.t = 0;
    this.labelTimer = 0;
    this.selectables = [];
    this.interactables = [];
    this.bayVis = [];
    this.movers = [];
    this.cars = new Map(); // bayId -> rec
    this.custRecs = new Map();
    this.emitters = [];
    this.terminalLocal = { x: -20, z: -12 };
    bus.on('svc:spawn', (e) => e.biz === id && this.onCustomerSpawn(e));
    bus.on('svc:assigned', (e) => e.biz === id && this.onAssigned(e));
    bus.on('svc:left', (e) => e.biz === id && this.onLeft(e));
    bus.on('svc:depart', (e) => e.biz === id && this.onDepart(e));
    bus.on('svc:built', (e) => e.biz === id && this.build());
    bus.on('svc:changed', (e) => { if (e.biz === id) this.refreshStructure(); });
    bus.on('svc:washed', (e) => { if (e.biz === id) { const r = this.custRecs.get(e.customer.id); if (r) setCarDirt(r.obj, e.customer.vehicle.dirt); } });
  }

  /** Call after construction (subclass fields must exist before the lot is built). */
  init() {
    if (this.biz.built) this.build();
    return this;
  }

  /** local -> world (the lot may be rotated by a multiple of 90 degrees so it can face any road) */
  W(x, z) {
    return { x: this.origin.x + x * this.cs + z * this.sn, z: this.origin.z - x * this.sn + z * this.cs };
  }
  /** world -> local */
  Lc(wx, wz) {
    const dx = wx - this.origin.x, dz = wz - this.origin.z;
    return { x: dx * this.cs - dz * this.sn, z: dx * this.sn + dz * this.cs };
  }
  P(list) {
    return list.map(([x, z]) => { const w = this.W(x, z); return new THREE.Vector3(w.x, CAR_Y, w.z); });
  }
  /** Static collider given in local coordinates (width/depth swap for quarter turns). */
  addCollider(lx, lz, w, d, h) {
    const c = this.W(lx, lz);
    const swap = Math.abs(this.sn) > 0.5;
    return this.colliders.add(c.x, c.z, swap ? d : w, swap ? w : d, h);
  }
  /** Distance along the lane edge at which a local point (on the lane) is passed. */
  sOfLocal(lx) {
    const p = this.W(lx, LANE_Z), a = this.edge.pts[0], b = this.edge.pts[this.edge.pts.length - 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / L;
  }
  get spawnZ() {
    return this.W(0, LANE_Z).z; // lane height for lots facing south (spawnEdge overrides it for the others)
  }
  get handoffS() {
    return this.sOfLocal(HANDOFF_X);
  }
  get mergeS() {
    return this.sOfLocal(MERGE_X);
  }

  // ---------- construction ----------
  build() {
    if (this.built) return;
    this.built = true;
    const O = this.origin, r = this.root;
    r.position.set(O.x, 0, O.z);
    r.rotation.y = this.rot;
    this.stage = new THREE.Group(); // everything in local coordinates
    r.add(this.stage);
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(42, 42), new THREE.MeshStandardMaterial({ map: this.lotTexture(), roughness: 0.95 }));
    lot.rotation.x = -Math.PI / 2; lot.position.set(0, FLOOR, 0); lot.receiveShadow = true;
    this.stage.add(lot);
    this.buildBuilding();
    this.buildTerminal();
    BAY_X.forEach((bx, i) => {
      const g = new THREE.Group();
      g.position.set(bx, FLOOR, BAY_Z);
      this.stage.add(g);
      const label = makeLabel(3.2);
      label.sprite.position.set(0, 5.2, 0);
      g.add(label.sprite);
      const ghost = new THREE.Group();
      ghost.add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 6.8), new THREE.MeshBasicMaterial({ color: 0x39ffb0, transparent: true, opacity: 0.22, depthWrite: false })));
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const p2 = p1.clone(); p2.rotation.y = Math.PI / 2;
      ghost.add(p1, p2);
      ghost.position.set(0, 0.12, 0);
      ghost.userData.select = () => this.bayInfo(i);
      ghost.userData.focus = new THREE.Vector3(this.W(bx, BAY_Z).x, 0, this.W(bx, BAY_Z).z);
      g.add(ghost);
      const vis = { group: g, label, ghost, machine: this.buildBay(i, g), t: 0 };
      this.bayVis.push(vis);
      this.selectables.push(ghost);
      // clickable bay area
      const hit = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 6.8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(0, 0.3, 0);
      hit.userData.select = () => this.bayInfo(i);
      hit.userData.focus = new THREE.Vector3(this.W(bx, BAY_Z).x, 0, this.W(bx, BAY_Z).z);
      g.add(hit);
      this.selectables.push(hit);
    });
    this.queueLabels = QUEUE_LOCAL.map((s) => {
      const l = makeLabel(2.8);
      l.sprite.position.set(s.x, 4.2, s.z);
      l.sprite.visible = false;
      this.stage.add(l.sprite);
      return l;
    });
    for (const e of this.emitters) this.scene.add(e.points); // emitters work in world space
    r.updateMatrixWorld(true);
    // walkable grid + employee registration
    this.nav = new NavGrid({ minX: O.x - 23, maxX: O.x + 23, minZ: O.z - 23, maxZ: O.z + 23 });
    this.nav.rebuild(this.colliders);
    const posts = this.postsLocal().map((p) => this.W(p.x, p.z));
    const door = this.W(this.doorLocal().x, this.doorLocal().z);
    const br = this.W(this.breakLocal().x, this.breakLocal().z);
    this.employees.registerFacility(this.biz.cfg.dept, { nav: this.nav, posts, door, breakSpot: br, built: () => this.biz.built, label: this.biz.cfg.label });
    this.biz.layout = {
      stand: (i) => this.W(BAY_X[i] + 3.9, BAY_Z + 0.6),
      face: (i) => this.W(BAY_X[i], BAY_Z),
    };
    this.refreshStructure();
    this.onBuilt?.(this);
  }

  /** Wash/garage override: building at the north side of the lot. */
  buildBuilding() {}
  buildBay() { return null; }
  postsLocal() { return [{ x: -10, z: -15.2 }, { x: -7, z: -15.2 }, { x: -4, z: -15.2 }]; }
  doorLocal() { return { x: -12, z: -17.6 }; }
  breakLocal() { return { x: -17, z: -15.5 }; }
  bayInfo() { return { title: 'Bay', rows: [], actions: [] }; }
  bayLabel() { return null; }
  updateBay() {}

  lotTexture() {
    const S = 24, W = 42, c = document.createElement('canvas');
    c.width = c.height = W * S;
    const g = c.getContext('2d');
    const px = (x) => (x + 21) * S, pz = (z) => (z + 21) * S;
    g.fillStyle = '#6b7484'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#f4f7fa'; g.lineWidth = 4;
    for (const bx of BAY_X) g.strokeRect(px(bx - 1.8), pz(BAY_Z - 3.4), 3.6 * S, 6.8 * S);
    g.strokeStyle = '#ffe34d';
    for (const s of QUEUE_LOCAL) g.strokeRect(px(s.x - 1.8), pz(s.z - 2.6), 3.6 * S, 5.2 * S);
    g.fillStyle = '#ffe34d'; g.font = `bold ${1.0 * S}px system-ui`; g.textAlign = 'center';
    g.fillText('WAITING', px(-8), pz(22.6));
    g.strokeStyle = '#f2d64b'; g.lineWidth = 4; g.setLineDash([18, 18]);
    g.beginPath(); g.moveTo(px(ENTRY_X), pz(21)); g.lineTo(px(ENTRY_X), pz(13)); g.stroke();
    g.beginPath(); g.moveTo(px(EXIT_X), pz(-13)); g.lineTo(px(EXIT_X), pz(20)); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#e8eef5'; g.font = `bold ${0.9 * S}px system-ui`;
    g.fillText('IN', px(ENTRY_X), pz(19)); g.fillText('OUT', px(EXIT_X), pz(16));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  buildTerminal() {
    const t = new THREE.Group();
    t.add(mesh(rbox(1.2, 0.15, 1.2, 0.05, 1), mat(0x9aa3ad), { y: 0.08 }));
    t.add(mesh(rbox(0.9, 1.4, 0.6, 0.15, 2), mat(this.accent), { y: 0.85 }));
    t.add(mesh(rbox(0.7, 0.5, 0.05, 0.02, 1), mat(0x0b2a40, { emissive: 0x39d0ff, ei: 0.9 }), { y: 1.15, z: 0.32, cast: false }));
    t.position.set(this.terminalLocal.x, FLOOR, this.terminalLocal.z);
    t.rotation.y = 0;
    t.userData.select = () => ({
      title: `${this.biz.cfg.icon} ${this.biz.cfg.label}`, subtitle: 'Business control point',
      rows: [['Bays', `${this.biz.unlockedBays}/${this.biz.bays.length}`], ['Queue', `${this.biz.queue.length}/${this.biz.maxQueue}`]],
      actions: [
        { label: 'Manage', cb: () => this.bus.emit('ui:open', this.id) },
        { label: 'Staff', kind: 'secondary', cb: () => this.bus.emit('ui:open', 'staff') },
        { label: 'Upgrade', kind: 'secondary', cb: () => this.bus.emit('ui:open', 'upgrades') },
      ],
    });
    const tw = this.W(this.terminalLocal.x, this.terminalLocal.z);
    t.userData.focus = new THREE.Vector3(tw.x, 0, tw.z);
    this.stage.add(t);
    this.selectables.push(t);
    this.addCollider(this.terminalLocal.x, this.terminalLocal.z, 1.2, 1.2, 2);
    const pos = new THREE.Vector3(tw.x, 0, tw.z);
    this.interactables.push({ id: `${this.id}-terminal`, pos, radius: 3.4, getPrompt: () => ({ text: `Open ${this.biz.cfg.label} manager` }), run: () => this.bus.emit('ui:open', this.id) });
  }

  /** Shown/hidden bays, ghost slots for unbuilt bays. */
  refreshStructure() {
    if (!this.built) return;
    this.biz.bays.forEach((b, i) => {
      const v = this.bayVis[i];
      v.machine?.setUnlocked?.(b.unlocked);
      v.machine && (v.machine.group.visible = b.unlocked);
      v.ghost.visible = !b.unlocked && this.mgmt;
      this.refreshBayMode?.(i, b);
    });
  }
  setManagementMode(on) {
    this.mgmt = on;
    this.refreshStructure();
  }

  // ---------- vehicles ----------
  adopt(rec, x, z, yaw, speed = 6) {
    const o = rec.obj;
    this.scene.add(o);
    o.position.set(x, CAR_Y, z);
    o.rotation.y = yaw;
    rec.f = new PathFollower(o, { maxSpeed: 7, accel: 5, turnRate: 2.6 });
    rec.f.speed = speed;
    if (!this.movers.includes(rec)) this.movers.push(rec);
  }

  onCustomerSpawn({ customer: c }) {
    if (!this.built) return;
    const v = c.vehicle;
    const obj = this.traffic.acquire(v.type, v.color);
    obj.visible = false;
    setCarDirt(obj, v.dirt);
    const rec = { obj, customer: c, state: 'driving', f: null, bayId: null, slot: null };
    this.custRecs.set(c.id, rec);
    this.traffic.requestCustomer(obj, {
      kind: 'customer', handoffS: this.handoffS, spawnEdge: this.spawnEdge, spawnZ: this.spawnZ, handoffEdge: this.edge,
      cb: (o, x, z, yaw) => {
        const d = this.biz.arrived(c);
        if (d.action === 'leave') { this.custRecs.delete(c.id); return false; }
        this.adopt(rec, x, z, yaw);
        if (d.action === 'bay') this.driveToBay(rec, d.bayId, true);
        else {
          rec.state = 'queueing'; rec.slot = d.slot;
          const q = QUEUE_LOCAL[d.slot.index];
          rec.f.setPath(this.P([[ENTRY_X + 0.2, LANE_Z], [ENTRY_X, 24.5], [ENTRY_X, 21.5], [q.x, 21.5], [q.x, q.z]]));
          rec.f.onDone = () => { rec.state = 'queued'; this.parking.setOccupied(d.slot, true); };
        }
        return true;
      },
    });
  }

  driveToBay(rec, bayId, fromEntry) {
    const bx = BAY_X[bayId];
    rec.bayId = bayId;
    rec.state = 'arriving';
    this.cars.set(bayId, rec);
    const path = fromEntry
      ? [[ENTRY_X + 0.2, LANE_Z], [ENTRY_X, 24.5], [ENTRY_X, 12], [bx, 10], [bx, BAY_Z]]
      : [[QUEUE_LOCAL[rec.slot.index].x, 12.5], [bx, 10], [bx, BAY_Z]];
    rec.f.maxSpeed = 7;
    rec.f.setPath(this.P(path));
    rec.f.onDone = () => {
      rec.state = 'parked';
      this.biz.parkedAtBay(rec.customer);
    };
  }

  onAssigned({ customer: c, bayId }) {
    const rec = this.custRecs.get(c.id);
    if (rec?.f) this.driveToBay(rec, bayId, false);
  }

  onLeft({ customer: c, from }) {
    const rec = this.custRecs.get(c.id);
    if (!rec?.f) return;
    if (from === 'queue') {
      const q = QUEUE_LOCAL[rec.slot.index];
      this.sendOut(rec, [[q.x, 12.5], [q.x, 8], [EXIT_X, 8], ...this.exitTail()]);
    }
    // from a bay: the business already emitted svc:depart
  }

  exitTail() {
    // [EXIT_X, 20] and [EXIT_X - 0.4, 22.6]: inside the lot (the last one is the waiting spot at the driveway mouth); last three: pull out onto the road
    return [[EXIT_X, 20], [EXIT_X - 0.4, 22.6], [EXIT_X - 0.5, 25], [MERGE_X + 2, LANE_Z], [MERGE_X, LANE_Z + 0.1]];
  }

  onDepart({ bayId }) {
    const rec = this.cars.get(bayId);
    if (!rec || !rec.f) { this.biz.vehicleLeft(bayId); return; }
    const bx = BAY_X[bayId];
    this.sendOut(rec, [[bx, BAY_Z - 6], [bx, -13.6], [EXIT_X, -13.8], ...this.exitTail()]);
  }

  sendOut(rec, localPath) {
    rec.state = 'leaving';
    rec.f.maxSpeed = 7;
    const n = 3;
    rec.tail = localPath.slice(localPath.length - n);
    rec.f.setPath(this.P(localPath.slice(0, localPath.length - n)));
    rec.f.onDone = () => { rec.state = 'holding'; };
  }

  applyAvoidance(dt) {
    // Each car probes the space along the way it is about to drive (the whole path ahead, across its full width)
    // against the bodies of the other lot cars and brakes smoothly to stop a little short. A car never drives into
    // one that is physically in its way. Two single-file areas (where the entry row, the queue and the aisle cross,
    // and where the bay lanes funnel into the exit aisle) let one car through at a time, oldest first.
    const ZONES = this.Lc
      ? [{ x0: -20, x1: 20, z0: 6.5, z1: 14.5 }, { x0: -20, x1: 20, z0: -16, z1: -10 }]
      : [{ x0: -17, x1: 17, z0: 6.5, z1: 14.5 }, { x0: -17, x1: 17, z0: -15, z1: -8.5 }];
    const loc = (p) => (this.Lc ? this.Lc(p.x, p.z) : { x: p.x, z: p.z });
    const inZ = (Z, p) => { const l = loc(p); return l.x > Z.x0 && l.x < Z.x1 && l.z > Z.z0 && l.z < Z.z1; };
    // the point `d` metres ahead of the car's centre ALONG ITS PATH (round corners), with the local direction
    const pathPoint = (m, d) => {
      const o = m.obj, pts = m.f.path;
      let x = o.position.x, z = o.position.z, rem = d;
      let fx = -Math.sin(o.rotation.y), fz = -Math.cos(o.rotation.y);
      if (!m.f.done) {
        for (let i = m.f.idx; i < pts.length; i++) {
          const tx = pts[i].x - x, tz = pts[i].z - z, tl = Math.hypot(tx, tz);
          if (tl < 1e-6) continue;
          fx = tx / tl; fz = tz / tl;
          if (rem <= tl) return { x: x + fx * rem, z: z + fz * rem, fx, fz };
          rem -= tl; x = pts[i].x; z = pts[i].z;
        }
      }
      return { x: x + fx * rem, z: z + fz * rem, fx, fz };
    };
    const probe = (m, n) => {
      const o = m.obj, lenM = o.userData.length || 4.2, widM = o.userData.width || 1.9;
      const q = n.obj, yaw = q.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
      const hl = (q.userData.length || 4.2) / 2 + 0.25, hw = (q.userData.width || 1.9) / 2 + 0.25;
      for (const t of [0.4, 1.2, 2.2, 3.5, 5, 7, 9.5]) {
        const P = pathPoint(m, lenM / 2 + t);
        for (const off of [-widM / 2, 0, widM / 2]) {
          const dx = P.x + P.fz * off - q.position.x, dz = P.z - P.fx * off - q.position.z;
          if (Math.abs(c * dx - s * dz) < hw && Math.abs(s * dx + c * dz) < hl) return t;
        }
      }
      return Infinity;
    };
    // distance from the car's front to a single-file area along its path, or null
    const toZone = (Z, m) => {
      const lenM = m.obj.userData.length || 4.2;
      for (let t = 0.5; t <= 9; t += 0.5) if (inZ(Z, pathPoint(m, lenM / 2 + t))) return t;
      return null;
    };
    for (const m of this.movers) { if (m.f && !m.order) m.order = ++avoidSeq; }
    const zoneState = ZONES.map((Z) => {
      const inside = this.movers.some((n) => n.obj.visible && inZ(Z, n.obj.position));
      const entering = [];
      for (const m of this.movers) {
        if (!m.f || m.f.done || !m.obj.visible || inZ(Z, m.obj.position)) continue;
        const d = toZone(Z, m);
        if (d !== null) entering.push({ m, d });
      }
      let first = null;
      for (const e of entering) if (!first || e.m.order < first.m.order) first = e;
      return { inside, entering, first };
    });
    for (const m of this.movers) {
      if (!m.f || m.f.done) continue;
      let gap = Infinity, hard = false;
      for (const n of this.movers) {
        if (n === m || !n.obj.visible) continue;
        if (m.state === 'pulling' && (n.state === 'holding' || n.state === 'leaving')) continue; // cars waiting behind a car that is pulling out never hold it up
        const t = probe(m, n);
        if (t === Infinity) continue;
        // two cars that would block EACH OTHER (crossing paths): the older one goes first, so nobody waits for a car that waits for them
        if (!(!n.f || n.f.done) && (n.order || 0) > (m.order || 0) && probe(n, m) < Infinity) continue;
        gap = Math.min(gap, t - 0.4);
        if (n.state === 'merging' || n.state === 'holding' || n.state === 'pulling') hard = true; // a car waiting to rejoin the road will move on: queue behind it
      }
      for (const zs of zoneState) {
        const ent = zs.entering.find((e) => e.m === m);
        if (ent && (zs.inside || ent !== zs.first)) gap = Math.min(gap, ent.d - 0.9); // wait outside the area for the car in it / the older car waiting
      }
      const blocked = gap < Infinity;
      m.holdT = blocked ? (m.holdT || 0) + dt : 0;
      // a stand-off (nobody can move) is broken after 3 s: the car creeps on slowly for a few seconds. Cars waiting to merge are never pushed through.
      const push = blocked && !hard && m.holdT >= 3;
      m.f.limit = !blocked ? Infinity : push ? 1.2 : Math.sqrt(2 * 3.5 * Math.max(0, gap - 0.3));
      m.f.hold = blocked && !push && gap < 0.5;
      if (m.holdT > 9 && !hard) m.holdT = 0;
    }
  }

  updateVehicles(dt) {
    this.applyAvoidance(dt);
    for (const m of this.movers.slice()) {
      m.f.update(dt);
      if (m.slot && m.state !== 'queueing' && m.state !== 'queued' && this.Lc(m.obj.position.x, m.obj.position.z).z < 13.5) {
        this.biz.releaseSlot(m.customer);
        m.slot = null;
      }
      if (m.state === 'holding' && m.tail && !this.movers.some((x) => x !== m && (x.state === 'pulling' || x.state === 'merging')) && this.traffic.canMerge(m.obj, this.edge, this.mergeS, true)) {
        m.state = 'pulling'; m.f.maxSpeed = 6;
        m.f.setPath(this.P(m.tail));
        m.f.onDone = () => { m.state = 'merging'; };
        m.tail = null;
      }
      if (m.state === 'merging' && this.traffic.merge(m.obj, this.edge, this.mergeS)) {
        this.movers.splice(this.movers.indexOf(m), 1);
        this.custRecs.delete(m.customer.id);
        if (m.slot) { this.biz.releaseSlot(m.customer); m.slot = null; }
        if (m.bayId !== null && this.cars.get(m.bayId) === m) {
          this.cars.delete(m.bayId);
          if (!m.freed) { m.freed = true; this.biz.vehicleLeft(m.bayId); } // safety net: never leave a bay blocked
        }
      }
    }
    // bay is free as soon as its car has pulled out of the bay area
    for (const [bayId, rec] of this.cars) {
      if ((rec.state === 'leaving' || rec.state === 'holding' || rec.state === 'pulling' || rec.state === 'merging') && !rec.freed && this.Lc(rec.obj.position.x, rec.obj.position.z).z < BAY_Z - 5.5) {
        rec.freed = true;
        this.biz.vehicleLeft(bayId);
      }
    }
  }

  // ---------- per frame ----------
  update(dt) {
    if (!this.built) return;
    this.t += dt;
    this.updateVehicles(dt);
    this.labelTimer -= dt;
    const refresh = this.labelTimer <= 0;
    if (refresh) this.labelTimer = 0.2;
    const ls = this.mgmt ? Math.min(4, Math.max(1, this.mgFactor * 1.3)) * 3.2 : 3.2;
    this.biz.bays.forEach((b, i) => {
      const v = this.bayVis[i];
      this.updateBay(i, b, v, dt);
      const text = b.unlocked ? this.bayLabel(i, b) : null;
      v.label.sprite.visible = !!text && (this.mgmt || b.state !== 'empty');
      v.label.sprite.scale.set(ls, ls * (96 / 256), 1);
      if (refresh && text && v.label.sprite.visible) v.label.draw(text);
    });
    QUEUE_LOCAL.forEach((s, i) => {
      const ql = this.queueLabels[i];
      const c = this.biz.queue.find((q) => q.slot && q.slot.index === i);
      const rec = c && this.custRecs.get(c.id);
      const show = !!c && rec && rec.state === 'queued';
      ql.sprite.visible = show;
      const qs = this.mgmt ? Math.min(4, Math.max(1, this.mgFactor * 1.3)) * 2.8 : 2.8;
      ql.sprite.scale.set(qs, qs * (96 / 256), 1);
      if (show && refresh) {
        const pf = Math.max(0, c.patience / c.maxPatience);
        ql.draw({ title: `${this.biz.mood(c)} ${c.def.icon} ${c.def.label}`, sub: `${this.serviceName(c)} · ${Math.ceil(c.patience)}s`, pct: pf, color: pf > 0.6 ? '#1f8a4c' : pf > 0.3 ? '#e8a21c' : '#d6453d' });
      }
    });
    this.fadeRoof(dt);
    for (const e of this.emitters) e.update(dt);
  }

  /** Roof pieces fade out in management mode and when the player is underneath (high camera). */
  fadeRoof(dt) {
    if (!this.roofMats) return;
    const p = this.playerPos, O = this.origin;
    const lp = p ? this.Lc(p.x, p.z) : null;
    const under = lp && lp.x > -21 && lp.x < 5 && lp.z > -14 && lp.z < 1.5;
    const target = this.mgmt ? 0 : under ? 0.12 : 1;
    this.roofOpacity = (this.roofOpacity ?? 1) + (target - (this.roofOpacity ?? 1)) * Math.min(1, dt * 5);
    const ro = Math.abs(target - this.roofOpacity) < 0.02 ? target : this.roofOpacity;
    for (const m of this.roofMats) m.opacity = ro;
    for (const part of this.roofParts) { part.visible = ro > 0.01; part.castShadow = ro > 0.6; }
  }

  /** Create a roof piece with its own fading material. */
  roofPiece(w, h, d, color, x, y, z, r = 0.15) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true });
    (this.roofMats ||= []).push(m);
    const p = mesh(rbox(w, h, d, r, 2), m, { x, y, z, receive: true });
    (this.roofParts ||= []).push(p);
    this.stage.add(p);
    return p;
  }

  serviceName(c) {
    return c.service;
  }
}

/** Standard bay label colours by patience. */
export function patienceColor(pf) {
  return pf > 0.6 ? '#1f8a4c' : pf > 0.3 ? '#e8a21c' : '#d6453d';
}
export { Emitter, createBuilding, textTexture, mat, rbox, mesh, FLOOR, CAR_Y };
