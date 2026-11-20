import * as THREE from 'three';
import { mat, rbox, mesh, nightMaterials, textTexture } from '../world/Materials.js';
import { createBuilding, setCarDirt } from '../world/Models.js';
import { stationBuildingInfo, needCash } from '../ui/BuildingInfo.js';
import { PathFollower } from '../vehicles/PathFollower.js';
import { BAY_SLOTS } from './ChargingStation.js';
import { QUEUE_SLOTS } from '../customers/CustomerManager.js';
let avoidSeq = 0; // arrival order of lot cars (priority when paths cross)

const FLOOR = 0.34;
const CAR_Y = 0.34;
const LEVEL_KIND = ['ac', 'dc', 'ultra'];
const KIND_COLOR = { ac: 0x2f8cff, dc: 0x1f8a4c, ultra: 0x7a3bff };

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function makeLabel(scale = 3) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(scale, scale * (96 / 256), 1);
  sprite.renderOrder = 10;
  const g = c.getContext('2d');
  return {
    sprite,
    draw({ title, sub, pct = null, color = '#1f8a4c' }) {
      g.clearRect(0, 0, 256, 96);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      roundRect(g, 4, 4, 248, 88, 18); g.fill();
      g.strokeStyle = color; g.lineWidth = 4; g.stroke();
      g.fillStyle = '#1f2a37'; g.font = 'bold 26px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(title, 128, pct == null ? 34 : 28);
      g.fillStyle = '#5b6776'; g.font = '20px system-ui, sans-serif';
      g.fillText(sub || '', 128, pct == null ? 66 : 76);
      if (pct != null) {
        g.fillStyle = '#e5eaf0'; roundRect(g, 20, 44, 216, 14, 7); g.fill();
        g.fillStyle = color; roundRect(g, 20, 44, Math.max(8, 216 * pct), 14, 7); g.fill();
      }
      tex.needsUpdate = true;
    },
  };
}

function lotFloorTexture() {
  const S = 24, W = 42, c = document.createElement('canvas');
  c.width = c.height = W * S;
  const g = c.getContext('2d');
  const px = (x) => (x + 21) * S, pz = (z) => (z + 21) * S;
  g.fillStyle = '#6b7484'; g.fillRect(0, 0, c.width, c.height);
  // charging bays
  for (const bx of BAY_SLOTS) {
    g.fillStyle = 'rgba(57,255,176,0.12)'; g.fillRect(px(bx - 1.75), pz(-3.4), 3.5 * S, 6.8 * S);
    g.strokeStyle = '#39ffb0'; g.lineWidth = 5; g.strokeRect(px(bx - 1.75), pz(-3.4), 3.5 * S, 6.8 * S);
  }
  // waiting queue (3 spaces) with a label on the asphalt
  g.strokeStyle = '#ffe34d'; g.lineWidth = 4;
  for (const sx of [-8.5, -4, 0.5]) g.strokeRect(px(sx - 1.8), pz(14.4), 3.6 * S, 5.2 * S);
  g.fillStyle = '#ffe34d'; g.font = `bold ${1.1 * S}px system-ui`; g.textAlign = 'center';
  g.fillText('WAITING', px(-4), pz(21.1));
  // ordinary parking row
  g.strokeStyle = '#f4f7fa'; g.lineWidth = 4;
  for (let x = 2; x <= 18; x += 4) { g.beginPath(); g.moveTo(px(x), pz(13)); g.lineTo(px(x), pz(19.5)); g.stroke(); }
  g.beginPath(); g.moveTo(px(2), pz(13)); g.lineTo(px(18), pz(13)); g.stroke();
  // driveway arrows + edge lines
  g.strokeStyle = '#f2d64b'; g.lineWidth = 4; g.setLineDash([18, 18]);
  g.beginPath(); g.moveTo(px(-12), pz(21)); g.lineTo(px(-12), pz(13)); g.stroke();
  g.beginPath(); g.moveTo(px(12), pz(-13)); g.lineTo(px(12), pz(-21)); g.stroke();
  g.setLineDash([]);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/**
 * Visual layer of the charging station: lot, canopy, chargers, parked/driving customer cars,
 * cables, floating status labels, selectable objects and interaction targets.
 */
export class StationView {
  constructor({ scene, assets, colliders, bus, station, economy, traffic, road, parking, customers, hub }) {
    this.hub = hub;
    this.customers = customers;
    this.custRecs = new Map(); // customer id -> vehicle record
    this.scene = scene;
    this.assets = assets;
    this.traffic = traffic;
    this.road = road;
    this.parking = parking;
    this.movers = []; // every customer/visitor vehicle currently inside the lot logic (moving or parked)
    this.visitors = [];
    this.visitorTimer = 12;
    parking.addLot('station-row', [4, 8, 12, 16].map((x) => ({ x, z: 16.5, yaw: 0 })));
    this.colliders = colliders;
    this.bus = bus;
    this.station = station;
    this.economy = economy;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.carPool = new Map();
    this.cars = new Map(); // bayId -> {obj, follower, state, freed}
    this.bayVis = [];
    this.interactables = [];
    this.selectables = [];
    this.mgmt = false;
    this.labelTimer = 0;
    this.mgFactor = 1;
    this.time = 0;
    this.terminalPos = new THREE.Vector3(-14, FLOOR, -11);
    this.build();
    bus.on('customer:spawn', (e) => this.onCustomerSpawn(e));
    bus.on('customer:assigned', (e) => this.onCustomerAssigned(e));
    bus.on('customer:left', (e) => this.onCustomerLeft(e));
    bus.on('vehicle:depart', (e) => this.onDepart(e));
    bus.on('charging:start', (e) => this.connectCable(e.bayId));
    bus.on('station:changed', () => this.refreshStructure());
  }

  build() {
    const r = this.root;
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(42, 42), new THREE.MeshStandardMaterial({ map: lotFloorTexture(), roughness: 0.95 }));
    lot.rotation.x = -Math.PI / 2; lot.position.set(0, FLOOR, 0); lot.receiveShadow = true;
    r.add(lot);

    // (no canopy roof or pillars: the pump area is open air)
    this.roofMats = [];
    this.roofParts = [];
    this.roofOpacity = 1;
    // solar panels (upgrade visual) sit on the shop roof
    this.solar = new THREE.Group();
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const p = mesh(rbox(3.4, 0.12, 2.2, 0.04, 1), mat(0x1c3b6b, { rough: 0.2, metal: 0.5 }), { x: -14 + (col - 1) * 3.8, y: 5.2, z: -17 + (row - 1) * 2.5 });
        p.rotation.x = -0.12;
        this.solar.add(p);
      }
    }
    this.solar.visible = false;
    r.add(this.solar);
    // shop kiosk + terminal
    const shop = createBuilding(12, 4.6, 8, 0x1f8a4c, { roofColor: 0xf4f7fa, awning: 0xffc43d, sign: { text: 'EV STOP', bg: '#ffffff', fg: '#1f8a4c' } });
    shop.position.set(-14, 0.34, -17);
    r.add(shop);
    this.colliders.add(-14, -17, 12.3, 8.3, 5);
    shop.userData.select = () => stationBuildingInfo(this); // the whole building is selectable, not just the terminal
    shop.userData.focus = new THREE.Vector3(-14, 0, -17);
    this.selectables.push(shop);
    this.buildTerminal();

    // pylon sign
    const pylon = new THREE.Group();
    pylon.add(mesh(rbox(0.7, 9, 0.7, 0.15, 1), mat(0xdfe5ec), { y: 4.5 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.6), new THREE.MeshBasicMaterial({ map: textTexture('⚡ EV CITY CHARGE', { w: 512, h: 266, bg: '#1f8a4c', font: 'bold 56px system-ui' }) }));
    face.position.set(0, 8.6, 0.42);
    const back = face.clone(); back.position.z = -0.42; back.rotation.y = Math.PI;
    pylon.add(face, back);
    pylon.position.set(15, FLOOR, 23.2); // beyond the visitor aisle (z = 20-21) so parking cars never clip it
    r.add(pylon);
    this.colliders.add(15, 23.2, 1, 1, 9);

    // visitor parking row: two cars are already parked when you arrive (see VISITOR section below)
    this.buildExtras();
    this.initVisitors();

    // benches + bushes
    for (const x of [-3, 3]) {
      const b = new THREE.Group();
      b.add(mesh(rbox(2, 0.14, 0.6, 0.05, 1), mat(0x8a5a35), { y: 0.5 }), mesh(rbox(2, 0.5, 0.1, 0.04, 1), mat(0x8a5a35), { y: 0.85, z: 0.28 }));
      b.position.set(x, FLOOR, -9);
      r.add(b);
    }
    for (const [x, z] of [[-9, 22], [9, 22], [-9, -21.5], [21, 6], [21, -6], [-21, -6]]) {
      const bush = mesh(new THREE.IcosahedronGeometry(1, 1), mat(0x3fae4a, { rough: 0.9 }), { x, y: 0.9, z });
      bush.scale.set(1.4, 0.9, 1.4);
      r.add(bush);
    }

    // bays: charger + ghost slot + label
    BAY_SLOTS.forEach((bx, i) => {
      const side = bx < 0 || bx === 15 ? 1 : -1; // the 4th bay's charger sits on the outside: the exit aisle (x = 12) stays clear
      const cx = bx + side * 2.45;
      const charger = this.createCharger(i);
      charger.position.set(cx, FLOOR, 0);
      charger.rotation.y = side * (Math.PI / 2);
      r.add(charger);
      this.colliders.add(cx, 0, 0.9, 0.9, 2); // pedestal blocks walkers (employees path around it)

      const ghost = new THREE.Group();
      const gm = new THREE.MeshBasicMaterial({ color: 0x39ffb0, transparent: true, opacity: 0.22, depthWrite: false });
      ghost.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 6.6), gm));
      const plus = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const plus2 = plus.clone(); plus2.rotation.y = Math.PI / 2;
      ghost.add(plus, plus2);
      ghost.position.set(bx, FLOOR + 0.1, 0);
      ghost.userData.select = () => this.bayInfo(i);
      ghost.userData.focus = new THREE.Vector3(bx, 0, 0);
      r.add(ghost);

      const label = makeLabel(3.4);
      label.sprite.position.set(bx, 4.2, 0);
      r.add(label.sprite);

      charger.userData.bayIndex = i;
      charger.userData.bayX = cx;
      this.bayVis.push({ charger, ghost, label, cable: null, bx, side, ringT: 0 });
      this.selectables.push(charger, ghost);

      this.interactables.push({
        id: `bay${i}`, pos: new THREE.Vector3(cx, 0, 0), radius: 4.2,
        getPrompt: () => {
          const b = this.station.bays[i];
          if (!b.unlocked) return null;
          if (b.state === 'waiting') return { text: `Connecting ${b.vehicle.label} · Bay ${i + 1}…`, auto: true };
          if (b.state === 'charging') return { text: `Click the charger to stop & bill · Bay ${i + 1} (${Math.round(b.vehicle.soc * 100)}%)`, noKey: true };
          if (b.state === 'done' && !b.released) return { text: `Unplugging · Bay ${i + 1}…`, auto: true };
          return null;
        },
        run: () => {
          const b = this.station.bays[i];
          if (b.state === 'waiting') this.station.startCharging(i);
          else if (b.state === 'done') this.station.release(i); // charging is stopped by clicking the charger (see Game.onClick), not by a key
        },
      });
    });
    // waiting-queue labels over the queue slots
    this.queueLabels = QUEUE_SLOTS.map((s) => {
      const l = makeLabel(3);
      l.sprite.position.set(s.x, 4.2, s.z);
      l.sprite.visible = false;
      r.add(l.sprite);
      return l;
    });
    this.refreshStructure();
  }

  buildTerminal() {
    const t = new THREE.Group();
    t.add(mesh(rbox(1.2, 0.15, 1.2, 0.05, 1), mat(0x9aa3ad), { y: 0.08 }));
    t.add(mesh(rbox(0.9, 1.4, 0.6, 0.15, 2), mat(0x2f8cff), { y: 0.85 }));
    t.add(mesh(rbox(0.7, 0.5, 0.05, 0.02, 1), mat(0x0b2a40, { emissive: 0x39d0ff, ei: 0.9 }), { y: 1.15, z: -0.32, cast: false }));
    t.position.copy(this.terminalPos);
    t.userData.select = () => stationBuildingInfo(this);
    t.userData.focus = this.terminalPos.clone();
    this.root.add(t);
    this.selectables.push(t);
    // the Station Manager is opened by the floating "Open" button above the terminal (UIManager), not by a key
  }

  createCharger(bayId) {
    const g = new THREE.Group();
    const kind = this.station.charger.kind;
    const body = mesh(rbox(0.5, 1.7, 0.4, 0.14, 3), mat(0xf4f7fa, { rough: 0.4 }), { y: 0.95 });
    const head = mesh(rbox(0.52, 0.5, 0.42, 0.14, 3), mat(KIND_COLOR[kind], { rough: 0.35 }), { y: 1.55 });
    g.add(mesh(rbox(0.9, 0.12, 0.9, 0.05, 1), mat(0x9aa3ad), { y: 0.06, receive: true }), body, head);
    g.add(mesh(rbox(0.34, 0.26, 0.04, 0.02, 1), mat(0x0b2a40, { emissive: 0x39d0ff, ei: 0.9 }), { y: 1.55, z: -0.22, cast: false }));
    const bolt = new THREE.Shape();
    bolt.moveTo(0.04, 0.16); bolt.lineTo(-0.08, -0.02); bolt.lineTo(0, -0.02); bolt.lineTo(-0.04, -0.16); bolt.lineTo(0.08, 0.02); bolt.lineTo(0, 0.02); bolt.closePath();
    const bm = mesh(new THREE.ShapeGeometry(bolt), mat(0xffe34d, { emissive: 0xffd400, ei: 0.8 }), { y: 1.05, z: -0.205, cast: false });
    bm.rotation.y = Math.PI;
    g.add(bm);
    g.add(mesh(rbox(0.16, 0.3, 0.14, 0.05, 1), mat(0x2a2f36), { y: 0.8, z: -0.26 }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 32), new THREE.MeshBasicMaterial({ color: 0x39ffb0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    g.add(ring);
    g.userData.head = head;
    g.userData.ring = ring;
    g.userData.socket = new THREE.Vector3(0, 0.8, -0.36);
    g.userData.select = () => this.bayInfo(bayId);
    g.userData.focus = new THREE.Vector3(BAY_SLOTS[bayId], 0, 0);
    return g;
  }

  /** Show/hide chargers and ghosts according to unlocked bays and upgrade level. */
  /** Battery container + customer-hub props (store vending machines, coffee cart, lounge sofa). */
  buildExtras() {
    const r = this.root;
    // battery container (visible once storage is installed)
    this.batteryBox = new THREE.Group();
    this.batteryBox.add(mesh(rbox(4.6, 2.4, 2.4, 0.15, 2), mat(0xe9eef4, { rough: 0.5 }), { y: 1.2 }));
    this.batteryBox.add(mesh(rbox(4.7, 0.3, 2.5, 0.08, 1), mat(0x1f8a4c), { y: 2.1 }));
    this.batteryBox.add(mesh(rbox(1.6, 0.7, 0.05, 0.02, 1), mat(0x0b2a40, { emissive: 0x39ffb0, ei: 0.9 }), { x: 1.1, y: 1.1, z: 1.23, cast: false }));
    this.batteryBox.position.set(18.5, FLOOR, -19.5);
    this.batteryBox.visible = false;
    r.add(this.batteryBox);
    this.colliders.add(18.5, -19.5, 4.8, 2.6, 3);
    // hub props near the kiosk
    this.hubProps = { store: new THREE.Group(), coffee: new THREE.Group(), lounge: new THREE.Group() };
    for (const [i, col] of [0xe8483f, 0x2f8cff].entries()) {
      const v = mesh(rbox(1.0, 2.0, 0.9, 0.12, 2), mat(col), { x: -20.3 + i * 1.3, y: 1.0, z: -12.3 });
      this.hubProps.store.add(v, mesh(rbox(0.7, 0.9, 0.05, 0.02, 1), mat(0xbfe8ff, { emissive: 0x39d0ff, ei: 0.6 }), { x: -20.3 + i * 1.3, y: 1.3, z: -11.85, cast: false }));
    }
    const cart = new THREE.Group();
    cart.add(mesh(rbox(1.8, 1.0, 1.0, 0.12, 2), mat(0x8a5a35), { y: 0.5 }), mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), mat(0xdfe5ec), { y: 1.6 }), mesh(new THREE.ConeGeometry(1.5, 0.5, 8), mat(0xffc43d), { y: 2.8 }));
    cart.position.set(-17.5, FLOOR, -7.8);
    this.hubProps.coffee.add(cart);
    const sofa = new THREE.Group();
    sofa.add(mesh(rbox(2.6, 0.5, 1.0, 0.15, 2), mat(0x7a3bff), { y: 0.45 }), mesh(rbox(2.6, 0.7, 0.3, 0.12, 2), mat(0x7a3bff), { y: 0.9, z: -0.4 }), mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.3, 10), mat(0xf4f7fa), { x: 2.2, y: 0.2 }), mesh(new THREE.IcosahedronGeometry(0.5, 1), mat(0x3fae4a), { x: 2.2, y: 0.8 }));
    sofa.position.set(-8, FLOOR, -9.5);
    this.hubProps.lounge.add(sofa);
    for (const g of Object.values(this.hubProps)) { g.visible = false; r.add(g); }
  }

  applyExtras() {
    const st = this.station, lv = st.power?.levels;
    if (this.solar && lv) this.solar.children.forEach((p, i) => { p.visible = i < lv.solar * 3; });
    if (this.batteryBox) this.batteryBox.visible = !!lv && lv.storage > 0;
    if (this.hub && this.hubProps) for (const k of Object.keys(this.hubProps)) this.hubProps[k].visible = !!this.hub.built[k];
  }

  refreshStructure() {
    const st = this.station;
    st.bays.forEach((b, i) => {
      const v = this.bayVis[i];
      if (!v) return;
      v.charger.visible = b.unlocked;
      v.ghost.visible = !b.unlocked && this.mgmt;
      if (b.unlocked) v.charger.userData.head.material = mat(KIND_COLOR[st.charger.kind], { rough: 0.35 });
    });
    this.applyExtras();
  }

  setManagementMode(on) {
    this.mgmt = on;
    this.refreshStructure();
  }

  bayInfo(i) {
    const st = this.station, b = st.bays[i];
    const rows = [['Charger', `${st.charger.name} · ${st.charger.kw} kW`]];
    const actions = [];
    if (!b.unlocked) {
      const cost = st.cfg.bayCost;
      return {
        title: `Bay ${i + 1} (empty slot)`, subtitle: 'Not built yet',
        rows: [['Build cost', `$${cost.toLocaleString('en-US')}`], ['Adds', `+${st.charger.kw} kW capacity`]],
        actions: [{ label: `Build bay · $${cost.toLocaleString('en-US')}`, disabled: !this.economy.canAfford(cost), reason: needCash(this.economy, cost), cb: () => st.buyBay(i) }],
      };
    }
    rows.push(['Status', { empty: 'Free', reserved: 'Vehicle arriving', waiting: 'Vehicle waiting', charging: 'Charging', done: 'Complete' }[b.state]]);
    if (b.customer) {
      rows.push(['Customer', `${b.customer.def.icon} ${b.customer.def.label}`], ['Pays', `x${b.customer.def.payMult.toFixed(2)} · $${(st.pricePerKwh * b.customer.def.payMult).toFixed(2)}/kWh`]);
      if (b.state === 'waiting') rows.push(['Patience', `${Math.ceil(b.customer.patience)}s left`]);
    }
    if (b.vehicle && b.state !== 'reserved') {
      rows.push(['Vehicle', b.vehicle.label], ['Connector', b.vehicle.connector.toUpperCase()], ['Battery', `${Math.round(b.vehicle.soc * 100)}% of ${b.vehicle.capacityKwh} kWh`]);
      if (b.state === 'charging') rows.push(['Power', `${b.power.toFixed(0)} kW`], ['Delivered', `${b.delivered.toFixed(1)} kWh`]);
    }
    if (b.state === 'waiting') actions.push({ label: 'Start charging', cb: () => st.startCharging(i) });
    if (b.state === 'charging') actions.push({ label: 'Stop & bill', cb: () => st.stopCharging(i) });
    if (b.state === 'done' && !b.released) actions.push({ label: 'Unplug & send off', cb: () => st.release(i) });
    const nx = st.nextChargerUpgrade();
    if (nx) actions.push({ label: `Upgrade chargers → ${nx.name} · $${nx.cost.toLocaleString('en-US')}`, disabled: !this.economy.canAfford(nx.cost), reason: needCash(this.economy, nx.cost), cb: () => st.upgradeChargers() });
    return { title: `Bay ${i + 1}`, subtitle: 'Charging bay', rows, actions };
  }

  // ---------- vehicles ----------
  // Customer & visitor cars drive on the city road network (TrafficManager) and are handed to a local
  // PathFollower at the driveway; leaving cars merge back into the lane graph.
  acquireCar(style, color) {
    return this.traffic.acquire(style, color);
  }

  entryHead() {
    return [[-10.5, 27], [-12, 24.5]];
  }
  entryPath(bx) {
    return [...this.entryHead(), [-12, 13], [bx, 10], [bx, 5], [bx, 0.2]];
  }
  fromQueuePath(slot, bx) {
    return [[slot.x, 12.2], [bx, 10], [bx, 5], [bx, 0.2]];
  }
  queueEnterPath(slot) {
    return [...this.entryHead(), [-12, 21], [slot.x, 21], [slot.x, slot.z]];
  }
  exitTail() {
    // first two points: inside the lot (the last one is the waiting spot at the driveway mouth); last three: pull out onto the road
    return [[12, -13], [12, -21.5], [12, -24], [14.5, -27], [17, -27.2]];
  }
  exitPath(bx) {
    return [[bx, -3], [bx, -9], ...this.exitTail()];
  }
  queueLeavePath(slot) {
    return [[slot.x, 12], [12, 9], [12, -9], ...this.exitTail()];
  }
  /** Distance along the south-road lane edge where cars turn into the lot (x = -8). */
  get driveInS() {
    return this.road.driveIn.pts[0].x - -8;
  }
  /** Where leaving cars rejoin the north-road lane (x = 17). */
  get driveOutS() {
    return 17 - this.road.driveOut.pts[0].x;
  }

  adopt(rec, x, z, yaw, speed = 6) {
    const o = rec.obj;
    this.root.add(o);
    o.position.set(x, CAR_Y, z);
    o.rotation.y = yaw;
    rec.f = new PathFollower(o, { maxSpeed: 7.5, accel: 5, turnRate: 2.6 });
    rec.f.speed = speed;
    if (!this.movers.includes(rec)) this.movers.push(rec);
  }

  // ----- customers -----
  onCustomerSpawn({ customer: c }) {
    const v = c.vehicle;
    const obj = this.traffic.acquire(v.type, v.color);
    obj.visible = false;
    setCarDirt(obj, v.dirt ?? 0);
    const rec = { obj, kind: 'customer', customer: c, vehicle: v, state: 'driving', freed: false, f: null, bayId: null, slot: null };
    this.custRecs.set(c.id, rec);
    this.traffic.requestCustomer(obj, {
      kind: 'customer', fast: !!c.fast,
      handoffS: this.driveInS,
      cb: (o, x, z, yaw) => {
        const d = this.customers.arrived(c); // station decides: bay / queue / turn away
        if (d.action === 'leave') {
          this.custRecs.delete(c.id);
          return false;
        }
        this.adopt(rec, x, z, yaw);
        if (d.action === 'bay') this.driveToBay(rec, d.bayId, true);
        else {
          rec.state = 'queueing';
          rec.slot = d.slot;
          rec.f.setPath(this.queueEnterPath(d.slot).map(([px, pz]) => new THREE.Vector3(px, CAR_Y, pz)));
          rec.f.onDone = () => { rec.state = 'queued'; this.parking.setOccupied(d.slot, true); };
        }
        return true;
      },
    });
  }

  driveToBay(rec, bayId, fromEntry) {
    const bx = BAY_SLOTS[bayId];
    rec.bayId = bayId;
    rec.state = 'arriving';
    this.cars.set(bayId, rec);
    const path = fromEntry ? this.entryPath(bx) : this.fromQueuePath(rec.slot, bx);
    rec.f.maxSpeed = 7.5;
    rec.f.setPath(path.map(([px, pz]) => new THREE.Vector3(px, CAR_Y, pz)));
    rec.f.onDone = () => {
      rec.state = 'parked';
      this.station.vehicleParked(bayId);
      this.customers.parkedAtBay(rec.customer);
    };
  }

  onCustomerAssigned({ customer: c, bayId }) {
    const rec = this.custRecs.get(c.id);
    if (!rec || !rec.f) return;
    this.driveToBay(rec, bayId, false);
  }

  onCustomerLeft({ customer: c, from }) {
    const rec = this.custRecs.get(c.id);
    if (!rec || !rec.f) return;
    if (from === 'queue') this.sendOut(rec, this.queueLeavePath(rec.slot || QUEUE_SLOTS[0]));
    // from 'waiting': the station already emitted vehicle:depart for the bay
  }

  onDepart({ bayId }) {
    const rec = this.cars.get(bayId);
    if (!rec || !rec.f) { this.station.vehicleLeft(bayId); return; }
    this.disconnectCable(bayId);
    this.sendOut(rec, this.exitPath(BAY_SLOTS[bayId]));
  }

  /** Drive a parked car out along `path` and merge it into the north-road lane. */
  sendOut(rec, path) {
    rec.state = 'leaving';
    rec.f.maxSpeed = 7;
    // wait at the driveway mouth (off the lane); only pull out when the lane has room, so cars never stand in live traffic
    const n = 3;
    rec.tail = path.slice(path.length - n);
    rec.f.setPath(path.slice(0, path.length - n).map(([x, z]) => new THREE.Vector3(x, CAR_Y, z)));
    rec.f.onDone = () => { rec.state = 'holding'; };
  }

  // ---------- visitors (parking row) ----------
  initVisitors() {
    for (let i = 0; i < 2; i++) {
      const v = this.makeVisitor();
      if (!v) break;
      const o = v.obj;
      this.root.add(o);
      o.position.set(v.space.x, CAR_Y, v.space.z);
      o.rotation.y = 0;
      v.f = new PathFollower(o, {});
      v.f.done = true;
      v.state = 'parked';
      v.timer = 8 + Math.random() * 25;
      this.parking.setOccupied(v.space, true);
      this.movers.push(v);
    }
  }

  makeVisitor() {
    const id = `visitor${Math.random().toString(36).slice(2, 8)}`;
    const space = this.parking.reserve('station-row', id);
    if (!space) return null;
    const obj = this.traffic.randomCar();
    obj.visible = false;
    const v = { obj, kind: 'visitor', id, space, state: 'driving', timer: 0, f: null };
    this.visitors.push(v);
    return v;
  }

  spawnVisitor() {
    const v = this.makeVisitor();
    if (!v) return;
    this.traffic.requestCustomer(v.obj, {
      kind: 'visitor',
      handoffS: this.driveInS,
      cb: (o, x, z, yaw) => {
        this.adopt(v, x, z, yaw);
        v.state = 'arriving';
        v.f.setPath([...this.entryHead(), [-12, 21], [v.space.x, 20.2], [v.space.x, v.space.z]].map(([px, pz]) => new THREE.Vector3(px, CAR_Y, pz)));
        v.f.onDone = () => {
          v.state = 'parked';
          v.timer = 15 + Math.random() * 25;
          this.parking.setOccupied(v.space, true);
        };
      },
    });
  }

  updateVisitors(dt) {
    this.visitorTimer -= dt;
    if (this.visitorTimer <= 0) {
      this.visitorTimer = 25 + Math.random() * 20;
      if (this.visitors.length < 3) this.spawnVisitor();
    }
    for (const v of this.visitors) {
      if (v.state === 'parked') {
        v.timer -= dt;
        if (v.timer <= 0) this.sendOut(v, [[v.space.x, 11], [12, 8], [12, -9], ...this.exitTail()]);
      } else if (v.state === 'leaving' && v.space && v.obj.position.z < 12) {
        this.parking.release(v.space, v.id); // car has pulled out of the space
        v.space = null;
      }
    }
  }

  /** Simple local avoidance for lot vehicles: hold if another car is right ahead. */
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
        if (n.state === 'merging' || n.state === 'holding' || n.state === 'pulling' || n.state === 'leaving') hard = true; // a car waiting to rejoin the road will move on: queue behind it
      }
      // a car pulling out to the road (or waiting at its edge) also stops short of road cars standing or driving in its way
      if (m.state === 'pulling' || m.state === 'merging') {
        for (const a of this.traffic.agents) {
          if (a.obj === m.obj || !a.obj.visible) continue;
          const t = probe(m, { obj: a.obj });
          if (t === Infinity) continue;
          gap = Math.min(gap, t - 0.4); hard = true;
        }
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
      // a queued car that has pulled out of its slot frees it for the next arrival
      if (m.kind === 'customer' && m.slot && m.state !== 'queueing' && m.state !== 'queued' && m.obj.position.z < 13.5) {
        this.customers.releaseSlot(m.customer);
        m.slot = null;
      }
      if (m.state === 'holding' && m.tail && !this.movers.some((x) => x !== m && (x.state === 'pulling' || x.state === 'merging')) && this.traffic.canMerge(m.obj, this.road.driveOut, this.driveOutS, true)) {
        m.state = 'pulling'; m.f.maxSpeed = 6;
        m.f.setPath(m.tail.map(([x, z]) => new THREE.Vector3(x, CAR_Y, z)));
        m.f.onDone = () => { m.state = 'merging'; };
        m.tail = null;
      }
      if (m.state === 'merging' && this.traffic.merge(m.obj, this.road.driveOut, this.driveOutS)) {
        this.movers.splice(this.movers.indexOf(m), 1);
        if (m.kind === 'customer') {
          this.custRecs.delete(m.customer.id);
          if (m.slot) { this.customers.releaseSlot(m.customer); m.slot = null; }
          if (m.bayId !== null && this.cars.get(m.bayId) === m) this.cars.delete(m.bayId);
        } else {
          this.visitors.splice(this.visitors.indexOf(m), 1);
          if (m.space) { this.parking.release(m.space, m.id); m.space = null; }
        }
      }
    }
    this.updateVisitors(dt);
  }

  // ---------- cable ----------
  connectCable(bayId) {
    const v = this.bayVis[bayId], rec = this.cars.get(bayId);
    if (!v || !rec) return;
    this.disconnectCable(bayId);
    const a = v.charger.localToWorld(v.charger.userData.socket.clone());
    // car port sits on the side of the car facing the charger
    const p = new THREE.Vector3(v.side * rec.obj.userData.width * 0.5, rec.obj.userData.portY, 0.5);
    rec.obj.updateMatrixWorld(true);
    const b = rec.obj.localToWorld(p);
    const mid = a.clone().lerp(b, 0.5); mid.y = Math.min(a.y, b.y) - 0.35;
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5), mid, mid.clone().lerp(b, 0.5), b]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.045, 6, false), new THREE.MeshStandardMaterial({ color: 0x20262d, emissive: 0x39ffb0, emissiveIntensity: 0.35, roughness: 0.5 }));
    cable.castShadow = true;
    this.root.add(cable);
    v.cable = cable;
  }
  disconnectCable(bayId) {
    const v = this.bayVis[bayId];
    if (v?.cable) {
      this.root.remove(v.cable);
      v.cable.geometry.dispose();
      v.cable.material.dispose();
      v.cable = null;
    }
  }

  // ---------- per-frame ----------
  update(dt, playerPos) {
    this.time += dt;
    this.updateVehicles(dt);
    for (const [bayId, rec] of this.cars) {
      if ((rec.state === 'leaving' || rec.state === 'holding' || rec.state === 'pulling' || rec.state === 'merging') && !rec.freed && rec.obj.position.z < -8) {
        rec.freed = true;
        this.station.vehicleLeft(bayId);
      }
    }
    // fade the canopy roof away in management mode so bays stay visible from above
    const under = Math.abs(playerPos.x) < 22 && playerPos.z > -9 && playerPos.z < 9;
    const roofTarget = this.mgmt ? 0 : under ? 0.12 : 1;
    this.roofOpacity += (roofTarget - this.roofOpacity) * Math.min(1, dt * 5);
    const ro = Math.abs(roofTarget - this.roofOpacity) < 0.02 ? roofTarget : this.roofOpacity;
    for (const m of this.roofMats) m.opacity = ro;
    for (const p of this.roofParts) { p.visible = ro > 0.01; p.castShadow = ro > 0.6; }
    this.solar.visible = (this.station.power?.levels.solar || 0) > 0 && ro > 0.01;
    this.labelTimer -= dt;
    const refreshLabels = this.labelTimer <= 0;
    if (refreshLabels) this.labelTimer = 0.2;
    this.station.bays.forEach((b, i) => {
      const v = this.bayVis[i];
      if (b.state === 'charging') {
        v.ringT += dt;
        v.charger.userData.ring.material.opacity = 0.35 + Math.sin(v.ringT * 5) * 0.25;
        if (v.cable) v.cable.material.emissiveIntensity = 0.4 + Math.sin(v.ringT * 6) * 0.3;
      } else v.charger.userData.ring.material.opacity = b.state === 'waiting' ? 0.5 + Math.sin(this.time * 3) * 0.2 : 0;
      // keep labels readable at isometric zoom levels
      const ls = this.mgmt ? Math.min(4, Math.max(1, this.mgFactor * 1.3)) * 3.4 : 3.4;
      v.label.sprite.scale.set(ls, ls * (96 / 256), 1);
      v.label.sprite.visible = b.unlocked && (b.state === 'charging' || b.state === 'waiting' || (this.mgmt && b.state !== 'reserved'));
      if (refreshLabels && v.label.sprite.visible) {
        const cu = b.customer, ic = cu ? cu.def.icon : '';
        if (b.state === 'charging') v.label.draw({ title: `${ic} ${Math.round(b.vehicle.soc * 100)}% ⚡ ${b.power.toFixed(0)} kW`, sub: `${cu ? cu.def.label : ''} · ${b.delivered.toFixed(1)} kWh`, pct: b.vehicle.soc, color: '#1f8a4c' });
        else if (b.state === 'waiting' && cu) {
          const pf = Math.max(0, cu.patience / cu.maxPatience);
          v.label.draw({ title: `${this.customers.mood(cu)} ${ic} ${cu.def.label}`, sub: `${Math.round(b.vehicle.soc * 100)}% · ${Math.ceil(cu.patience)}s patience`, pct: pf, color: pf > 0.6 ? '#1f8a4c' : pf > 0.3 ? '#e8a21c' : '#d6453d' });
        }
        else if (b.state === 'done') v.label.draw({ title: b.released ? 'Complete' : 'Charged ✓', sub: b.released ? 'Paid · leaving' : 'Paid · needs unplugging', color: b.released ? '#2f8cff' : '#e8a21c' });
        else v.label.draw({ title: `Bay ${i + 1}`, sub: 'Free', color: '#9aa3ad' });
      }
      v.ghost.children[1].material.opacity = 1;
      const pulse = 0.18 + Math.sin(this.time * 2.5) * 0.08;
      v.ghost.children[0].material.opacity = pulse;
    });
    // queue labels: who is waiting and how patient they still are
    QUEUE_SLOTS.forEach((slot, i) => {
      const ql = this.queueLabels[i];
      const c = this.customers.queue.find((q) => q.slot && q.slot.index === i);
      const rec = c && this.custRecs.get(c.id);
      const show = !!c && rec && rec.state === 'queued';
      ql.sprite.visible = show;
      const qs = this.mgmt ? Math.min(4, Math.max(1, this.mgFactor * 1.3)) * 3 : 3;
      ql.sprite.scale.set(qs, qs * (96 / 256), 1);
      if (show && refreshLabels) {
        const pf = Math.max(0, c.patience / c.maxPatience);
        ql.draw({ title: `${this.customers.mood(c)} ${c.def.icon} ${c.def.label}`, sub: `${c.vehicle.label} · ${Math.ceil(c.patience)}s`, pct: pf, color: pf > 0.6 ? '#1f8a4c' : pf > 0.3 ? '#e8a21c' : '#d6453d' });
      }
    });
    void playerPos;
  }
}

