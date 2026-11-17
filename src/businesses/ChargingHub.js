import { ServiceBusiness } from './ServiceBusiness.js';
import { randomDirt, randomCondition } from '../vehicles/VehicleState.js';

/**
 * Satellite charging hub on a purchased lot (small lot, commercial hub, fleet depot, highway hub).
 * Same customer workflow as the other drive-in lots (spawn, decide, queue, patience, pay) but the service is
 * charging: an attendant plugs the car in (staffed task), then energy flows by the same physics as the home
 * station (power, taper, efficiency), billed per kWh at the hub's own price and tariff-metered electricity.
 *
 * bay states: empty -> reserved -> waiting -> charging -> done -> empty
 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const EFFICIENCY = 0.93;
const CONNECT_SECONDS = 5;

export class ChargingHub extends ServiceBusiness {
  constructor(o) {
    const h = o.hubCfg;
    const cfg = {
      label: h.label, icon: h.icon, dept: `hub_${o.key}`, revenueKey: h.revenueKey, buildCost: h.price, minRep: h.minRep || 0, stage: h.stage,
      maxBays: 3, bayCosts: h.bayCosts, maxQueue: h.maxQueue, upkeepPerBayPerDay: h.upkeepPerBayPerDay, arrivalSeconds: h.arrivalSeconds,
      customerTypes: h.customerTypes, buildCategory: 'property',
    };
    super({ ...o, id: `hub_${o.key}`, cfg, saved: o.saved });
    const s = o.saved || {};
    this.key = o.key;
    this.hub = h;
    this.simScale = o.simScale;
    this.getTariff = o.getTariff || (() => 0.18);
    this.districtOk = () => true; // set by the game (district permit)
    this.chargerLevel = s.chargerLevel || 0;
    this.price = s.price ?? h.pricePerKwh;
    this.pendingCost = 0;
    this.flushT = 0;
    const unlocked = s.bays || h.startBays;
    this.bays = Array.from({ length: cfg.maxBays }, (_, i) => ({
      id: i, unlocked: i < unlocked, state: 'empty', customer: null, vehicle: null, space: null, job: null, progress: 0, released: false, delivered: 0, power: 0,
    }));
    this.initParking();
  }

  get charger() { return this.hub.chargers[this.chargerLevel]; }
  get fairPrice() { return this.custCfg.fairPricePerKwh; }
  supports(connector) { return this.charger.connectors.includes(connector); }

  canBuild(rep) {
    const c = super.canBuild(rep);
    if (!c.ok) return c;
    if (!this.districtOk()) return { ok: false, reason: 'Unlock the district first', districtLocked: true };
    return c;
  }

  setPrice(p) {
    if (!Number.isFinite(p)) return;
    this.price = Math.round(clamp(p, 0.2, 1.6) * 100) / 100;
    this.emit('changed');
  }

  // ---------- customers ----------
  pickType() {
    const rep = this.economy.reputation, boost = this.fleetBoost();
    const entries = Object.entries(this.hub.demandTypes)
      .filter(([k]) => { const d = this.custCfg.types[k]; return d && (rep >= d.minRep || (k === 'fleet' && boost > 1)) && (k !== 'vip' || this.getStage() >= 4); })
      .map(([k, w]) => [k, k === 'fleet' ? w * boost : w]);
    if (!entries.length) return 'regular';
    let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of entries) if ((r -= w) <= 0) return k;
    return entries[0][0];
  }

  makeVehicle(def) {
    const type = this.weighted(def.vehicles);
    const vd = this.vehicleDefs[type];
    const soc = def.socMin + Math.random() * (def.socMax - def.socMin);
    const [t0, t1] = def.target;
    return {
      id: `hv${Math.random().toString(36).slice(2, 9)}`, type, label: vd.label, color: Number(vd.colors[Math.floor(Math.random() * vd.colors.length)]),
      capacityKwh: vd.capacityKwh, maxChargeKw: vd.maxChargeKw, connector: this.weighted(vd.connectors),
      soc, startSoc: soc, targetSoc: Math.max(soc + 0.05, t0 + Math.random() * (t1 - t0)), dirt: randomDirt(), condition: randomCondition(),
    };
  }

  chooseService(c) {
    if (!this.supports(c.vehicle.connector)) return { service: null, reason: `no ${c.vehicle.connector.toUpperCase()} connector` };
    if (this.charger.kw < c.def.minKw) return { service: null, reason: 'no fast charger' };
    return { service: 'charge' };
  }
  priceFor() { return this.price; }
  priceMultiplier() { return this.price / this.fairPrice; }

  // ---------- jobs ----------
  onParked(bay) {
    bay.job = { phase: 'connect' };
    bay.progress = 0;
  }

  publishTasks() {
    if (!this.layout) return;
    for (const b of this.bays) {
      if (!b.unlocked || b.state !== 'waiting' || !b.customer) continue;
      const c = b.customer, cid = c.id, id = b.id;
      this.tasks.publish({
        key: `connect:${this.id}:${id}:${cid}`, type: 'connect', dept: this.id, priority: 10 * c.def.priority + 5,
        pos: this.layout.stand(id), face: this.layout.face(id), base: CONNECT_SECONDS,
        valid: () => this.bays[id].customer?.id === cid && this.bays[id].state === 'waiting',
        run: () => this.startCharging(id),
      });
    }
  }

  startCharging(id) {
    const b = this.bays[id];
    if (!b || b.state !== 'waiting') return false;
    b.state = 'charging';
    b.delivered = 0;
    b.customer.state = 'charging';
    b.customer.waitTime = this.time - b.customer.arrivedAt;
    const r = this.hub.retail;
    if (r && Math.random() < r.chance * (this.emp.satisfactionBonus > 0 ? 1.25 : 1)) {
      const amount = Math.round((r.spend[0] + Math.random() * (r.spend[1] - r.spend[0])) * 100) / 100;
      this.economy.earn(amount, r.key, `retail:${this.id}:${b.customer.id}`);
    }
    this.emit('charging', { bayId: id, customer: b.customer });
    this.emit('changed');
    return true;
  }

  tickBays(dt) {
    const hours = (dt * this.simScale) / 3600;
    for (const b of this.bays) {
      if (b.state !== 'charging') continue;
      const v = b.vehicle;
      const kw = Math.min(this.charger.kw, v.maxChargeKw) * (v.soc > 0.8 ? 1 - 0.75 * ((v.soc - 0.8) / 0.2) : 1);
      let e = kw * hours;
      const remaining = v.capacityKwh * (v.targetSoc - v.soc);
      if (e >= remaining) e = Math.max(0, remaining);
      v.soc += e / v.capacityKwh;
      b.delivered += e;
      b.power = kw;
      b.progress = clamp((v.soc - v.startSoc) / Math.max(0.01, v.targetSoc - v.startSoc), 0, 1);
      this.pendingCost += (e / EFFICIENCY) * this.getTariff();
      if (v.soc >= v.targetSoc - 1e-6) this.finishCharge(b);
    }
    this.flushT += dt;
    if (this.flushT > 4) this.flush();
  }

  flush() {
    this.flushT = 0;
    if (this.pendingCost > 0.005) { this.economy.expense(this.pendingCost, 'electricity'); this.pendingCost = 0; }
  }

  finishCharge(b) {
    const c = b.customer;
    this.flush();
    b.power = 0;
    const speedBonus = this.charger.kw >= 100 ? 0.2 : this.charger.kw >= 50 ? 0.1 : 0;
    this.settle(b, { price: b.delivered * this.price, quality: 0.7 + speedBonus, label: 'charge' });
    this.emit('charged', { customer: c, kwh: b.delivered });
  }

  // ---------- upgrades ----------
  nextBayCost() { return this.unlockedBays < this.bays.length ? this.hub.bayCosts[this.unlockedBays] : null; }
  addBay() {
    const cost = this.nextBayCost();
    if (cost === null || !this.built || !this.economy.spend(cost, 'equipment')) return false;
    this.bays[this.unlockedBays].unlocked = true;
    this.syncParking();
    this.emit('upgraded', { what: 'bay' });
    this.emit('changed');
    this.emit('bay-free');
    return true;
  }
  nextCharger() { return this.hub.chargers[this.chargerLevel + 1] || null; }
  chargerLock() {
    const n = this.nextCharger();
    if (!n) return 'Fully upgraded';
    if (n.stage > this.getStage()) return `Unlocks at Stage ${n.stage}`;
    return null;
  }
  upgradeCharger() {
    const n = this.nextCharger();
    if (!n || !this.built || this.chargerLock() || !this.economy.spend(n.cost, 'equipment')) return false;
    this.chargerLevel++;
    this.emit('upgraded', { what: 'chargers' });
    this.emit('changed');
    return true;
  }

  serialize() {
    return { built: this.built, chargerLevel: this.chargerLevel, price: this.price, bays: this.unlockedBays, stats: this.stats };
  }
}
