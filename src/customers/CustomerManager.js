/**
 * Customer simulation (no Three.js).
 *
 * Workflow: SPAWN -> SELECT SERVICE -> NAVIGATE -> JOIN QUEUE / BAY -> RECEIVE SERVICE -> PAY -> EXIT
 *   states: navigate -> queue | assigned -> waiting -> charging -> paid           (or left)
 *
 * Customers decide before they come (connector support, price vs tolerance, fast charger, queue length)
 * and react while waiting (patience). Satisfaction at payment depends on wait, price, charger speed and
 * service type; it drives tips and reputation; reputation feeds back into demand and unlocks customer types.
 */
import { randomDirt, randomCondition } from '../vehicles/VehicleState.js';
import { HAPPY_SCORE } from '../progression/StatsTracker.js';

let seq = 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const QUEUE_SLOTS = [{ x: -8.5, z: 17, yaw: 0 }, { x: -4, z: 17, yaw: 0 }, { x: 0.5, z: 17, yaw: 0 }];

export class CustomerManager {
  constructor({ bus, economy, station, parking, config, vehicleDefs, getHour, saved = null }) {
    this.bus = bus;
    this.economy = economy;
    this.station = station;
    this.parking = parking;
    this.cfg = config;
    this.vehicleDefs = vehicleDefs;
    this.getHour = getHour || (() => 12);
    this.time = 0;
    this.timer = 1.5;
    this.customers = new Map();
    this.queue = []; // customers waiting for a bay (parked in queue slots)
    this.maxQueue = Math.min(config.maxQueue, QUEUE_SLOTS.length);
    this.enabled = true;
    this.satisfactionBonus = () => 0; // set by the game: cashier bonus
    this.getStage = () => 4; // progression stage (VIP customers need stage 4)
    this.fleetBoost = () => 1; // active fleet contracts make fleet customers more common
    this.patienceMult = () => 1; // customer lounge
    this.hubBonus = () => 0; // lounge / coffee satisfaction
    this.decorBonus = () => 0; // placed benches etc.
    this.decorDemand = () => 1; // placed trees / banners / lamps
    this.stats = saved?.stats || { spawned: 0, served: 0, lost: 0, lostBy: {}, satSum: 0, satN: 0, happy: 0, angry: 0, tips: 0 };
    parking.addLot('station-queue', QUEUE_SLOTS);
    bus.on('station:bay-free', () => this.assignFromQueue());
    bus.on('charging:start', ({ customer }) => this.onChargingStart(customer));
    bus.on('charging:complete', (e) => this.onPaid(e));
  }

  // ---------- demand ----------
  get active() {
    return this.customers.size;
  }

  /** Arrival interval in seconds: price, reputation and time of day shape demand. */
  arrivalInterval() {
    const [lo, hi] = this.cfg.baseArrivalSeconds;
    let t = lo + Math.random() * (hi - lo);
    const price = this.station.pricePerKwh, fair = this.cfg.fairPricePerKwh;
    t *= 1 + Math.max(0, price - fair) * 4; // expensive -> fewer customers
    t /= (1 + this.economy.reputation / 150) * this.decorDemand(); // good reputation + attractive lot -> more customers
    const h = this.getHour();
    if ((h >= 7 && h < 9.5) || (h >= 16.5 && h < 19)) t *= 0.65; // rush hours
    else if (h >= 23 || h < 5) t *= 2; // night
    return t;
  }

  pickType() {
    const rep = this.economy.reputation;
    const boost = this.fleetBoost();
    const entries = Object.entries(this.cfg.types)
      .filter(([k, d]) => (rep >= d.minRep || (k === 'fleet' && boost > 1)) && (k !== 'vip' || this.getStage() >= 4))
      .map(([k, d]) => [k, d, k === 'fleet' ? d.weight * boost : d.weight]);
    const total = entries.reduce((s, [, , w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [k, , w] of entries) if ((r -= w) <= 0) return k;
    return entries[0][0];
  }

  weighted(obj) {
    const e = Object.entries(obj);
    let r = Math.random() * e.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of e) if ((r -= w) <= 0) return k;
    return e[0][0];
  }

  makeVehicle(def) {
    const type = this.weighted(def.vehicles);
    const vd = this.vehicleDefs[type];
    const soc = def.socMin + Math.random() * (def.socMax - def.socMin);
    const [t0, t1] = def.target;
    return {
      id: `v${++seq}_${Date.now().toString(36)}`, type, label: vd.label,
      color: Number(vd.colors[Math.floor(Math.random() * vd.colors.length)]),
      capacityKwh: vd.capacityKwh, maxChargeKw: vd.maxChargeKw, connector: this.weighted(vd.connectors),
      soc, startSoc: soc, targetSoc: Math.max(soc + 0.05, t0 + Math.random() * (t1 - t0)),
      dirt: randomDirt(), condition: randomCondition(),
    };
  }

  update(dt) {
    this.time += dt;
    this.timer -= dt;
    if (this.enabled && this.timer <= 0) {
      this.timer = this.arrivalInterval();
      if (this.active < this.cfg.maxActiveCustomers) this.spawn();
    }
    // patience only runs while the customer is waiting in the queue or at an uncharged bay
    for (const c of [...this.customers.values()]) {
      if (c.state !== 'queue' && c.state !== 'waiting') continue;
      c.patience -= dt;
      if (c.patience <= 0) this.giveUp(c);
    }
    if (this.queue.length && this.station.freeBays) this.assignFromQueue();
  }

  createCustomer(typeKey) {
    const def = this.cfg.types[typeKey];
    return {
      id: `c${++seq}`, type: typeKey, def, vehicle: this.makeVehicle(def), state: 'navigate', patience: def.patience * this.patienceMult(), maxPatience: def.patience * this.patienceMult(),
      spawnedAt: this.time, arrivedAt: 0, waitTime: 0, satisfaction: null, slot: null, bayId: null,
    };
  }

  /** SELECT SERVICE: would this customer come to the station? Returns a reason to stay away, or null. Pure. */
  checkService(c, rnd = Math.random()) {
    const st = this.station, def = c.def, vehicle = c.vehicle;
    if (!st.supports(vehicle.connector)) return `no ${vehicle.connector.toUpperCase()} connector`;
    if (st.pricePerKwh > def.priceTolerance) return 'too expensive';
    if (st.charger.kw < def.minKw) return 'no fast charger';
    if (!st.freeBays && this.queue.length >= this.maxQueue && rnd < 0.7) return 'station busy';
    return null;
  }

  /** Create a customer. Returns the customer, or null if they decide not to come. */
  spawn(forceType = null) {
    const first = !forceType && this.stats.spawned === 0; // the very first customer of a new game: always a regular, always compatible, and starts close so the player is not left waiting
    const c = this.createCustomer(first ? 'regular' : forceType || this.pickType());
    if (first) { c.fast = true; c.vehicle.connector = this.station.charger.connectors[0]; }
    this.stats.spawned++;
    const reason = this.checkService(c);
    if (reason) {
      this.lose(c, reason, false);
      return null;
    }
    this.customers.set(c.id, c);
    this.bus.emit('customer:spawn', { customer: c });
    return c;
  }

  lose(c, reason, angry) {
    this.stats.lost++;
    this.stats.lostBy[reason] = (this.stats.lostBy[reason] || 0) + 1;
    if (angry) this.economy.changeReputation(-2, `${c.def.label} left unserved`);
    this.bus.emit('customer:lost', { customer: c, reason, angry });
  }

  // ---------- arrival at the station driveway ----------
  /** Called by the view when the vehicle reaches the driveway. Returns the decision. */
  arrived(c) {
    c.arrivedAt = this.time;
    this.assignFromQueue(); // queued customers get free bays first
    const bay = this.station.freeBays ? this.station.reserveBay(c) : null;
    if (bay) {
      c.state = 'assigned';
      c.bayId = bay.id;
      return { action: 'bay', bayId: bay.id };
    }
    const slot = this.queue.length < this.maxQueue ? this.parking.reserve('station-queue', c.id) : null;
    if (slot) {
      c.state = 'queue';
      c.slot = slot;
      this.queue.push(c);
      this.bus.emit('customer:queued', { customer: c });
      return { action: 'queue', slot };
    }
    this.customers.delete(c.id);
    this.lose(c, 'queue full', false); // turned away at the door: lost sale, but no reputation hit
    return { action: 'leave', reason: 'queue full' };
  }

  /** Pick the next queued customer (highest priority first, then longest waiting) for any free bay. */
  assignFromQueue() {
    while (this.queue.length && this.station.freeBays) {
      const next = this.queue.reduce((best, c) => (!best || c.def.priority > best.def.priority || (c.def.priority === best.def.priority && c.arrivedAt < best.arrivedAt) ? c : best), null);
      const bay = this.station.reserveBay(next);
      if (!bay) break;
      this.queue.splice(this.queue.indexOf(next), 1);
      next.state = 'assigned';
      next.bayId = bay.id;
      this.bus.emit('customer:assigned', { customer: next, bayId: bay.id });
    }
  }

  /** View reports the car pulled out of its queue slot. */
  releaseSlot(c) {
    if (c.slot) {
      this.parking.release(c.slot, c.id);
      c.slot = null;
    }
  }

  parkedAtBay(c) {
    if (c.state === 'assigned') c.state = 'waiting';
  }

  giveUp(c) {
    const from = c.state;
    this.customers.delete(c.id);
    if (from === 'queue') this.queue.splice(this.queue.indexOf(c), 1);
    this.lose(c, 'waited too long', true);
    this.stats.angry++;
    c.state = 'left';
    this.bus.emit('customer:left', { customer: c, from, reason: 'patience' });
    if (from === 'waiting') this.station.abandon(c.bayId);
  }

  // ---------- service & payment ----------
  onChargingStart(c) {
    if (!c) return;
    c.state = 'charging';
    c.waitTime = this.time - c.arrivedAt;
  }

  /** satisfaction 0..100 from wait, price, charger speed and urgency. */
  rate(c, unitPrice) {
    const wait = clamp(1 - c.waitTime / c.maxPatience, 0, 1);
    let s = 45 + 35 * wait;
    const tol = c.def.priceTolerance;
    s += 18 * clamp((tol - this.station.pricePerKwh) / tol, -0.6, 0.6);
    if (this.station.charger.kw >= 50) s += 8;
    if (c.type === 'emergency' && c.waitTime < 12) s += 12;
    if (c.type === 'premium' || c.type === 'vip') s += this.station.charger.kw >= 150 ? 6 : 0;
    s += this.satisfactionBonus() + this.hubBonus(c) + this.decorBonus(); // cashier on duty + lounge / coffee + decorations
    void unitPrice;
    return Math.round(clamp(s, 0, 100));
  }

  onPaid({ customer: c, revenue, unitPrice }) {
    if (!c || !this.customers.has(c.id)) return;
    this.customers.delete(c.id);
    c.state = 'paid';
    c.satisfaction = this.rate(c, unitPrice);
    let tip = 0;
    if (c.satisfaction >= HAPPY_SCORE) {
      tip = Math.round(revenue * 0.12 * 100) / 100;
      if (tip > 0 && this.economy.earn(tip, 'tips', `tip:${c.id}`)) this.stats.tips += tip;
    }
    if (c.satisfaction >= 80) { this.economy.changeReputation(c.def.repGain, 'happy customer'); }
    if (c.satisfaction >= HAPPY_SCORE) this.stats.happy++;
    if (c.satisfaction < 40) { this.economy.changeReputation(-1, 'unhappy customer'); this.stats.angry++; }
    this.stats.served++;
    this.stats.satSum += c.satisfaction;
    this.stats.satN++;
    this.bus.emit('customer:paid', { customer: c, satisfaction: c.satisfaction, tip, revenue });
  }

  mood(c) {
    const p = c.patience / c.maxPatience;
    return p > 0.6 ? '😀' : p > 0.3 ? '😐' : '😠';
  }

  get avgSatisfaction() {
    return this.stats.satN ? this.stats.satSum / this.stats.satN : null;
  }

  serialize() {
    return { stats: this.stats };
  }
}
