import { randomDirt, randomCondition } from '../vehicles/VehicleState.js';

/**
 * Shared simulation for drive-in service businesses (car wash, garage). Pure logic, no Three.js.
 *
 * Customer workflow:  SPAWN -> SELECT SERVICE -> NAVIGATE -> JOIN QUEUE / BAY -> SERVICE -> PAY -> EXIT
 * Bay lifecycle:      empty -> reserved -> waiting -> (subclass work states) -> done -> empty
 * Customers lose patience while queued / waiting / blocked and leave angry (reputation -2).
 * Payment goes through EconomyManager once (txId), satisfaction drives tips and reputation.
 * Subclasses provide: chooseService, priceFor, publishTasks, tickBays, serialize.
 */
let seq = 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const WAITING_STATES = ['queue', 'waiting', 'blocked'];

export class ServiceBusiness {
  constructor({ id, bus, economy, parking, cfg, custCfg, tasks, getEmployees, vehicleDefs, getHour, saved }) {
    Object.assign(this, { id, bus, economy, parking, cfg, custCfg, tasks, getEmployees, vehicleDefs });
    this.getHour = getHour || (() => 12);
    this.built = !!saved?.built;
    this.time = 0;
    this.timer = 10;
    this.enabled = true;
    this.customers = new Map();
    this.queue = [];
    this.maxQueue = cfg.maxQueue;
    this.pending = []; // scheduled referral customers
    this.layout = null; // set by the view: {stand(bayId), face(bayId)} in world coordinates
    this.getStage = () => 4; // progression stage (set by the game)
    this.fleetBoost = () => 1; // active fleet contracts
    this.patienceMult = () => 1; // customer lounge
    this.hubBonus = () => 0;
    this.decorBonus = () => 0; // placed benches etc.: satisfaction for waiting customers
    this.decorDemand = () => 1; // placed trees / banners / lamps: more arrivals
    this.stats = saved?.stats || { served: 0, lost: 0, lostBy: {}, revenue: 0, satSum: 0, satN: 0, tips: 0, referrals: 0 };
    this.bays = [];
  }

  get emp() {
    return this.getEmployees();
  }
  /** Call from the subclass constructor once `this.bays` exists. */
  initParking() {
    this.parking.addLot(`${this.id}-bays`, this.bays.map(() => ({ x: 0, z: 0 })));
    this.parking.addLot(`${this.id}-queue`, Array.from({ length: this.maxQueue }, () => ({ x: 0, z: 0 })));
    this.syncParking();
  }
  syncParking() {
    const sp = this.parking.spaces(`${this.id}-bays`);
    this.bays.forEach((b, i) => { sp[i].enabled = this.built && b.unlocked; });
  }
  emit(name, payload = {}) {
    this.bus.emit(`svc:${name}`, { biz: this.id, ...payload });
  }

  get unlockedBays() {
    return this.bays.filter((b) => b.unlocked).length;
  }
  get freeBays() {
    return this.built ? this.bays.filter((b) => b.unlocked && b.state === 'empty').length : 0;
  }

  // ---------- building ----------
  canBuild(rep) {
    if (this.built) return { ok: false, reason: 'Already built' };
    if (this.cfg.stage && this.getStage() < this.cfg.stage) return { ok: false, reason: `Unlocks at Stage ${this.cfg.stage}`, stageLocked: true };
    if (rep < this.cfg.minRep) return { ok: false, reason: `Needs reputation ${this.cfg.minRep}` };
    if (!this.economy.canAfford(this.cfg.buildCost)) return { ok: false, reason: 'Not enough cash' };
    return { ok: true };
  }
  build() {
    const c = this.canBuild(this.economy.reputation);
    if (!c.ok) return c;
    if (!this.economy.spend(this.cfg.buildCost, this.cfg.buildCategory || 'equipment')) return { ok: false, reason: 'Not enough cash' };
    this.built = true;
    this.syncParking();
    this.emit('built');
    this.emit('changed');
    return { ok: true };
  }

  // ---------- demand ----------
  arrivalInterval() {
    const [lo, hi] = this.cfg.arrivalSeconds;
    let t = lo + Math.random() * (hi - lo);
    t /= (1 + this.economy.reputation / 150) * this.decorDemand();
    const h = this.getHour();
    if ((h >= 7 && h < 9.5) || (h >= 16.5 && h < 19)) t *= 0.75;
    else if (h >= 22 || h < 6) t *= 2.2;
    return t;
  }

  pickType() {
    const rep = this.economy.reputation;
    const boost = this.fleetBoost();
    const entries = this.cfg.customerTypes.map((k) => [k, this.custCfg.types[k]])
      .filter(([k, d]) => (rep >= d.minRep || (k === 'fleet' && boost > 1)) && (k !== 'vip' || this.getStage() >= 4))
      .map(([k, d]) => [k, d, k === 'fleet' ? d.weight * boost : d.weight]);
    let r = Math.random() * entries.reduce((s, [, , w]) => s + w, 0);
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
    return {
      id: `sv${++seq}_${Date.now().toString(36)}`, type, label: vd.label,
      color: Number(vd.colors[Math.floor(Math.random() * vd.colors.length)]),
      capacityKwh: vd.capacityKwh, maxChargeKw: vd.maxChargeKw, soc: 0.5, startSoc: 0.5, targetSoc: 0.9, connector: 'ccs',
      dirt: randomDirt(), condition: randomCondition(),
    };
  }

  createCustomer(typeKey, vehicle = null) {
    const def = this.custCfg.types[typeKey];
    return {
      id: `s${++seq}`, biz: this.id, type: typeKey, def, vehicle: vehicle || this.makeVehicle(def), state: 'navigate',
      patience: def.patience * this.patienceMult(), maxPatience: def.patience * this.patienceMult(), spawnedAt: this.time, arrivedAt: 0, waitTime: 0,
      satisfaction: null, slot: null, bayId: null, service: null, price: 0, referral: false,
    };
  }

  /** Create a customer; returns it, or null when they decide not to come. */
  spawn(forceType = null, { vehicle = null, referral = false } = {}) {
    if (!this.built) return null;
    const c = this.createCustomer(forceType || this.pickType(), vehicle);
    c.referral = referral;
    const choice = this.chooseService(c);
    if (!choice.service) { this.lose(c, choice.reason || 'no suitable service', false); return null; }
    c.service = choice.service;
    c.price = this.priceFor(c);
    const tol = c.def.priceTolerance / this.custCfg.fairPricePerKwh; // reuse the type's price sensitivity
    if (this.priceMultiplier(c) > 0.9 + tol * 0.4) { this.lose(c, 'too expensive', false); return null; }
    if (!this.freeBays && this.queue.length >= this.maxQueue && Math.random() < 0.7) { this.lose(c, 'busy', false); return null; }
    this.customers.set(c.id, c);
    this.emit('spawn', { customer: c });
    return c;
  }

  /** Customer's price sensitivity input: current price relative to the base price (1 = standard). */
  priceMultiplier() {
    return 1;
  }

  /** Schedule a referral: a charging customer who drives over after a short delay. */
  refer(vehicle, typeKey, delay = 8 + Math.random() * 8) {
    if (!this.built) return false;
    if (!this.cfg.customerTypes.includes(typeKey)) typeKey = 'regular';
    this.pending.push({ t: this.time + delay, vehicle: { ...vehicle, id: `sv${++seq}_ref`, condition: { ...vehicle.condition } }, type: typeKey });
    return true;
  }

  lose(c, reason, angry) {
    this.stats.lost++;
    this.stats.lostBy[reason] = (this.stats.lostBy[reason] || 0) + 1;
    if (angry) this.economy.changeReputation(-2, `${c.def.label} left ${this.id} unserved`);
    this.emit('lost', { customer: c, reason, angry });
  }

  // ---------- arrival, queue, bays ----------
  reserveBay(c) {
    const space = this.parking.reserve(`${this.id}-bays`, c.id);
    if (!space) return null;
    const bay = this.bays[space.index];
    bay.space = space;
    bay.state = 'reserved';
    bay.customer = c;
    bay.vehicle = c.vehicle;
    bay.progress = 0;
    bay.job = null;
    c.state = 'assigned';
    c.bayId = bay.id;
    this.emit('changed');
    return bay;
  }

  arrived(c) {
    c.arrivedAt = this.time;
    this.assignFromQueue();
    const bay = this.freeBays ? this.reserveBay(c) : null;
    if (bay) return { action: 'bay', bayId: bay.id };
    const slot = this.queue.length < this.maxQueue ? this.parking.reserve(`${this.id}-queue`, c.id) : null;
    if (slot) {
      c.state = 'queue';
      c.slot = slot;
      this.queue.push(c);
      this.emit('queued', { customer: c });
      return { action: 'queue', slot };
    }
    this.customers.delete(c.id);
    this.lose(c, 'queue full', false);
    return { action: 'leave', reason: 'queue full' };
  }

  assignFromQueue() {
    while (this.queue.length && this.freeBays) {
      const next = this.queue.reduce((b, c) => (!b || c.def.priority > b.def.priority || (c.def.priority === b.def.priority && c.arrivedAt < b.arrivedAt) ? c : b), null);
      const bay = this.reserveBay(next);
      if (!bay) break;
      this.queue.splice(this.queue.indexOf(next), 1);
      this.emit('assigned', { customer: next, bayId: bay.id });
    }
  }

  releaseSlot(c) {
    if (c.slot) { this.parking.release(c.slot, c.id); c.slot = null; }
  }

  /** Vehicle reached its bay. */
  parkedAtBay(c) {
    const bay = this.bays[c.bayId];
    if (!bay || bay.customer !== c || bay.state !== 'reserved') return;
    bay.state = 'waiting';
    c.state = 'waiting';
    c.parkedAt = this.time;
    c.waitTime = this.time - c.arrivedAt;
    this.onParked(bay);
    this.emit('changed');
  }

  giveUp(c) {
    const from = c.state;
    this.customers.delete(c.id);
    if (from === 'queue') this.queue.splice(this.queue.indexOf(c), 1);
    this.lose(c, 'waited too long', true);
    c.state = 'left';
    this.emit('left', { customer: c, from });
    if (from !== 'queue') this.abandon(c.bayId);
  }

  abandon(bayId) {
    const b = this.bays[bayId];
    if (!b) return;
    b.state = 'done';
    b.released = true;
    this.tasks.validate();
    this.emit('depart', { bayId });
    this.emit('changed');
  }

  vehicleLeft(bayId) {
    const b = this.bays[bayId];
    if (!b || b.state !== 'done') return;
    if (b.space) this.parking.release(b.space, b.customer?.id);
    Object.assign(b, { space: null, state: 'empty', customer: null, vehicle: null, job: null, progress: 0, released: false });
    this.emit('changed');
    this.emit('bay-free');
    this.assignFromQueue();
  }

  // ---------- payment ----------
  rate(c, quality, extra = 0) {
    const wait = clamp(1 - c.waitTime / c.maxPatience, 0, 1);
    let s = 40 + 25 * wait + 28 * quality + extra;
    s -= 14 * Math.max(0, this.priceMultiplier(c) - 1);
    s += this.emp.satisfactionBonus + this.hubBonus(c) + this.decorBonus();
    return Math.round(clamp(s, 0, 100));
  }

  /** Book revenue exactly once, rate the customer, tip, adjust reputation. Returns the result. */
  settle(bay, { price, quality, label, extra = 0 }) {
    const c = bay.customer;
    const revenue = Math.round(price * c.def.payMult * 100) / 100;
    this.economy.earn(revenue, this.cfg.revenueKey, `svc:${this.id}:${c.id}:${label || ''}`);
    this.stats.revenue += revenue;
    c.satisfaction = this.rate(c, quality, extra);
    let tip = 0;
    if (c.satisfaction >= 85) {
      tip = Math.round(revenue * 0.12 * 100) / 100;
      if (tip > 0 && this.economy.earn(tip, 'tips', `tip:${this.id}:${c.id}`)) this.stats.tips += tip;
    }
    if (c.satisfaction >= 80) this.economy.changeReputation(c.def.repGain, `happy ${this.id} customer`);
    else if (c.satisfaction < 40) this.economy.changeReputation(-1, `unhappy ${this.id} customer`);
    this.stats.served++;
    this.stats.satSum += c.satisfaction;
    this.stats.satN++;
    c.state = 'paid';
    this.customers.delete(c.id);
    bay.state = 'done';
    bay.released = true;
    this.emit('paid', { customer: c, satisfaction: c.satisfaction, tip, revenue, bayId: bay.id });
    this.emit('depart', { bayId: bay.id });
    this.emit('changed');
    return { revenue, tip };
  }

  mood(c) {
    const p = c.patience / c.maxPatience;
    return p > 0.6 ? '😀' : p > 0.3 ? '😐' : '😠';
  }
  get avgSatisfaction() {
    return this.stats.satN ? this.stats.satSum / this.stats.satN : null;
  }

  // ---------- update ----------
  update(dt) {
    if (!this.built) return;
    this.time += dt;
    this.timer -= dt;
    if (this.enabled && this.timer <= 0) {
      this.timer = this.arrivalInterval();
      if (this.customers.size < 5) this.spawn();
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].t <= this.time) {
        const p = this.pending.splice(i, 1)[0];
        if (this.customers.size < 6) {
          const c = this.spawn(p.type, { vehicle: p.vehicle, referral: true });
          if (c) this.stats.referrals++;
        }
      }
    }
    for (const c of [...this.customers.values()]) {
      if (!WAITING_STATES.includes(c.state)) continue;
      c.patience -= dt;
      if (c.patience <= 0) this.giveUp(c);
    }
    if (this.queue.length && this.freeBays) this.assignFromQueue();
    this.tickBays(dt);
    this.publishTasks();
  }

  /** Daily equipment maintenance (expense category: maintenance). */
  dailyUpkeep() {
    if (!this.built) return 0;
    const cost = this.unlockedBays * this.cfg.upkeepPerBayPerDay;
    this.economy.expense(cost, 'maintenance');
    return cost;
  }

  // ---- subclass hooks ----
  chooseService() { return { service: null, reason: 'not implemented' }; }
  priceFor() { return 0; }
  onParked() {}
  tickBays() {}
  publishTasks() {}
}
