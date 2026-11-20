import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { EconomyManager } from '../src/economy/EconomyManager.js';
import { TaskManager } from '../src/employees/TaskManager.js';
import { EmployeeManager } from '../src/employees/EmployeeManager.js';
import { NavGrid } from '../src/employees/NavGrid.js';
import { Cafe, CAFE_LAYOUT } from '../src/businesses/Cafe.js';
import { ServiceHub } from '../src/businesses/ServiceHub.js';
import { siteCounts } from '../src/customers/SiteCounts.js';
import { data } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

/** menu: level of the menu upgrade (2 = every product unlocked); spawn: let walk-ins arrive on their own (off by default so tests control who is in the café) */
function makeCafe({ cash = 50000, built = true, saved = null, hour = 12, menu = 2, spawn = false, stage = 4 } = {}) {
  const bus = new EventBus();
  const economy = new EconomyManager(bus, { cash, gems: 0 });
  const tasks = new TaskManager(bus);
  const hub = { built: { coffee: built, store: false, lounge: false } };
  const cafe = new Cafe({ bus, economy, cfg: data('cafe'), hub, tasks, getHour: () => hour, getReputation: () => 0, getStage: () => stage, saved });
  if (built && !saved) cafe.onBuilt();
  if (!saved) cafe.levels.menu = menu;
  if (!spawn) cafe.spawnTimer = 1e12;
  const events = [];
  for (const e of ['cafe:served', 'cafe:lost', 'cafe:shortage', 'cafe:ordered', 'cafe:upgraded']) bus.on(e, (p) => events.push([e, p]));
  const run = (seconds, dt = 0.1) => { for (let t = 0; t < seconds; t += dt) cafe.update(dt); };
  return { bus, economy, tasks, hub, cafe, events, run };
}
const walkIn = (w, pid = 'espresso') => {
  const c = { id: `t${Math.random()}`, kind: 'walkin', type: 'commuter', def: { label: 'Commuter', spend: 1, prefs: { [pid]: 1 } }, state: 'arriving', patience: 40, maxPatience: 40, order: null, ref: null };
  const r = w.cafe.placeOrder(c, pid);
  if (r.ok) w.cafe.customers.set(c.id, c);
  return { c, r };
};

describe('café: order processing', () => {
  it('an order is accepted, queued, prepared by hand and paid exactly once', () => {
    const w = makeCafe({ cash: 0 });
    const { c, r } = walkIn(w, 'espresso');
    expect(r.ok).toBe(true);
    expect(c.state).toBe('queued');
    expect(w.cafe.queueLength).toBe(1);
    expect(w.cafe.prepareManually().ok).toBe(true);
    expect(w.cafe.orders[0].state).toBe('preparing');
    w.run(30);
    expect(c.state).toBe('eating');
    expect(w.cafe.queueLength).toBe(0);
    expect(w.economy.ledger.revenue.cafe).toBe(3.5);
    expect(w.cafe.stats.served).toBe(1);
    expect(w.events.filter(([e]) => e === 'cafe:served')).toHaveLength(1);
  });

  it('manual preparation is slower than a barista would be, and only one order at a time', () => {
    const w = makeCafe();
    walkIn(w, 'latte'); walkIn(w, 'latte');
    w.cafe.stats.orders; // two orders
    const base = w.cafe.orders[0].base;
    expect(w.cafe.prepareManually().ok).toBe(true);
    expect(w.cafe.orders[0].base).toBeCloseTo(base * 1.5, 2);
    expect(w.cafe.prepareManually()).toMatchObject({ ok: false });
  });

  it('nothing to prepare is reported, not ignored', () => {
    expect(makeCafe().cafe.prepareManually()).toMatchObject({ ok: false, reason: 'No orders waiting' });
  });

  it('a closed café refuses orders and spawns nobody', () => {
    const w = makeCafe({ built: false });
    expect(w.cafe.placeOrder({ id: 'x', def: {}, patience: 1, maxPatience: 1 }, 'espresso')).toMatchObject({ ok: false, reason: 'closed' });
    w.run(120);
    expect(w.cafe.customers.size).toBe(0);
  });

  it('walk-in customers arrive on their own, are served by hand and leave after eating', () => {
    const w = makeCafe({ spawn: true });
    w.cafe.spawnTimer = 1;
    w.run(40);
    expect(w.cafe.stats.orders).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) { w.cafe.prepareManually(); w.run(5); }
    expect(w.cafe.stats.served).toBeGreaterThan(0);
    w.run(60);
    for (const c of w.cafe.customers.values()) expect(['queued', 'eating', 'arriving']).toContain(c.state);
  });

  it('demand follows reputation, rush hour and the seating upgrade', () => {
    const base = makeCafe().cafe;
    const mean = (cafe) => { let s = 0; for (let i = 0; i < 400; i++) s += cafe.demandInterval(); return s / 400; };
    const normal = mean(base);
    base.getReputation = () => 120;
    expect(mean(base)).toBeLessThan(normal * 0.75);
    const rush = makeCafe({ hour: 8 }).cafe;
    expect(mean(rush)).toBeLessThan(normal * 0.85);
    const night = makeCafe({ hour: 2 }).cafe;
    expect(mean(night)).toBeGreaterThan(normal * 1.8);
  });
});

describe('café: payments and revenue', () => {
  it('pays price x customer spend multiplier, books it as revenue source "cafe", and never twice', () => {
    const w = makeCafe({ cash: 0 });
    const { c } = walkIn(w, 'latte');
    c.def.spend = 1.25;
    const order = c.order;
    w.cafe.prepareManually(); w.run(40);
    expect(w.economy.ledger.revenue.cafe).toBeCloseTo(5.5 * 1.25, 2);
    const cash = w.economy.cash;
    expect(w.cafe.finishOrder(order)).toBe(false); // replayed completion: no second payment
    expect(w.economy.cash).toBe(cash);
  });

  it('tips go to happy customers only (served quickly)', () => {
    const quick = makeCafe({ cash: 0 });
    const a = walkIn(quick, 'espresso'); quick.cafe.finishOrder(a.c.order);
    expect(a.c.satisfaction).toBeGreaterThanOrEqual(75);
    expect(quick.economy.ledger.revenue.tips).toBeGreaterThan(0);
    const slow = makeCafe({ cash: 0 });
    const b = walkIn(slow, 'espresso'); b.c.maxPatience = 40; slow.cafe.time += 39.9; slow.cafe.finishOrder(b.c.order);
    expect(b.c.satisfaction).toBeLessThan(75);
    expect(slow.economy.ledger.revenue.tips).toBeUndefined();
  });

  it('players can set prices: clamped to a sensible range, and a price above 160% scares customers away', () => {
    const w = makeCafe();
    const p = w.cafe.cfg.products.espresso;
    w.cafe.setPrice('espresso', 0.01);
    expect(w.cafe.prices.espresso).toBeGreaterThanOrEqual(w.cafe.unitCost('espresso'));
    w.cafe.setPrice('espresso', 999);
    expect(w.cafe.prices.espresso).toBeLessThanOrEqual(p.price * 2.5);
    w.cafe.setPrice('espresso', p.price * 1.9);
    expect(walkIn(w, 'espresso').r).toMatchObject({ ok: false, reason: 'too expensive' });
    w.cafe.setPrice('espresso', p.price * 1.5);
    expect(walkIn(w, 'espresso').r.ok).toBe(true);
    expect(w.cafe.setPrice('espresso', NaN)).toBe(false);
  });

  it('reports revenue, ingredient spending and profit per day and lifetime; a new day resets only the day', () => {
    const w = makeCafe({ cash: 1000 });
    const { c } = walkIn(w, 'latte');
    w.cafe.finishOrder(c.order);
    w.cafe.restock('beans', 10);
    let r = w.cafe.report();
    expect(r.today.revenue).toBe(5.5);
    expect(r.today.spent).toBe(5);
    expect(r.today.profit).toBe(0.5);
    w.bus.emit('day:new');
    r = w.cafe.report();
    expect(r.today).toMatchObject({ revenue: 0, spent: 0, orders: 0 });
    expect(r.total.revenue).toBe(5.5);
  });

  it('product margins are computed from ingredient costs', () => {
    const w = makeCafe();
    const latte = w.cafe.products().find((p) => p.id === 'latte');
    expect(latte.unitCost).toBeCloseTo(0.5 + 2 * 0.45, 2);
    expect(latte.profit).toBeCloseTo(5.5 - latte.unitCost, 2);
    expect(latte.margin).toBeCloseTo(latte.profit / 5.5, 3);
  });
});

describe('café: stock consumption and shortage', () => {
  it('each order consumes exactly its ingredients', () => {
    const w = makeCafe();
    const before = { ...w.cafe.stock };
    walkIn(w, 'latte');
    expect(w.cafe.stock.beans).toBe(before.beans - 1);
    expect(w.cafe.stock.milk).toBe(before.milk - 2);
    expect(w.cafe.stock.pastry).toBe(before.pastry);
  });

  it('with no ingredients the product is sold out: no order, a lost customer and ONE notification (rate limited)', () => {
    const w = makeCafe();
    w.cafe.stock.beans = 0;
    for (let i = 0; i < 5; i++) expect(walkIn(w, 'espresso').r).toMatchObject({ ok: false, reason: 'sold out' });
    expect(w.cafe.queueLength).toBe(0);
    expect(w.cafe.stats.orders).toBe(0);
    expect(w.events.filter(([e]) => e === 'cafe:shortage')).toHaveLength(1);
    expect(w.events.find(([e]) => e === 'cafe:shortage')[1]).toMatchObject({ ingredient: 'beans' });
    w.cafe.time += 100; // after the cooldown the owner is told again
    walkIn(w, 'espresso');
    expect(w.events.filter(([e]) => e === 'cafe:shortage')).toHaveLength(2);
  });

  it('running out of an ingredient with the last order also raises a shortage', () => {
    const w = makeCafe();
    w.cafe.stock.beans = 1;
    expect(walkIn(w, 'espresso').r.ok).toBe(true);
    expect(w.cafe.stock.beans).toBe(0);
    expect(w.events.some(([e, p]) => e === 'cafe:shortage' && p.ingredient === 'beans')).toBe(true);
  });

  it('an order cancelled before preparation gives its ingredients back; one in preparation does not', () => {
    const w = makeCafe();
    const a = walkIn(w, 'latte'), b = walkIn(w, 'latte');
    const afterOrders = { ...w.cafe.stock };
    w.cafe.cancelOrder(a.c.order, 'test');
    expect(w.cafe.stock.milk).toBe(afterOrders.milk + 2);
    w.cafe.prepareManually();
    const prepared = b.c.order;
    expect(prepared.state).toBe('preparing');
    const milk = w.cafe.stock.milk;
    w.cafe.cancelOrder(prepared, 'test');
    expect(w.cafe.stock.milk).toBe(milk); // already used
  });

  it('restocking costs money (expense "ingredients"), is limited by storage, and refuses without cash', () => {
    const w = makeCafe({ cash: 100 });
    w.cafe.stock.milk = 0;
    const r = w.cafe.restock('milk', 20);
    expect(r).toMatchObject({ ok: true, qty: 20, cost: 9 });
    expect(w.economy.ledger.expenses.ingredients).toBe(9);
    expect(w.cafe.stock.milk).toBe(20);
    expect(w.cafe.restock('milk', 1000).qty).toBe(40); // capped at the storage limit (60)
    expect(w.cafe.restock('milk', 5)).toMatchObject({ ok: false, reason: 'Storage is full' });
    const poor = makeCafe({ cash: 1 });
    poor.cafe.stock.pastry = 0;
    expect(poor.cafe.restock('pastry', 10)).toMatchObject({ ok: false, reason: 'Not enough cash' });
    expect(poor.cafe.stock.pastry).toBe(0);
    expect(poor.economy.cash).toBe(1);
  });

  it('auto-restock refills low ingredients and can be switched off', () => {
    const w = makeCafe({ cash: 1000 });
    w.cafe.stock.beans = 2;
    w.run(5);
    expect(w.cafe.stock.beans).toBe(2); // off by default
    w.cafe.setAutoRestock(true);
    w.run(6);
    expect(w.cafe.stock.beans).toBeGreaterThan(w.cafe.cap('beans') * 0.6);
    expect(w.economy.ledger.expenses.ingredients).toBeGreaterThan(0);
  });

  it('products that are off the menu are not offered', () => {
    const w = makeCafe();
    w.cafe.setEnabled('espresso', false);
    expect(walkIn(w, 'espresso').r).toMatchObject({ ok: false, reason: 'unavailable' });
    w.cafe.setEnabled('espresso', true);
    expect(walkIn(w, 'espresso').r.ok).toBe(true);
  });

  it('locked products need the menu upgrade', () => {
    const w = makeCafe({ menu: 0 });
    expect(walkIn(w, 'iced').r).toMatchObject({ ok: false, reason: 'unavailable' });
    w.cafe.upgrade('menu'); w.cafe.upgrade('menu');
    expect(walkIn(w, 'iced').r.ok).toBe(true);
  });
});

describe('café: patience, capacity and charging customers', () => {
  it('a customer who waits too long leaves: order cancelled, ingredients returned, counted as lost', () => {
    const w = makeCafe();
    const { c } = walkIn(w, 'espresso');
    const beans = w.cafe.stock.beans;
    c.patience = 1;
    w.run(3);
    expect(w.cafe.queueLength).toBe(0);
    expect(w.cafe.customers.has(c.id)).toBe(false);
    expect(w.cafe.stats.lostBy['waited too long']).toBe(1);
    expect(w.cafe.stock.beans).toBe(beans + 1);
  });

  it('the café never holds more customers than seats', () => {
    const w = makeCafe();
    for (let i = 0; i < 30; i++) w.cafe.spawnWalkIn();
    expect(w.cafe.customers.size).toBeLessThanOrEqual(w.cafe.seats);
    expect(w.cafe.queueLength).toBeLessThanOrEqual(w.cafe.seats + 2);
  });

  it('a charging driver may order a coffee; they are not counted as an extra customer on site', () => {
    const w = makeCafe();
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const driver = { id: 'c77', type: 'regular', def: { label: 'Regular', icon: 'x' }, state: 'charging' };
    w.bus.emit('charging:start', { bayId: 0, customer: driver });
    expect(w.cafe.queueLength).toBe(1);
    const k = [...w.cafe.customers.values()][0];
    expect(k.kind).toBe('charging');
    const counts = siteCounts([{ customers: new Map([[driver.id, driver]]), bays: [] }, w.cafe]);
    expect(counts.onSite).toBe(1); // the driver only
    expect(counts.charging).toBe(1);
    expect(counts.cafe).toBe(0);
    w.cafe.prepareManually(); w.run(40);
    expect(driver.boughtCoffee).toBe(true); // existing hub bonus: happier customer
  });

  it('a driver who finishes charging and leaves before the order is ready cancels it', () => {
    const w = makeCafe();
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const driver = { id: 'c78', type: 'regular', def: { label: 'Regular', icon: 'x' }, state: 'charging' };
    w.bus.emit('charging:start', { bayId: 0, customer: driver });
    const beans = w.cafe.stock.beans;
    driver.state = 'paid';
    w.run(1);
    expect(w.cafe.queueLength).toBe(0);
    expect(w.cafe.stats.lostBy['customer left']).toBe(1);
    expect(w.cafe.stock.beans).toBeGreaterThanOrEqual(beans);
  });

  it('walk-in customers appear in the site counts as café customers', () => {
    const w = makeCafe();
    walkIn(w, 'espresso');
    const counts = siteCounts([w.cafe]);
    expect(counts).toMatchObject({ onSite: 1, cafe: 1, queued: 0, charging: 0 });
  });

  it('the Coffee Shop no longer books instant sales: the hub defers to the café', () => {
    const bus = new EventBus();
    const economy = new EconomyManager(bus, { cash: 1e5 });
    const hub = new ServiceHub({ bus, economy, cfg: data('services').hub, getStage: () => 4, getEmployees: () => ({ satisfactionBonus: 0 }), saved: { built: { coffee: true } } });
    new Cafe({ bus, economy, cfg: data('cafe'), hub, tasks: new TaskManager(bus) });
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    bus.emit('charging:start', { customer: { id: 'x', type: 'regular', state: 'charging', def: {} } });
    hub.update(30);
    expect(hub.count.coffee).toBe(0);
    expect(economy.ledger.revenue.coffee).toBeUndefined();
  });
});

describe('café: baristas (employee integration)', () => {
  function staffedCafe(skill = 2) {
    const w = makeCafe({ cash: 1e6 });
    const mgr = new EmployeeManager({ bus: w.bus, economy: w.economy, tasks: w.tasks, config: data('employees'), getReputation: () => 0, getCapacity: () => 4 });
    mgr.registerFacility('charging', { nav: new NavGrid(), posts: [{ x: 0, z: 3 }], door: { x: -14, z: -11.4 }, breakSpot: { x: -16, z: -10 }, built: () => true, label: 'Station' });
    mgr.registerFacility('cafe', { nav: new NavGrid(), posts: CAFE_LAYOUT.stand, door: CAFE_LAYOUT.entry, breakSpot: { x: 21, z: -5 }, built: () => w.hub.built.coffee, label: 'Café' });
    const hire = (role = 'barista', s = skill) => { const c = mgr.makeCandidate(); c.role = role; c.skill = s; c.cost = mgr.hireCost(s); mgr.candidates.push(c); return mgr.hire(c.id); };
    const step = (seconds, dt = 0.1) => { for (let t = 0; t < seconds; t += dt) { w.cafe.update(dt); mgr.update(dt); } };
    return { ...w, mgr, hire, step };
  }

  it('baristas are only available once the café exists, and work in the café department', () => {
    const closed = makeCafe({ built: false });
    const mgr = new EmployeeManager({ bus: closed.bus, economy: closed.economy, tasks: closed.tasks, config: data('employees'), getReputation: () => 0, getCapacity: () => 4 });
    mgr.registerFacility('charging', { nav: new NavGrid(), posts: [{ x: 0, z: 3 }], door: { x: 0, z: 0 }, breakSpot: { x: 0, z: 0 }, built: () => true, label: 'Station' });
    mgr.registerFacility('cafe', { nav: new NavGrid(), posts: CAFE_LAYOUT.stand, door: CAFE_LAYOUT.entry, breakSpot: { x: 21, z: -5 }, built: () => closed.hub.built.coffee, label: 'Café' });
    expect(mgr.roleAvailable('barista')).toBe(false);
    closed.hub.built.coffee = true;
    expect(mgr.roleAvailable('barista')).toBe(true);
    const c = mgr.makeCandidate(); c.role = 'barista'; c.skill = 2; c.cost = 500; mgr.candidates.push(c); closed.economy.earn(5000, 'x');
    const e = mgr.hire(c.id).employee;
    expect(e.dept).toBe('cafe');
  });

  it('a barista prepares the waiting orders and each is completed and paid once', () => {
    const s = staffedCafe();
    s.hire();
    const a = walkIn(s, 'espresso'), b = walkIn(s, 'croissant');
    s.step(120);
    expect(a.c.state).toBe('eating'); expect(b.c.state).toBe('eating');
    expect(s.cafe.stats.served).toBe(2);
    expect(s.mgr.employees[0].tasksDone).toBe(2);
    expect(s.economy.ledger.revenue.cafe).toBe(7.5);
    expect(s.tasks.tasks.size).toBe(0);
  });

  it('two baristas share the queue and never prepare the same order twice', () => {
    const s = staffedCafe();
    s.hire(); s.hire();
    for (let i = 0; i < 4; i++) walkIn(s, 'espresso');
    s.step(200);
    expect(s.cafe.stats.served).toBe(4);
    expect(s.mgr.employees.reduce((n, e) => n + e.tasksDone, 0)).toBe(4);
  });

  it('a higher skill barista works faster', () => {
    const time = (skill) => {
      const s = staffedCafe(skill); s.hire('barista', skill);
      walkIn(s, 'latte');
      let t = 0; while (s.cafe.stats.served === 0 && t < 400) { s.step(0.5, 0.1); t += 0.5; }
      return t;
    };
    expect(time(5)).toBeLessThan(time(1));
  });

  it('the espresso machine upgrade shortens preparation by exactly its multiplier', () => {
    const w = makeCafe();
    const t0 = w.cafe.prepSeconds('latte');
    w.cafe.upgrade('machine');
    expect(w.cafe.prepSeconds('latte')).toBeCloseTo(t0 * 0.8, 2);
    const before = w.cafe.orders.length;
    const { c } = walkIn(w, 'latte');
    expect(c.order.base).toBeCloseTo(14 * 0.8, 2);
    expect(w.cafe.orders.length).toBe(before + 1);
  });

  it('firing the barista releases the order so someone (or the player) can still prepare it', () => {
    const s = staffedCafe();
    const e = s.hire().employee;
    const a = walkIn(s, 'latte');
    s.step(3);
    s.mgr.fire(e.id);
    s.step(2);
    expect(a.c.order.state).not.toBe('done');
    expect(s.cafe.prepareManually().ok).toBe(true);
  });
});

describe('café: upgrades', () => {
  it('each upgrade costs money, changes something measurable, and stops at its maximum', () => {
    const w = makeCafe({ cash: 100000 });
    const seats0 = w.cafe.seats, slots0 = w.cafe.staffSlots, cap0 = w.cafe.cap('beans');
    const cash0 = w.economy.cash;
    expect(w.cafe.upgrade('seating').ok).toBe(true);
    expect(w.cafe.seats).toBeGreaterThan(seats0);
    expect(w.cafe.staffSlots).toBeGreaterThanOrEqual(slots0);
    expect(w.economy.cash).toBe(cash0 - 2000);
    expect(w.cafe.upgrade('storage').ok).toBe(true);
    expect(w.cafe.cap('beans')).toBeGreaterThan(cap0);
    for (let i = 0; i < 10; i++) w.cafe.upgrade('machine');
    expect(w.cafe.levels.machine).toBe(3);
    expect(w.cafe.upgrade('machine')).toMatchObject({ ok: false, reason: 'Fully upgraded' });
    expect(w.cafe.upgradeInfo('machine').cost).toBeNull();
  });

  it('upgrades need cash and an open café; nothing is charged on failure', () => {
    const poor = makeCafe({ cash: 10 });
    expect(poor.cafe.upgrade('seating')).toMatchObject({ ok: false, reason: 'Not enough cash' });
    expect(poor.economy.cash).toBe(10);
    const closed = makeCafe({ built: false, cash: 1e5 });
    expect(closed.cafe.upgrade('seating')).toMatchObject({ ok: false });
    expect(closed.economy.cash).toBe(1e5);
    expect(makeCafe().cafe.upgrade('nonsense')).toMatchObject({ ok: false });
  });

  it('the first mission-relevant events are emitted', () => {
    const w = makeCafe({ cash: 1e5, menu: 0 });
    w.cafe.upgrade('menu');
    expect(w.events.filter(([e]) => e === 'cafe:upgraded')).toHaveLength(1);
  });
});

describe('café: save and load', () => {
  it('everything the player set up survives a JSON round trip', () => {
    const a = makeCafe({ cash: 1e5, menu: 0 });
    a.cafe.upgrade('seating'); a.cafe.upgrade('menu'); a.cafe.upgrade('storage');
    a.cafe.setPrice('latte', 6.25); a.cafe.setEnabled('croissant', false); a.cafe.setAutoRestock(true);
    const { c } = walkIn(a, 'espresso'); a.cafe.finishOrder(c.order);
    const saved = JSON.parse(JSON.stringify(a.cafe.serialize()));
    const b = makeCafe({ cash: 1e5, saved });
    expect(b.cafe.levels).toEqual(a.cafe.levels);
    expect(b.cafe.prices.latte).toBe(6.25);
    expect(b.cafe.enabled.croissant).toBe(false);
    expect(b.cafe.autoRestock).toBe(true);
    expect(b.cafe.stock).toEqual(a.cafe.stock);
    expect(b.cafe.stats.served).toBe(1);
    expect(b.cafe.stats.revenue).toBe(a.cafe.stats.revenue);
  });

  it('ingredients reserved by waiting orders are not lost when saving mid-service', () => {
    const a = makeCafe();
    const before = { ...a.cafe.stock };
    walkIn(a, 'latte'); walkIn(a, 'espresso');
    expect(a.cafe.stock.beans).toBeLessThan(before.beans);
    const saved = a.cafe.serialize();
    expect(saved.stock).toEqual(before);
  });

  it('a save without café data (older version) loads with defaults, and an owned Coffee Shop gets opening stock', () => {
    const w = makeCafe({ saved: null, menu: 0 });
    expect(w.cafe.levels).toEqual({ machine: 0, storage: 0, seating: 0, menu: 0 });
    expect(w.cafe.stock.beans).toBe(Math.round(40 / 2));
    expect(w.cafe.prices.espresso).toBe(3.5);
    expect(w.cafe.stats.served).toBe(0);
  });

  it('corrupt save data is clamped or ignored', () => {
    const w = makeCafe({ saved: { levels: { machine: 99, seating: -4, menu: 'x' }, prices: { espresso: -5, latte: 'free' }, stock: { beans: 9999, milk: NaN }, stats: { served: 'many', revenue: -3 } } });
    expect(w.cafe.levels).toEqual({ machine: 3, storage: 0, seating: 0, menu: 0 });
    expect(w.cafe.prices.espresso).toBeGreaterThanOrEqual(0.5);
    expect(w.cafe.prices.latte).toBe(5.5);
    expect(w.cafe.stock.beans).toBe(w.cafe.cap('beans'));
    expect(w.cafe.stock.milk).toBe(0);
    expect(w.cafe.stats.served).toBe(0);
    expect(w.cafe.stats.revenue).toBe(0);
  });

  it('disposing the café removes its event subscriptions (no duplicates after a restart)', () => {
    const w = makeCafe();
    const n = w.bus.count();
    expect(n).toBeGreaterThan(3);
    w.cafe.dispose(); w.cafe.dispose();
    expect(w.bus.count()).toBeLessThan(n);
  });
});

describe('café: progression and upgrade benefits', () => {
  it('upgrade levels unlock with the game stage, and say so', () => {
    const early = makeCafe({ cash: 1e6, stage: 3, menu: 0 });
    expect(early.cafe.upgrade('machine').ok).toBe(true); // level 1: stage 3
    expect(early.cafe.upgrade('machine').ok).toBe(true); // level 2: stage 3
    expect(early.cafe.upgradeInfo('machine')).toMatchObject({ reason: 'Unlocks at Stage 4' }); // level 3: stage 4
    expect(early.cafe.upgrade('machine')).toMatchObject({ ok: false, reason: 'Unlocks at Stage 4' });
    expect(early.economy.cash).toBe(1e6 - 2500 - 6000); // nothing charged for the locked one
    early.cafe.upgrade('seating');
    expect(early.cafe.upgrade('seating')).toMatchObject({ ok: false, reason: 'Unlocks at Stage 4' });
    const late = makeCafe({ cash: 1e6, stage: 4, menu: 0 });
    for (let i = 0; i < 5; i++) { late.cafe.upgrade('machine'); late.cafe.upgrade('seating'); late.cafe.upgrade('menu'); late.cafe.upgrade('storage'); }
    expect(late.cafe.levels).toEqual({ machine: 3, storage: 2, seating: 3, menu: 2 });
  });

  it('every upgrade has a measurable effect on the café', () => {
    const w = makeCafe({ cash: 1e6, menu: 0 });
    const before = { prep: w.cafe.prepSeconds('espresso'), cap: w.cafe.cap('milk'), seats: w.cafe.seats, demand: w.cafe.demandMult, products: w.cafe.products().filter((p) => p.unlocked).length };
    w.cafe.upgrade('machine'); w.cafe.upgrade('storage'); w.cafe.upgrade('seating'); w.cafe.upgrade('menu');
    expect(w.cafe.prepSeconds('espresso')).toBeLessThan(before.prep);
    expect(w.cafe.cap('milk')).toBeGreaterThan(before.cap);
    expect(w.cafe.seats).toBeGreaterThan(before.seats);
    expect(w.cafe.demandMult).toBeGreaterThan(before.demand);
    expect(w.cafe.products().filter((p) => p.unlocked).length).toBeGreaterThan(before.products);
  });

  it('the benefit text for more seats is an estimate from today\'s real sales, with a payback time', () => {
    const w = makeCafe({ cash: 1e6 });
    expect(w.cafe.benefit('seating')).toBeNull(); // no sales yet: nothing honest to say
    w.cafe.today.revenue = 100;
    const text = w.cafe.benefit('seating');
    expect(text).toMatch(/\+\$25\.00 per day/); // demand x1.00 -> x1.25 on $100
    expect(text).toMatch(/pays back in about 80 days/); // $2,000 / $25
  });

  it('walk-outs and sold-out customers are reported as the reason to buy faster service / more storage', () => {
    const w = makeCafe({ cash: 1e6 });
    expect(w.cafe.benefit('machine')).toBeNull();
    expect(w.cafe.benefit('storage')).toBeNull();
    w.cafe.stats.lostBy['waited too long'] = 3; w.cafe.stats.lostBy['sold out'] = 1;
    expect(w.cafe.benefit('machine')).toMatch(/3 customers left because the wait was too long/);
    expect(w.cafe.benefit('storage')).toMatch(/1 customer left because something was sold out/);
  });

  it('the menu upgrade names the profit of the products it unlocks (real margins)', () => {
    const w = makeCafe({ cash: 1e6, menu: 0 });
    const text = w.cafe.benefit('menu');
    const latte = w.cafe.products().find((p) => p.id === 'latte');
    expect(text).toContain(`Latte earns $${latte.profit.toFixed(2)} profit per sale`);
    w.cafe.levels.menu = 2;
    expect(w.cafe.benefit('menu')).toBeNull(); // maxed
  });

  it('café missions, goals and statistics are wired: served orders and revenue are tracked per day for goals', async () => {
    const { StatsTracker } = await import('../src/progression/StatsTracker.js');
    const w = makeCafe({ cash: 0 });
    const stats = new StatsTracker(w.bus);
    const { c } = walkIn(w, 'espresso'); w.cafe.finishOrder(c.order);
    expect(stats.total.cafeOrders).toBe(1);
    expect(stats.total.cafeRevenue).toBe(3.5);
    expect(stats.today.cafeOrders).toBe(1);
    expect(stats.total.served).toBe(0); // a cafe order is not a second "customer served"
  });
});
