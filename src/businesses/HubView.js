import * as THREE from 'three';
import { ServiceLotView, BAY_X, BAY_Z, FLOOR, createBuilding, mat, rbox, mesh, textTexture, patienceColor } from './ServiceLotView.js';

const $ = (n) => `$${n.toLocaleString('en-US')}`;
const KIND_COLOR = { ac: 0x2f8cff, dc: 0x1f8a4c, ultra: 0x7a3bff };

/** Charging-hub lot: charger pedestals with cables at every bay; the building and canopy change with the charger upgrade. */
export class HubView extends ServiceLotView {
  constructor(o) {
    super({ ...o, id: o.business.id, accent: o.business.hub.accent });
    this.key = o.business.key;
  }

  buildBuilding() {
    const h = this.biz.hub;
    const b = createBuilding(22, 4.6, 6, h.building, { roofColor: 0xffffff, awning: 0xffc43d, sign: { text: h.sign, bg: '#1f2a37', fg: '#ffffff' }, style: 'shop', seed: 6 });
    b.position.set(-8, FLOOR, -21);
    this.stage.add(b);
    this.makeBuildingSelectable(b);
    this.addCollider(-8, -21, 22.3, 6.3, 5);
    this.roofPiece(22, 0.5, 11.5, 0xf4f7fa, -8, 5.9, BAY_Z - 0.5);
    this.roofPiece(22.2, 0.45, 0.5, h.accent, -8, 5.65, BAY_Z + 5.4, 0.1);
    this.roofPiece(22.2, 0.45, 0.5, h.accent, -8, 5.65, BAY_Z - 6.4, 0.1);
    // pylon
    const pylon = new THREE.Group();
    pylon.add(mesh(rbox(0.7, 8, 0.7, 0.15, 1), mat(0xdfe5ec), { y: 4 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.6), new THREE.MeshBasicMaterial({ map: textTexture(h.sign, { w: 512, h: 266, bg: '#' + h.accent.toString(16).padStart(6, '0'), font: 'bold 64px system-ui' }) }));
    face.position.set(0, 7.6, 0.42);
    const back = face.clone(); back.position.z = -0.42; back.rotation.y = Math.PI;
    pylon.add(face, back);
    pylon.position.set(20.5, FLOOR, 20.5);
    this.stage.add(pylon);
    this.addCollider(20.5, 20.5, 1, 1, 8);
    // upgrade visuals: rooftop solar row + glowing accent band appear once chargers are upgraded
    this.upgradeProps = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const p = mesh(rbox(2.6, 0.12, 1.6, 0.04, 1), mat(0x1c3b6b, { rough: 0.2, metal: 0.5 }), { x: -17 + i * 3.1, y: FLOOR + 5.1, z: -21 });
      p.rotation.x = -0.2;
      this.upgradeProps.add(p);
    }
    this.upgradeBand = mesh(rbox(22.4, 0.35, 6.4, 0.05, 1), mat(this.biz.hub.accent, { emissive: this.biz.hub.accent, ei: 0.35 }), { x: -8, y: FLOOR + 4.55, z: -21 });
    this.stage.add(this.upgradeProps, this.upgradeBand);
    if (this.biz.hub.retail) { // little shop front on the commercial / highway hubs
      for (const [i, c] of [0xe8483f, 0x2f8cff].entries()) this.stage.add(mesh(rbox(1.0, 2.0, 0.9, 0.12, 2), mat(c), { x: -19.2 + i * 1.3, y: FLOOR + 1, z: -17.6 }));
    }
  }

  postsLocal() { return [{ x: -10, z: -15.2 }, { x: -7, z: -15.2 }, { x: -4, z: -15.2 }]; }

  buildBay(i, g) {
    const bx = BAY_X[i];
    const m = { group: new THREE.Group(), i, cable: null, ringT: 0 };
    g.add(m.group);
    m.charger = new THREE.Group();
    m.head = mesh(rbox(0.52, 0.5, 0.42, 0.14, 3), mat(KIND_COLOR[this.biz.charger.kind], { rough: 0.35 }), { y: 1.55 });
    m.charger.add(mesh(rbox(0.9, 0.12, 0.9, 0.05, 1), mat(0x9aa3ad), { y: 0.06, receive: true }), mesh(rbox(0.5, 1.7, 0.4, 0.14, 3), mat(0xf4f7fa, { rough: 0.4 }), { y: 0.95 }), m.head);
    m.charger.add(mesh(rbox(0.34, 0.26, 0.04, 0.02, 1), mat(0x0b2a40, { emissive: 0x39d0ff, ei: 0.9 }), { y: 1.55, z: -0.22, cast: false }));
    m.ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 32), new THREE.MeshBasicMaterial({ color: 0x39ffb0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    m.ring.rotation.x = -Math.PI / 2; m.ring.position.y = 0.04;
    m.charger.add(m.ring);
    m.charger.position.set(2.4, 0, 0);
    m.charger.rotation.y = Math.PI / 2; // faces the car
    m.group.add(m.charger);
    this.addCollider(bx + 2.4, BAY_Z, 0.9, 0.9, 2);
    m.group.add(mesh(rbox(3.6, 0.06, 6.4, 0.02, 1), mat(0x4a5a66), { y: 0.03, receive: true }));
    return m;
  }

  refreshBayMode() {
    // chargers take the colour of the installed tier; the building shows the upgrade
    const lvl = this.biz.chargerLevel;
    this.bayVis.forEach((v) => { if (v.machine) v.machine.head.material = mat(KIND_COLOR[this.biz.charger.kind], { rough: 0.35 }); });
    if (this.upgradeProps) this.upgradeProps.visible = lvl > 0;
    if (this.upgradeBand) this.upgradeBand.visible = lvl > 0;
  }

  connectCable(i, car) {
    const v = this.bayVis[i].machine;
    this.disconnectCable(i);
    this.stage.updateMatrixWorld(true);
    car.updateMatrixWorld(true);
    const a = v.charger.localToWorld(new THREE.Vector3(0, 0.8, -0.36));
    const port = car.localToWorld(new THREE.Vector3(car.userData.width * 0.5, car.userData.portY, 0.5));
    const mid = a.clone().lerp(port, 0.5); mid.y = Math.min(a.y, port.y) - 0.35;
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5), mid, mid.clone().lerp(port, 0.5), port]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.045, 6, false), new THREE.MeshStandardMaterial({ color: 0x20262d, emissive: 0x39ffb0, emissiveIntensity: 0.4, roughness: 0.5 }));
    this.scene.add(cable); // world-space tube
    v.cable = cable;
  }
  disconnectCable(i) {
    const v = this.bayVis[i]?.machine;
    if (v?.cable) { this.scene.remove(v.cable); v.cable.geometry.dispose(); v.cable.material.dispose(); v.cable = null; }
  }

  updateBay(i, b, v, dt) {
    const m = v.machine;
    m.ringT += dt;
    if (b.state === 'charging') {
      m.ring.material.opacity = 0.35 + Math.sin(m.ringT * 5) * 0.25;
      const car = this.cars.get(i)?.obj;
      if (!m.cable && car) this.connectCable(i, car);
      if (m.cable) m.cable.material.emissiveIntensity = 0.4 + Math.sin(m.ringT * 6) * 0.3;
    } else {
      m.ring.material.opacity = b.state === 'waiting' ? 0.5 + Math.sin(m.ringT * 3) * 0.2 : 0;
      if (m.cable) this.disconnectCable(i);
    }
  }

  bayLabel(i, b) {
    const c = b.customer;
    if (b.state === 'empty') return { title: `Bay ${i + 1}`, sub: `${this.biz.charger.kw} kW · free`, color: '#9aa3ad' };
    if (b.state === 'reserved' || !c) return null;
    if (b.state === 'waiting') {
      const pf = Math.max(0, c.patience / c.maxPatience);
      return { title: `${this.biz.mood(c)} ${c.def.icon} ${c.def.label}`, sub: `${Math.ceil(c.patience)}s · waiting for plug-in`, pct: pf, color: patienceColor(pf) };
    }
    if (b.state === 'charging') return { title: `${c.def.icon} ${Math.round(b.vehicle.soc * 100)}% ⚡ ${b.power.toFixed(0)} kW`, sub: `${c.vehicle.label} · ${b.delivered.toFixed(1)} kWh`, pct: b.vehicle.soc, color: '#1f8a4c' };
    if (b.state === 'done') return { title: 'Charged ✓', sub: 'Paid · leaving', color: '#1f8a4c' };
    return null;
  }

  serviceName() {
    return `charge @ ${$(this.biz.price)}/kWh`;
  }

  bayInfo(i) {
    const h = this.biz, b = h.bays[i];
    if (!b.unlocked) {
      const cost = h.nextBayCost();
      return {
        title: `${h.cfg.label} · bay ${i + 1} (empty slot)`, subtitle: 'Not built yet',
        rows: [['Build cost', cost === null ? '-' : $(cost)]],
        actions: [{ label: `Build bay · ${cost === null ? '-' : $(cost)}`, disabled: i !== h.unlockedBays || cost === null || !this.economy.canAfford(cost), cb: () => h.addBay() }],
      };
    }
    const rows = [['Charger', `${h.charger.name} · ${h.charger.kw} kW`], ['Price', `${$(h.price)}/kWh`]];
    const c = b.customer;
    if (c) {
      rows.push(['Customer', `${c.def.icon} ${c.def.label}`], ['Vehicle', `${c.vehicle.label} (${c.vehicle.connector.toUpperCase()})`], ['Battery', `${Math.round(b.vehicle.soc * 100)}%`]);
      if (b.state === 'charging') rows.push(['Power', `${b.power.toFixed(0)} kW`], ['Delivered', `${b.delivered.toFixed(1)} kWh`]);
      if (b.state === 'waiting') rows.push(['Patience', `${Math.ceil(c.patience)}s left`]);
    } else rows.push(['Status', 'Free']);
    const actions = [];
    const n = h.nextCharger();
    if (n) actions.push({ label: `Upgrade chargers → ${n.name} · ${$(n.cost)}`, disabled: !!h.chargerLock() || !this.economy.canAfford(n.cost), cb: () => h.upgradeCharger() });
    actions.push({ label: 'Open hub manager', cb: () => this.bus.emit('ui:open', this.id) });
    return { title: `${h.cfg.label} · bay ${i + 1}`, subtitle: h.hub.category, rows, actions };
  }
}
