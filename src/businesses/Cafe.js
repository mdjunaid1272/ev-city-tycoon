/**
 * Café business (pure logic, no Three.js). Built when the Coffee Shop upgrade of the customer hub is bought.
 *
 * Loop:  customer arrives -> picks a product -> order is accepted (ingredients are reserved) and queued
 *        -> a barista (or the player) prepares it -> customer receives it -> payment (once) -> customer leaves.
 *
 * Customers come from two places:
 *   - walk-ins (commuters, tourists, rushers): demand depends on reputation, time of day and the seating upgrade
 *   - customers who are charging at the station and decide to buy something while they wait
 * Everything goes through the shared systems: EconomyManager (revenue source "cafe", expense "ingredients"),
 * TaskManager (baristas pick up "cafe" tasks), EventBus (stats, missions, UI) and save/load.
 */
import { Disposables } from '../core/Disposables.js';

// where things are in the station lot (the view builds the same layout)
// An enterable café: four walls with a door in the south wall (facing the charging bays), a counter in the back half of the
// room with the barista spots BEHIND it (reached around either end of the counter), the queue in front of the counter and the
// tables beside the door. Walls / counter / tables are real colliders; the staff walking grid is rebuilt around them.
export const CAFE_LAYOUT = {
  building: { x: 17.4, z: -13.5, w: 7.2, d: 12 },        // outer footprint: x 13.8 .. 21.0, z -19.5 .. -7.5
  door: { x: 17.5, z: -7.5, w: 2.2 },                    // opening in the south wall
  counter: { x: 18.75, z: -16.0, w: 3.8 },               // a wide counter pushed to the east wall: the open end (2.7 m, the staff walking grid needs that) is on the west side
  stand: [{ x: 17.4, z: -17.8 }, { x: 19.6, z: -17.8 }], // where baristas (and the owner) work, behind the counter
  queue: [{ x: 17.3, z: -14.5 }, { x: 18.35, z: -14.5 }, { x: 19.4, z: -14.5 }, { x: 20.35, z: -14.5 }, { x: 17.8, z: -13.2 }, { x: 19.0, z: -13.2 }], // a row of customers across the counter (front view), then a second row
  tables: [{ x: 15.2, z: -9.4 }, { x: 19.9, z: -9.4 }, { x: 15.2, z: -11.6 }, { x: 19.9, z: -11.6 }, { x: 19.9, z: -13.8 }],
  entry: { x: 17.5, z: -6.0 },                           // on the lot, just outside the door
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round2 = (n) => Math.round(n * 100) / 100;
let seq = 0;

export class Cafe {
  constructor({ bus, economy, cfg, hub, tasks, getHour = () => 12, getReputation = () => 0, getStage = () => 4, saved = null }) {
    Object.assign(this, { bus, economy, cfg, hub, tasks, getHour, getReputation, getStage });
    this.d = new Disposables();
    this.time = 0;
    this.spawnTimer = 6; // the first walk-in comes quickly
    this.restockTimer = 0;
    this.taskTimer = 0;
    this.orders = []; // accepted orders that are not finished yet
    this.customers = new Map(); // everyone currently in the café (walk-ins and charging customers who ordered)
    this.shortageAt = {};
    this.manualOrder = null;

    this.levels = { machine: 0, storage: 0, seating: 0, menu: 0 };
    this.prices = {};
    this.enabled = {};
    this.stock = {};
    this.autoRestock = false;
    this.stats = { orders: 0, served: 0, revenue: 0, spent: 0, lost: 0, lostBy: {}, tips: 0, satSum: 0, satN: 0 };
    this.today = this.blankDay();
    this.restore(saved);
    if (this.built && !saved) this.onBuilt(); // an older save that already owns the Coffee Shop starts with opening stock

    hub.coffeeHandledByCafe = true; // the hub no longer books instant coffee sales: they are real orders now
    this.d.subscribe(bus, 'charging:start', ({ customer }) => this.onChargingStart(customer));
    this.d.subscribe(bus, 'day:new', () => { this.today = this.blankDay(); });
    // a barista was fired / reassigned / got stuck while working on an order: it goes back to the queue (the player or another barista can take it)
    this.d.subscribe(bus, 'task:released', ({ task }) => {
      const o = this.orders.find((x) => `cafe:${x.id}` === task.key);
      if (o && o.state === 'preparing' && !o.manual) { o.state = 'queued'; o.progress = 0; o.by = null; }
    });
    this.d.subscribe(bus, 'hub:built', ({ key }) => { if (key === 'coffee') this.onBuilt(); });
  }

  dispose() { this.d.dispose(); }

  blankDay() { return { orders: 0, served: 0, revenue: 0, spent: 0, lost: 0 }; }

  // ---------- configuration helpers ----------
  get built() { return !!this.hub.built.coffee; }
  get seats() { return this.cfg.upgrades.seating.levels[this.levels.seating].seats; }
  get demandMult() { return this.cfg.upgrades.seating.levels[this.levels.seating].demand; }
  /** Baristas the café has room for (grows with the seating upgrade). */
  get staffSlots() { return this.cfg.upgrades.seating.levels[this.levels.seating].staff; }
  get prepMult() { return this.cfg.upgrades.machine.levels[this.levels.machine].prepMult; }
  get capMult() { return this.cfg.upgrades.storage.levels[this.levels.storage].capMult; }
  get menuLevel() { return this.levels.menu; }
  get queueLength() { return this.orders.length; }
  get avgSatisfaction() { return this.stats.satN ? this.stats.satSum / this.stats.satN : null; }

  cap(ing) { return Math.round(this.cfg.ingredients[ing].cap * this.capMult); }

  unitCost(pid) {
    const p = this.cfg.products[pid];
    return round2(Object.entries(p.ingredients).reduce((s, [ing, n]) => s + n * this.cfg.ingredients[ing].cost, 0));
  }

  prepSeconds(pid) { return round2(this.cfg.products[pid].prep * this.prepMult); }

  /** First missing ingredient for one unit of the product, or null when it can be made. */
  missing(pid) {
    for (const [ing, n] of Object.entries(this.cfg.products[pid].ingredients)) if ((this.stock[ing] || 0) < n) return ing;
    return null;
  }

  products() {
    return Object.entries(this.cfg.products).map(([id, p]) => {
      const unlocked = this.menuLevel >= p.unlock;
      const unit = this.unitCost(id), price = this.prices[id];
      return {
        id, label: p.label, icon: p.icon, price, defaultPrice: p.price, unlock: p.unlock, unlocked, enabled: !!this.enabled[id],
        available: this.built && unlocked && !!this.enabled[id], unitCost: unit, profit: round2(price - unit), margin: price > 0 ? (price - unit) / price : 0,
        prep: this.prepSeconds(id), missing: this.missing(id), ingredients: p.ingredients,
      };
    });
  }

  // ---------- player controls ----------
  setPrice(pid, value) {
    const p = this.cfg.products[pid];
    if (!p || !Number.isFinite(value)) return false;
    const min = Math.max(0.5, this.unitCost(pid) * 1.05), max = round2(p.price * 2.5);
    this.prices[pid] = round2(Math.round(clamp(value, min, max) * 20) / 20);
    this.bus.emit('cafe:changed');
    return true;
  }

  setEnabled(pid, on) {
    if (!this.cfg.products[pid]) return false;
    this.enabled[pid] = !!on;
    this.bus.emit('cafe:changed');
    return true;
  }

  setAutoRestock(on) { this.autoRestock = !!on; this.bus.emit('cafe:changed'); }

  /** Buy ingredients (booked as the expense "ingredients"). Returns { ok, reason, qty }. */
  restock(ing, qty) {
    const def = this.cfg.ingredients[ing];
    if (!def) return { ok: false, reason: 'Unknown ingredient' };
    const room = this.cap(ing) - (this.stock[ing] || 0);
    qty = Math.floor(Math.min(qty, room));
    if (qty <= 0) return { ok: false, reason: 'Storage is full' };
    const cost = round2(qty * def.cost);
    if (!this.economy.spend(cost, 'ingredients')) return { ok: false, reason: 'Not enough cash' };
    this.stock[ing] = (this.stock[ing] || 0) + qty;
    this.stats.spent = round2(this.stats.spent + cost);
    this.today.spent = round2(this.today.spent + cost);
    this.bus.emit('cafe:changed');
    return { ok: true, qty, cost };
  }

  /** Cost of the next level of an upgrade (null at max), and why it cannot be bought now (or null). */
  upgradeInfo(kind) {
    const u = this.cfg.upgrades[kind];
    const next = u.levels[this.levels[kind] + 1];
    if (!next) return { cost: null, reason: 'Fully upgraded', next: null };
    let reason = null;
    if (!this.built) reason = 'Build the Coffee Shop first';
    else if (next.stage && this.getStage() < next.stage) reason = `Unlocks at Stage ${next.stage}`;
    else if (!this.economy.canAfford(next.cost)) reason = 'Not enough cash';
    return { cost: next.cost, reason, next, stage: next.stage || 1 };
  }

  /**
   * What an upgrade is worth, in words, from the cafÃ©'s real numbers (never invented): an estimate for more seats, the walk-outs
   * and sold-out customers that faster service / bigger storage would address, the profit of the products a bigger menu unlocks.
   * Returns null when there is nothing meaningful to say yet.
   */
  benefit(kind) {
    const info = this.upgradeInfo(kind), next = info.next;
    if (!next) return null;
    const cur = this.cfg.upgrades[kind].levels[this.levels[kind]];
    const money = (n) => '$' + n.toFixed(2);
    if (kind === 'seating') {
      const base = this.today.revenue;
      if (base <= 0) return null;
      const extra = base * (next.demand / cur.demand - 1);
      return `Estimate from today's sales: about +${money(extra)} per day (pays back in about ${Math.max(1, Math.ceil(next.cost / extra))} days)`;
    }
    if (kind === 'machine') {
      const n = this.stats.lostBy['waited too long'] || 0;
      return n ? `${n} customer${n > 1 ? 's' : ''} left because the wait was too long: faster service helps` : null;
    }
    if (kind === 'storage') {
      const n = this.stats.lostBy['sold out'] || 0;
      return n ? `${n} customer${n > 1 ? 's' : ''} left because something was sold out: more storage means fewer empty shelves` : null;
    }
    if (kind === 'menu') {
      const items = this.products().filter((p) => p.unlock === this.levels.menu + 1);
      return items.length ? items.map((p) => `${p.label} earns ${money(p.profit)} profit per sale`).join(', ') : null;
    }
    return null;
  }

  upgrade(kind) {
    if (!this.cfg.upgrades[kind]) return { ok: false, reason: 'Unknown upgrade' };
    const info = this.upgradeInfo(kind);
    if (info.reason) return { ok: false, reason: info.reason };
    if (!this.economy.spend(info.cost, 'equipment')) return { ok: false, reason: 'Not enough cash' };
    this.levels[kind]++;
    if (kind === 'storage') for (const ing of Object.keys(this.cfg.ingredients)) this.stock[ing] = Math.min(this.stock[ing] || 0, this.cap(ing));
    this.bus.emit('cafe:upgraded', { kind, level: this.levels[kind] });
    this.bus.emit('cafe:changed');
    return { ok: true };
  }

  // ---------- customers and orders ----------
  onBuilt() {
    // opening day: half-full storage so the first customers can be served
    for (const ing of Object.keys(this.cfg.ingredients)) if (this.stock[ing] === undefined || this.stock[ing] === 0) this.stock[ing] = Math.round(this.cap(ing) / 2);
    this.bus.emit('cafe:changed');
  }

  pickProduct(prefs) {
    const options = Object.entries(prefs).filter(([pid]) => this.cfg.products[pid] && this.products().find((p) => p.id === pid)?.available);
    if (!options.length) return null;
    const total = options.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [pid, w] of options) if ((r -= w) <= 0) return pid;
    return options[0][0];
  }

  rateLimited(key) {
    const now = this.time, last = this.shortageAt[key];
    if (last !== undefined && now - last < this.cfg.service.shortageCooldownSeconds) return true;
    this.shortageAt[key] = now;
    return false;
  }

  notifyShortage(ing) {
    if (this.rateLimited(ing)) return;
    this.bus.emit('cafe:shortage', { ingredient: ing, label: this.cfg.ingredients[ing].label });
  }

  lose(customer, reason) {
    this.stats.lost++; this.today.lost++;
    this.stats.lostBy[reason] = (this.stats.lostBy[reason] || 0) + 1;
    this.bus.emit('cafe:lost', { customer, reason });
  }

  /**
   * A customer wants a product. Returns { ok, order } or { ok: false, reason }. The ingredients are taken from the stock
   * immediately (so a queued order can never run out of them) and given back if the customer leaves before preparation starts.
   */
  placeOrder(customer, pid) {
    if (!this.built) return { ok: false, reason: 'closed' };
    const p = this.products().find((x) => x.id === pid);
    if (!p || !p.available) return { ok: false, reason: 'unavailable' };
    if (this.orders.length >= this.seats + 2) return { ok: false, reason: 'full' };
    if (p.price > p.defaultPrice * this.cfg.demand.maxPriceFactor) return { ok: false, reason: 'too expensive' };
    const miss = this.missing(pid);
    if (miss) { this.notifyShortage(miss); return { ok: false, reason: 'sold out' }; }
    for (const [ing, n] of Object.entries(this.cfg.products[pid].ingredients)) {
      this.stock[ing] -= n;
      if (this.stock[ing] <= 0) this.notifyShortage(ing);
    }
    const order = {
      id: `o${++seq}`, customer, pid, price: p.price, state: 'queued', createdAt: this.time, progress: 0, base: this.prepSeconds(pid), manual: false, by: null,
    };
    this.orders.push(order);
    customer.order = order;
    customer.state = 'queued';
    this.stats.orders++; this.today.orders++;
    this.bus.emit('cafe:ordered', { order, customer });
    this.bus.emit('cafe:changed');
    return { ok: true, order };
  }

  /** Remove an unfinished order. Ingredients come back only if preparation had not started. */
  cancelOrder(order, reason) {
    const i = this.orders.indexOf(order);
    if (i < 0) return;
    this.orders.splice(i, 1);
    if (order.state === 'queued') for (const [ing, n] of Object.entries(this.cfg.products[order.pid].ingredients)) this.stock[ing] = Math.min(this.cap(ing), (this.stock[ing] || 0) + n);
    if (this.manualOrder === order) this.manualOrder = null;
    order.state = 'cancelled';
    this.tasks?.byKey?.get?.(`cafe:${order.id}`) && this.tasks.cancel(this.tasks.byKey.get(`cafe:${order.id}`), reason);
    this.lose(order.customer, reason);
    this.bus.emit('cafe:changed');
  }

  spawnWalkIn() {
    if (this.customers.size >= this.seats) return null;
    const types = Object.entries(this.cfg.customerTypes);
    let r = Math.random() * types.reduce((s, [, t]) => s + t.weight, 0), pick = types[0];
    for (const t of types) if ((r -= t[1].weight) <= 0) { pick = t; break; }
    const [typeKey, def] = pick;
    const c = { id: `k${++seq}`, kind: 'walkin', type: typeKey, def, state: 'arriving', patience: def.patience, maxPatience: def.patience, order: null, ref: null, spawnedAt: this.time };
    const pid = this.pickProduct(def.prefs);
    if (!pid) {
      // nothing on the menu they like is available: they turn around (and the owner is told why)
      this.lose(c, 'sold out');
      const sold = Object.keys(def.prefs).map((q) => this.missing(q)).find(Boolean);
      if (sold) this.notifyShortage(sold);
      return null;
    }
    const res = this.placeOrder(c, pid);
    if (!res.ok) { this.lose(c, res.reason); return null; }
    this.customers.set(c.id, c);
    this.bus.emit('cafe:arrived', { customer: c });
    return c;
  }

  /** A customer who is charging at the station may walk over for a drink while they wait. */
  onChargingStart(station) {
    if (!station || !this.built) return;
    const d = this.cfg.demand;
    const emp = this.hubCashierBoost?.() ?? 1;
    const chance = d.chargingChance * (d.typeFactor[station.type] ?? 1) * emp;
    if (Math.random() >= chance) return;
    const def = { label: station.def?.label || 'Driver', icon: station.def?.icon || '🚗', spend: 1, prefs: { espresso: 4, latte: 4, croissant: 3, sandwich: 2, iced: 2 } };
    const c = { id: `k${++seq}`, kind: 'charging', type: station.type, def, state: 'arriving', patience: d.chargingPatience, maxPatience: d.chargingPatience, order: null, ref: station, spawnedAt: this.time };
    const pid = this.pickProduct(def.prefs);
    if (!pid) { this.lose(c, 'sold out'); return; }
    const res = this.placeOrder(c, pid);
    if (!res.ok) { this.lose(c, res.reason); return; }
    this.customers.set(c.id, c);
    this.bus.emit('cafe:arrived', { customer: c });
  }

  // ---------- preparation ----------
  /** The player prepares the oldest waiting order by hand (slower than a barista). Returns { ok, reason }. */
  prepareManually() {
    if (this.manualOrder) return { ok: false, reason: 'You are already preparing an order' };
    const order = this.orders.find((o) => o.state === 'queued' && !this.tasks?.byKey?.get?.(`cafe:${o.id}`)?.reservedBy);
    if (!order) return { ok: false, reason: this.orders.length ? 'A barista is already on every order' : 'No orders waiting' };
    order.manual = true; order.state = 'preparing'; order.by = 'owner'; order.progress = 0;
    order.base = round2(order.base * this.cfg.service.manualPrepFactor);
    this.manualOrder = order;
    this.bus.emit('cafe:changed');
    return { ok: true, order };
  }

  satisfactionFor(order, wait) {
    const c = order.customer, p = this.cfg.products[order.pid];
    const patience = Math.max(1, c.maxPatience);
    const speed = 1 - clamp(wait / patience, 0, 1); // 1 = served at once, 0 = at the very last second
    const quality = p.satisfaction + this.levels.machine * 2 + this.levels.seating; // better equipment, better coffee
    return Math.round(clamp(52 + 36 * speed + quality, 0, 100));
  }

  /** Customer gets the order and pays. Exactly once per order. */
  finishOrder(order) {
    if (order.state === 'done' || order.state === 'cancelled' || !this.orders.includes(order)) return false;
    const c = order.customer;
    const amount = round2(order.price * (c.def.spend || 1));
    if (!this.economy.earn(amount, 'cafe', `cafe:${order.id}`)) return false; // already paid (or invalid): nothing else happens
    order.state = 'done';
    this.orders.splice(this.orders.indexOf(order), 1);
    if (this.manualOrder === order) this.manualOrder = null;
    const wait = this.time - order.createdAt;
    const sat = this.satisfactionFor(order, wait);
    let tip = 0;
    if (sat >= this.cfg.service.happyScore) {
      tip = round2(amount * this.cfg.service.tipRate);
      if (tip > 0 && this.economy.earn(tip, 'tips', `cafe-tip:${order.id}`)) this.stats.tips = round2(this.stats.tips + tip);
    }
    this.stats.served++; this.today.served++;
    this.stats.revenue = round2(this.stats.revenue + amount); this.today.revenue = round2(this.today.revenue + amount);
    this.stats.satSum += sat; this.stats.satN++;
    c.satisfaction = sat;
    c.state = 'eating';
    c.leaveAt = this.time + (c.kind === 'walkin' ? this.cfg.service.eatSeconds[0] + Math.random() * (this.cfg.service.eatSeconds[1] - this.cfg.service.eatSeconds[0]) : 4);
    if (c.ref) c.ref.boughtCoffee = true; // a charging customer who bought a coffee rates the station higher (existing hub bonus)
    this.bus.emit('cafe:served', { order, customer: c, amount, tip, satisfaction: sat, wait });
    this.bus.emit('hub:sale', { key: 'coffee', amount, customer: c.ref || c });
    this.bus.emit('cafe:changed');
    return true;
  }

  // ---------- simulation ----------
  demandInterval() {
    const d = this.cfg.demand;
    let t = d.baseIntervalSeconds;
    t /= (1 + this.getReputation() / d.reputationDivisor) * this.demandMult * (this.cozyBonus ? this.cozyBonus() : 1); // a charming café (cozy decoration + level) draws a few more guests
    const h = this.getHour();
    if (d.rushHours.some(([a, b]) => h >= a && h < b)) t *= d.rushFactor;
    else if (h >= 23 || h < 5) t *= d.nightFactor;
    return t * (0.8 + Math.random() * 0.4);
  }

  update(dt) {
    this.time += dt;
    if (!this.built) return;
    // walk-in demand
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = this.demandInterval(); this.spawnWalkIn(); }
    // patience, customers who left, manual preparation
    for (const o of [...this.orders]) {
      const c = o.customer;
      if (c.ref && !['charging', 'waiting', 'assigned'].includes(c.ref.state)) { this.cancelOrder(o, 'customer left'); this.customers.delete(c.id); continue; }
      if (o.state === 'queued' || o.state === 'preparing') c.patience -= dt;
      if (o.manual) { o.progress = Math.min(1, o.progress + dt / Math.max(0.1, o.base)); if (o.progress >= 1) { this.finishOrder(o); continue; } }
      if (c.patience <= 0 && o.state !== 'done') { this.cancelOrder(o, 'waited too long'); this.customers.delete(c.id); }
    }
    for (const c of [...this.customers.values()]) if (c.state === 'eating' && this.time >= c.leaveAt) { this.customers.delete(c.id); this.bus.emit('cafe:left', { customer: c }); }
    // ingredients and tasks at a calmer rate
    this.taskTimer -= dt;
    if (this.taskTimer <= 0) { this.taskTimer = 0.25; this.publishTasks(); }
    if (this.autoRestock) {
      this.restockTimer -= dt;
      if (this.restockTimer <= 0) { this.restockTimer = this.cfg.service.autoRestock.intervalSeconds; this.runAutoRestock(); }
    }
  }

  runAutoRestock() {
    const a = this.cfg.service.autoRestock;
    for (const ing of Object.keys(this.cfg.ingredients)) {
      const cap = this.cap(ing), have = this.stock[ing] || 0;
      if (have >= cap * a.below) continue;
      const r = this.restock(ing, Math.ceil(cap * a.refillTo - have));
      if (!r.ok && r.reason === 'Not enough cash' && !this.rateLimited('cash')) this.bus.emit('cafe:problem', { text: 'Auto-restock failed: not enough cash for ingredients' });
    }
  }

  /** Every waiting order is a task on the shared board: baristas pick the oldest / most patient-limited first. */
  publishTasks() {
    this.orders.forEach((o, i) => {
      if (o.state !== 'queued' || o.manual) return;
      const stand = CAFE_LAYOUT.stand[i % CAFE_LAYOUT.stand.length];
      this.tasks.publish({
        key: `cafe:${o.id}`, type: 'cafe-order', dept: 'cafe', label: `Preparing ${this.cfg.products[o.pid].label}`,
        priority: 10 + Math.round(30 * (1 - clamp(o.customer.patience / o.customer.maxPatience, 0, 1))), // the most impatient first
        pos: stand, face: { x: CAFE_LAYOUT.counter.x, z: CAFE_LAYOUT.counter.z }, base: o.base,
        valid: () => this.orders.includes(o) && !o.manual && (o.state === 'queued' || o.state === 'preparing'),
        onStart: () => { o.state = 'preparing'; o.by = 'staff'; },
        onProgress: (p) => { o.progress = p; },
        run: () => { this.finishOrder(o); },
      });
    });
  }

  // ---------- reporting ----------
  /** Per-day and lifetime figures for the panels. */
  report() {
    const s = this.stats, t = this.today;
    return {
      today: { ...t, profit: round2(t.revenue - t.spent) },
      total: { ...s, profit: round2(s.revenue - s.spent), avgSatisfaction: this.avgSatisfaction },
    };
  }

  // ---------- save / load ----------
  serialize() {
    // ingredients reserved by orders that were not started go back into the stock: nothing is lost by saving mid-service
    const stock = { ...this.stock };
    for (const o of this.orders) if (o.state === 'queued') for (const [ing, n] of Object.entries(this.cfg.products[o.pid].ingredients)) stock[ing] = (stock[ing] || 0) + n;
    return { v: 1, levels: { ...this.levels }, prices: { ...this.prices }, enabled: { ...this.enabled }, stock, autoRestock: this.autoRestock, stats: { ...this.stats, lostBy: { ...this.stats.lostBy } }, today: { ...this.today } };
  }

  restore(saved) {
    const num = (v, d, lo = 0, hi = Infinity) => (Number.isFinite(v) ? clamp(v, lo, hi) : d);
    for (const [pid, p] of Object.entries(this.cfg.products)) {
      this.prices[pid] = num(saved?.prices?.[pid], p.price, 0.5, p.price * 2.5);
      this.enabled[pid] = saved?.enabled?.[pid] ?? true;
    }
    for (const kind of Object.keys(this.levels)) this.levels[kind] = Math.floor(num(saved?.levels?.[kind], 0, 0, this.cfg.upgrades[kind].levels.length - 1));
    for (const ing of Object.keys(this.cfg.ingredients)) this.stock[ing] = Math.floor(num(saved?.stock?.[ing], 0, 0, this.cap(ing)));
    this.autoRestock = !!saved?.autoRestock;
    if (saved?.stats) for (const k of ['orders', 'served', 'revenue', 'spent', 'lost', 'tips', 'satSum', 'satN']) this.stats[k] = num(saved.stats[k], 0);
    if (saved?.stats?.lostBy && typeof saved.stats.lostBy === 'object') for (const [k, v] of Object.entries(saved.stats.lostBy)) if (Number.isFinite(v)) this.stats.lostBy[k] = v;
    if (saved?.today) for (const k of Object.keys(this.today)) this.today[k] = num(saved.today[k], 0);
  }
}
