import * as THREE from 'three';
import { ServiceLotView, BAY_X, BAY_Z, FLOOR, CAR_Y, Emitter, createBuilding, mat, rbox, mesh, textTexture, patienceColor } from './ServiceLotView.js';
import { setCarDirt } from '../world/Models.js';

const STAGE_TEXT = { spray: 'Water spray', foam: 'Foam application', brush: 'Brush cleaning', rinse: 'Rinsing', dry: 'Drying', polish: 'Polishing', interior: 'Interior cleaning' };
const STAGE_ICON = { spray: '💦', foam: '🫧', brush: '🌀', rinse: '🚿', dry: '💨', polish: '✨', interior: '🧹' };
const smooth = (t) => t * t * (3 - 2 * t);
const $ = (n) => `$${n.toLocaleString('en-US')}`;

/** Car wash lot: manual stalls and automatic tunnel gantries with staged cleaning animation. */
export class WashView extends ServiceLotView {
  constructor(o) {
    super({ ...o, id: 'wash', accent: 0x2f8cff });
  }

  buildBuilding() {
    const b = createBuilding(22, 4.6, 6, 0x4cc9f0, { roofColor: 0xffffff, awning: 0xffc43d, sign: { text: 'CAR WASH', bg: '#2f8cff', fg: '#ffffff' } });
    b.position.set(-8, FLOOR, -21);
    this.stage.add(b);
    this.makeBuildingSelectable(b);
    this.colliders.add(this.origin.x - 8, this.origin.z - 21, 22.3, 6.3, 5);
    // long canopy over the wash bays (fades out so bays stay visible)
    this.roofPiece(22, 0.5, 11.5, 0xf4f7fa, -8, 5.9, BAY_Z - 0.5);
    this.roofPiece(22.2, 0.45, 0.5, 0x2f8cff, -8, 5.65, BAY_Z + 5.4, 0.1);
    this.roofPiece(22.2, 0.45, 0.5, 0x2f8cff, -8, 5.65, BAY_Z - 6.4, 0.1);
    // pylon sign by the road
    const pylon = new THREE.Group();
    pylon.add(mesh(rbox(0.7, 8, 0.7, 0.15, 1), mat(0xdfe5ec), { y: 4 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.6), new THREE.MeshBasicMaterial({ map: textTexture('CAR WASH', { w: 512, h: 266, bg: '#2f8cff', font: 'bold 70px system-ui' }) }));
    face.position.set(0, 7.6, 0.42);
    const back = face.clone(); back.position.z = -0.42; back.rotation.y = Math.PI;
    pylon.add(face, back);
    pylon.position.set(20.5, FLOOR, 20.5);
    this.stage.add(pylon);
    this.colliders.add(this.origin.x + 20.5, this.origin.z + 20.5, 1, 1, 8);
    // vacuum / detail corner for decoration
    for (const x of [-20, -18]) this.stage.add(mesh(rbox(0.9, 1.5, 0.9, 0.2, 2), mat(0x4a525d), { x, y: FLOOR + 0.75, z: -8 }));
  }

  postsLocal() { return [{ x: -14, z: -15.2 }, { x: -11, z: -15.2 }, { x: -8, z: -15.2 }]; }

  buildBay(i, g) {
    const O = this.origin, bx = BAY_X[i];
    const m = { group: new THREE.Group(), i };
    g.add(m.group);
    // frame posts (collide with walkers) + roof beam
    for (const sx of [-2.1, 2.1]) {
      m.group.add(mesh(rbox(0.4, 4.6, 0.4, 0.1, 1), mat(0xdfe5ec), { x: sx, y: 2.3 }));
      this.colliders.add(O.x + bx + sx, O.z + BAY_Z, 0.5, 0.5, 5);
    }
    m.group.add(mesh(rbox(4.8, 0.35, 0.5, 0.08, 1), mat(0x2f8cff), { y: 4.6 }));
    // automatic gantry: crossbar with nozzles, two spinning brushes, dryer
    m.gantry = new THREE.Group();
    m.gantry.add(mesh(rbox(4.4, 0.4, 1.0, 0.1, 1), mat(0x2b3340), { y: 4.1 }));
    m.gantry.add(mesh(rbox(3.6, 0.14, 0.14, 0.03, 1), mat(0x9fd8ff, { emissive: 0x39d0ff, ei: 0.4 }), { y: 3.75 }));
    m.brushes = new THREE.Group();
    for (const sx of [-1.35, 1.35]) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 2.4, 14), new THREE.MeshStandardMaterial({ color: 0xff8fb1, roughness: 0.9 }));
      br.position.set(sx, 1.6, 0);
      br.castShadow = true;
      m.brushes.add(br);
    }
    m.gantry.add(m.brushes);
    m.dryer = mesh(rbox(3.2, 0.35, 0.7, 0.1, 1), mat(0x4a525d), { y: 3.35 });
    m.gantry.add(m.dryer);
    m.group.add(m.gantry);
    // manual stall: hose reel, hose and bucket
    m.manual = new THREE.Group();
    m.manual.add(mesh(rbox(0.7, 0.9, 0.5, 0.12, 2), mat(0xffc43d), { x: 2.55, y: 0.55, z: 1.9 }));
    const hose = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 6, 16), mat(0x20262d));
    hose.position.set(2.55, 1.2, 1.9); hose.rotation.y = Math.PI / 2;
    m.manual.add(hose);
    m.manual.add(mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.5, 12), mat(0x2f8cff), { x: -2.5, y: 0.3, z: 2.0 }));
    m.group.add(m.manual);
    // foam blobs that sit on the car
    m.foam = new THREE.Group();
    for (let k = 0; k < 16; k++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.22 + Math.random() * 0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
      b.position.set((Math.random() - 0.5) * 1.4, 0.9 + Math.random() * 0.55, (Math.random() - 0.5) * 3.2);
      b.userData.s = 0.7 + Math.random() * 0.6;
      m.foam.add(b);
    }
    m.foam.visible = false;
    m.foam.position.set(0, 0, 0);
    g.add(m.foam);
    // particle emitters (world space)
    const mk = (color, size, count) => { const e = new Emitter(count); e.set({ color, size }); this.emitters.push(e); return e; };
    m.spray = mk(0x7fd0ff, 0.14, 56);
    m.foamP = mk(0xffffff, 0.3, 36);
    m.wind = mk(0xf4f7fa, 0.12, 40);
    m.spark = mk(0xffe34d, 0.2, 32);
    m.base = new THREE.Vector3(O.x + bx, FLOOR, O.z + BAY_Z);
    return m;
  }

  refreshBayMode() {}

  updateBay(i, b, v, dt) {
    const m = v.machine;
    const tunnel = b.mode === 'tunnel';
    m.gantry.visible = tunnel;
    m.manual.visible = !tunnel;
    const car = this.cars.get(i)?.obj;
    const job = b.job, pkg = job ? this.biz.cfg.packages[job.pkg] : null;
    const active = (b.state === 'working' || b.state === 'auto') && pkg;
    const base = m.base;
    // reset
    for (const e of [m.spray, m.foamP, m.wind, m.spark]) e.set({ active: false });
    m.foam.visible = false;
    m.brushes.rotation.y = 0;
    if (car && job && b.state !== 'empty' && b.state !== 'reserved') {
      if (b.state === 'done') setCarDirt(car, b.vehicle?.dirt ?? 0);
      else setCarDirt(car, job.dirtStart + (job.dirtEnd - job.dirtStart) * smooth(Math.min(1, b.progress)));
    }
    if (!active) return;
    const stages = pkg.stages, p = Math.min(0.9999, b.progress);
    const idx = Math.min(stages.length - 1, Math.floor(p * stages.length));
    const stage = stages[idx], sf = p * stages.length - idx;
    b.stage = stage;
    const top = tunnel ? 3.7 : 2.4;
    const origin = new THREE.Vector3(base.x, top, base.z);
    const down = new THREE.Vector3(0, -3.6, 0);
    const spread = new THREE.Vector3(tunnel ? 3.2 : 1.2, 0.2, 3.4);
    if (stage === 'spray' || stage === 'rinse') {
      m.spray.set({ active: true, color: 0x7fd0ff, size: 0.15, origin, spread, vel: down, gravity: 2, jitter: 0.7, life: 0.7 });
    } else if (stage === 'foam') {
      m.foamP.set({ active: true, color: 0xffffff, size: 0.32, origin, spread, vel: new THREE.Vector3(0, -2.4, 0), gravity: 1, jitter: 0.5, life: 0.8 });
      m.foam.visible = true;
      m.foam.children.forEach((c) => c.scale.setScalar(Math.max(0.05, sf * c.userData.s)));
    } else if (stage === 'brush') {
      m.foam.visible = true;
      m.foam.children.forEach((c) => c.scale.setScalar(c.userData.s * (1 - sf * 0.6)));
      m.spray.set({ active: true, color: 0xcfeeff, size: 0.12, origin, spread, vel: new THREE.Vector3(0, -2.4, 0), gravity: 2, jitter: 0.6, life: 0.6 });
      m.brushes.rotation.y = this.t * 14;
      if (tunnel) m.gantry.position.z = Math.sin(this.t * 2.2) * 1.5;
      if (car) car.position.x = base.x + Math.sin(this.t * 45) * 0.012;
    } else if (stage === 'dry') {
      m.wind.set({ active: true, color: 0xf4f7fa, size: 0.1, origin: new THREE.Vector3(base.x, 3.2, base.z), spread, vel: new THREE.Vector3(0, -4.2, 0), jitter: 1.4, life: 0.5 });
      if (tunnel) m.gantry.position.z = Math.sin(this.t * 1.6) * 1.6;
    } else if (stage === 'polish') {
      m.spark.set({ active: true, color: 0xffe34d, size: 0.22, origin: new THREE.Vector3(base.x, 1.5, base.z), spread: new THREE.Vector3(2.2, 0.6, 4), vel: new THREE.Vector3(0, 1.4, 0), jitter: 1.2, life: 0.7 });
      m.brushes.rotation.y = this.t * 8;
    } else if (stage === 'interior') {
      m.wind.set({ active: true, color: 0xcfe6ff, size: 0.1, origin: new THREE.Vector3(base.x, 1.1, base.z), spread: new THREE.Vector3(1.6, 0.4, 2.8), vel: new THREE.Vector3(0, 1.0, 0), jitter: 0.8, life: 0.8 });
    }
    if (stage !== 'brush' && stage !== 'dry' && tunnel) m.gantry.position.z += (0 - m.gantry.position.z) * Math.min(1, dt * 3);
    if (stage !== 'brush' && car) car.position.x = base.x;
    m.foam.position.set(0, 0, 0);
  }

  bayLabel(i, b) {
    const c = b.customer, cfg = this.biz.cfg;
    if (b.state === 'empty') return { title: `Bay ${i + 1}`, sub: b.mode === 'tunnel' ? 'Automatic tunnel · free' : 'Manual stall · free', color: '#9aa3ad' };
    if (b.state === 'reserved' || !c) return null;
    const pkg = cfg.packages[c.service];
    if (b.state === 'waiting') {
      const pf = Math.max(0, c.patience / c.maxPatience);
      return { title: `${this.biz.mood(c)} ${c.def.icon} ${pkg.label}`, sub: `${Math.ceil(c.patience)}s · waiting for a washer`, pct: pf, color: patienceColor(pf) };
    }
    if (b.state === 'working' || b.state === 'auto') {
      const st = b.stage || pkg.stages[0];
      return { title: `${STAGE_ICON[st] || ''} ${STAGE_TEXT[st] || st}`, sub: `${pkg.label} · ${Math.round(b.progress * 100)}%`, pct: b.progress, color: '#2f8cff' };
    }
    if (b.state === 'done') return { title: 'Sparkling clean ✓', sub: 'Paid · leaving', color: '#1f8a4c' };
    return null;
  }

  serviceName(c) {
    return this.biz.cfg.packages[c.service].label;
  }

  bayInfo(i) {
    const w = this.biz, b = w.bays[i];
    if (!b.unlocked) {
      const cost = w.nextBayCost();
      return {
        title: `Wash bay ${i + 1} (empty slot)`, subtitle: 'Not built yet',
        rows: [['Build cost', cost === null ? '-' : $(cost)], ['Mode', 'Manual stall (upgradeable)']],
        actions: [{ label: `Build bay · ${cost === null ? '-' : $(cost)}`, disabled: i !== w.unlockedBays || cost === null || !this.economy.canAfford(cost), cb: () => w.addBay() }],
      };
    }
    const rows = [['Mode', b.mode === 'tunnel' ? 'Automatic tunnel' : 'Manual stall'], ['Equipment', w.equipment.name]];
    const c = b.customer;
    if (c) {
      const pkg = w.cfg.packages[c.service];
      rows.push(['Customer', `${c.def.icon} ${c.def.label}`], ['Package', pkg.label], ['Price', $(w.priceFor(c))], ['Dirt', `${Math.round((b.job ? (b.state === 'done' ? b.vehicle.dirt : b.job.dirtStart) : c.vehicle.dirt) * 100)}%`]);
      if (b.state === 'working' || b.state === 'auto') rows.push(['Progress', `${Math.round(b.progress * 100)}%`]);
    } else rows.push(['Status', 'Free']);
    const actions = [];
    if (b.mode === 'manual') {
      const need = w.cfg.tunnelMinEquipment;
      actions.push({ label: w.equipLevel >= need ? `Upgrade to automatic tunnel · ${$(w.cfg.tunnelCost)}` : `Tunnel needs equipment level ${need}`, disabled: !w.canTunnel(i) || !this.economy.canAfford(w.cfg.tunnelCost), cb: () => w.upgradeTunnel(i) });
    }
    const ne = w.nextEquipment();
    if (ne) actions.push({ label: `Upgrade equipment → ${ne.name} · ${$(ne.cost)}`, disabled: !this.economy.canAfford(ne.cost), cb: () => w.upgradeEquipment() });
    return { title: `Wash bay ${i + 1}`, subtitle: 'Car wash', rows, actions };
  }
}
