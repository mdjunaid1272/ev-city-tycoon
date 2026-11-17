import * as THREE from 'three';
import { ServiceLotView, BAY_X, BAY_Z, FLOOR, CAR_Y, Emitter, createBuilding, mat, rbox, mesh, textTexture, patienceColor } from './ServiceLotView.js';

const $ = (n) => `$${n.toLocaleString('en-US')}`;
const LIFT_H = 1.5;

/** EV garage lot: lifts that raise the car, scanners, tool carts, sparks and a parts-aware job display. */
export class GarageView extends ServiceLotView {
  constructor(o) {
    super({ ...o, id: 'garage', accent: 0xff7a59 });
  }

  buildBuilding() {
    const b = createBuilding(22, 4.8, 6, 0xff7a59, { roofColor: 0xffffff, awning: 0x2b3340, sign: { text: 'EV GARAGE', bg: '#2b3340', fg: '#ffffff' } });
    b.position.set(-8, FLOOR, -21);
    this.stage.add(b);
    this.colliders.add(this.origin.x - 8, this.origin.z - 21, 22.3, 6.3, 5);
    this.roofPiece(22, 0.5, 11.5, 0x4a525d, -8, 5.9, BAY_Z - 0.5);
    this.roofPiece(22.2, 0.45, 0.5, 0xff7a59, -8, 5.65, BAY_Z + 5.4, 0.1);
    this.roofPiece(22.2, 0.45, 0.5, 0xff7a59, -8, 5.65, BAY_Z - 6.4, 0.1);
    const pylon = new THREE.Group();
    pylon.add(mesh(rbox(0.7, 8, 0.7, 0.15, 1), mat(0xdfe5ec), { y: 4 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.6), new THREE.MeshBasicMaterial({ map: textTexture('EV GARAGE', { w: 512, h: 266, bg: '#ff7a59', font: 'bold 70px system-ui' }) }));
    face.position.set(0, 7.6, 0.42);
    const back = face.clone(); back.position.z = -0.42; back.rotation.y = Math.PI;
    pylon.add(face, back);
    pylon.position.set(20.5, FLOOR, 20.5);
    this.stage.add(pylon);
    this.colliders.add(this.origin.x + 20.5, this.origin.z + 20.5, 1, 1, 8);
    // parts shelves / crates by the building: height reflects the stock level
    this.crates = [];
    const keys = Object.keys(this.biz.cfg.parts);
    keys.forEach((k, idx) => {
      const g = new THREE.Group();
      for (let n = 0; n < 6; n++) {
        const c = mesh(rbox(1.1, 0.8, 1.1, 0.1, 1), mat([0x8a5a35, 0xb9a27a, 0x6b4a2b][n % 3]), { x: 0, y: 0.4 + Math.floor(n / 2) * 0.82, z: 0 });
        c.position.x = (n % 2) * 1.15;
        g.add(c);
      }
      g.position.set(-19 + idx * 2.7, FLOOR, -16.8);
      this.stage.add(g);
      this.crates.push({ key: k, group: g });
    });
  }

  postsLocal() { return [{ x: -15, z: -15.2 }, { x: -12, z: -15.2 }, { x: -9, z: -15.2 }]; }
  breakLocal() { return { x: -4, z: -15.5 }; }
  doorLocal() { return { x: -3, z: -17.6 }; }

  buildBay(i, g) {
    const O = this.origin, bx = BAY_X[i];
    const m = { group: new THREE.Group(), i, lift: 0 };
    g.add(m.group);
    m.group.add(mesh(rbox(3.6, 0.12, 6.4, 0.04, 1), mat(0x4a525d), { y: 0.06, receive: true }));
    // lift columns, carriage arms and pads
    for (const sx of [-1.9, 1.9]) {
      m.group.add(mesh(rbox(0.4, 3.6, 0.5, 0.1, 1), mat(0xffc43d), { x: sx, y: 1.8, z: 0 }));
      this.colliders.add(O.x + bx + sx, O.z + BAY_Z, 0.55, 0.6, 4);
    }
    m.carriage = new THREE.Group();
    for (const sz of [-1.5, 1.5]) m.carriage.add(mesh(rbox(3.4, 0.16, 0.3, 0.05, 1), mat(0xff7a59), { y: 0.2, z: sz }));
    m.group.add(m.carriage);
    // tool cart and scanner on the stand side
    const cart = mesh(rbox(0.9, 1.0, 0.6, 0.1, 2), mat(0xe8483f), { x: 3.0, y: 0.5, z: 2.2 });
    m.group.add(cart);
    this.colliders.add(O.x + bx + 3.0, O.z + BAY_Z + 2.2, 1.0, 0.7, 1.2);
    m.group.add(mesh(rbox(0.6, 0.45, 0.06, 0.02, 1), mat(0x0b2a40, { emissive: 0x39ffb0, ei: 0.8 }), { x: 3.0, y: 1.35, z: 2.2, cast: false }));
    m.scanEmitter = new Emitter(40); m.scanEmitter.set({ color: 0x39ffb0, size: 0.14 });
    m.sparks = new Emitter(40); m.sparks.set({ color: 0xffa21a, size: 0.14 });
    this.emitters.push(m.scanEmitter, m.sparks);
    m.base = new THREE.Vector3(O.x + bx, FLOOR, O.z + BAY_Z);
    return m;
  }

  updateBay(i, b, v, dt) {
    const m = v.machine, car = this.cars.get(i)?.obj;
    const lifted = b.state === 'diagnosing' || b.state === 'ready' || b.state === 'blocked' || b.state === 'repairing';
    m.lift += ((lifted ? 1 : 0) - m.lift) * Math.min(1, dt * 2.2);
    if (b.state === 'done' || b.state === 'empty') m.lift = 0; // lowered when the job is over
    m.carriage.position.y = m.lift * LIFT_H;
    if (car && b.state !== 'reserved') car.position.y = CAR_Y + m.lift * LIFT_H;
    m.scanEmitter.set({ active: false });
    m.sparks.set({ active: false });
    // restore wheels unless a tyre swap is in progress
    if (car) for (const w of car.userData.wheels) w.visible = true;
    const base = m.base;
    if (b.state === 'diagnosing') {
      m.scanEmitter.set({ active: true, origin: new THREE.Vector3(base.x, FLOOR + 1.1 + m.lift * LIFT_H, base.z), spread: new THREE.Vector3(2.2, 0.2, 4.2), vel: new THREE.Vector3(0, 0.9, 0), jitter: 0.3, life: 0.9 });
    } else if (b.state === 'repairing' && b.job) {
      const svc = this.biz.cfg.services[b.job.actual];
      const y = FLOOR + 0.5 + m.lift * LIFT_H;
      const wheelPos = new THREE.Vector3(base.x + (Math.sin(this.t * 3) > 0 ? 0.9 : -0.9), y, base.z + (Math.sin(this.t * 1.7) > 0 ? 1.3 : -1.3));
      if (svc.repairs === 'battery') m.sparks.set({ active: true, color: 0x39d0ff, size: 0.16, origin: new THREE.Vector3(base.x, y + 0.2, base.z), spread: new THREE.Vector3(1.2, 0.2, 1.6), vel: new THREE.Vector3(0, 1.2, 0), jitter: 2, life: 0.4 });
      else m.sparks.set({ active: true, color: 0xffa21a, size: 0.14, origin: wheelPos, spread: new THREE.Vector3(0.3, 0.2, 0.3), vel: new THREE.Vector3(0, 1.6, 0), gravity: 6, jitter: 2.4, life: 0.5 });
      if (svc.repairs === 'tyres' && car) { // wheels come off one by one and go back on
        const p = b.progress;
        car.userData.wheels.forEach((w, k) => { w.visible = !(p > 0.12 + k * 0.17 && p < 0.55 + k * 0.1); });
      }
      if (car) car.position.x = base.x + Math.sin(this.t * 40) * 0.01;
    } else if (car && ['diagnosing', 'ready', 'blocked'].includes(b.state)) car.position.x = base.x; // settle after the repair shake
  }

  refreshStock() {
    const g = this.biz;
    for (const c of this.crates || []) {
      const max = g.cfg.parts[c.key].max, st = g.stock[c.key];
      c.group.children.forEach((box, n) => { box.visible = n < Math.ceil((st / max) * 6); });
    }
  }
  update(dt) {
    super.update(dt);
    if (this.built) { this.stockT = (this.stockT || 0) - dt; if (this.stockT <= 0) { this.stockT = 0.5; this.refreshStock(); } }
  }

  bayLabel(i, b) {
    const c = b.customer, g = this.biz, cfg = g.cfg;
    if (b.state === 'empty') return { title: `Lift ${i + 1}`, sub: 'Free', color: '#9aa3ad' };
    if (b.state === 'reserved' || !c) return null;
    const j = b.job, svc = cfg.services[c.service];
    if (b.state === 'waiting') {
      const pf = Math.max(0, c.patience / c.maxPatience);
      return { title: `${g.mood(c)} ${c.def.icon} ${svc.label}`, sub: `${Math.ceil(c.patience)}s · needs a mechanic`, pct: pf, color: patienceColor(pf) };
    }
    if (b.state === 'diagnosing') return { title: '🔍 Diagnosing…', sub: `${svc.label} · ${Math.round(b.progress * 100)}%`, pct: b.progress, color: '#2f8cff' };
    if (b.state === 'ready') return { title: `🧾 ${cfg.services[j.actual].label}`, sub: 'Requirement found · waiting for a mechanic', color: '#e8a21c' };
    if (b.state === 'blocked') {
      const missing = Object.entries(cfg.services[j.actual].parts).filter(([p, n]) => g.stock[p] < n).map(([p]) => cfg.parts[p].label).join(', ');
      return { title: '⚠ Waiting for parts', sub: `${missing} · ${Math.ceil(c.patience)}s`, pct: Math.max(0, c.patience / c.maxPatience), color: '#d6453d' };
    }
    if (b.state === 'repairing') return { title: `🔧 ${cfg.services[j.actual].label}`, sub: `${Math.round(b.progress * 100)}%`, pct: b.progress, color: '#1f8a4c' };
    if (b.state === 'done') return { title: 'Repaired ✓', sub: 'Paid · leaving', color: '#1f8a4c' };
    return null;
  }

  serviceName(c) {
    return this.biz.cfg.services[c.service].label;
  }

  bayInfo(i) {
    const g = this.biz, b = g.bays[i];
    if (!b.unlocked) {
      const cost = g.nextLiftCost();
      return {
        title: `Lift ${i + 1} (empty slot)`, subtitle: 'Not built yet',
        rows: [['Build cost', cost === null ? '-' : $(cost)]],
        actions: [{ label: `Build lift · ${cost === null ? '-' : $(cost)}`, disabled: i !== g.unlockedBays || cost === null || !this.economy.canAfford(cost), cb: () => g.addLift() }],
      };
    }
    const rows = [['Scanner', g.scanner.name], ['Tools', g.tools.name]];
    const c = b.customer;
    if (c) {
      const j = b.job, svc = g.cfg.services[c.service];
      const cond = c.vehicle.condition;
      rows.push(['Customer', `${c.def.icon} ${c.def.label}`], ['Reported', svc.label]);
      if (j?.requirement) rows.push(['Requirement', j.requirement]);
      rows.push(['Condition', `Batt ${cond.battery} · Motor ${cond.motor} · Tyres ${cond.tyres} · Brakes ${cond.brakes}`]);
      if (b.state === 'diagnosing' || b.state === 'repairing') rows.push(['Progress', `${Math.round(b.progress * 100)}%`]);
    } else rows.push(['Status', 'Free']);
    const actions = [];
    const ns = g.cfg.scanner[g.scannerLevel], nt = g.cfg.tools[g.toolLevel];
    if (ns) actions.push({ label: `Upgrade scanner → ${ns.name} · ${$(ns.cost)}`, disabled: !this.economy.canAfford(ns.cost), cb: () => g.upgrade('scanner') });
    if (nt) actions.push({ label: `Upgrade tools → ${nt.name} · ${$(nt.cost)}`, disabled: !this.economy.canAfford(nt.cost), cb: () => g.upgrade('tools') });
    return { title: `Lift ${i + 1}`, subtitle: 'Repair bay', rows, actions };
  }
}
