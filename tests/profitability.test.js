import { describe, it, expect } from 'vitest';
import { businessProfits } from '../src/economy/Profitability.js';
import { EventBus } from '../src/core/EventBus.js';
import { EconomyManager } from '../src/economy/EconomyManager.js';
import { MissionManager } from '../src/progression/MissionManager.js';
import { GoalManager } from '../src/progression/GoalManager.js';
import { StatsTracker } from '../src/progression/StatsTracker.js';
import { data } from './helpers.js';

const biz = [
  { id: 'station', label: 'Station', icon: 'S', sources: ['charging', 'store'], depts: ['charging'], open: true },
  { id: 'cafe', label: 'Cafe', icon: 'C', sources: ['cafe', 'coffee'], depts: ['cafe'], open: true },
  { id: 'wash', label: 'Wash', icon: 'W', sources: ['car wash'], depts: ['wash'], open: false },
];
const emp = (salary, home, leaving = false) => ({ salary, home, leaving });
const homeOf = (e) => e.home;

describe('profit by business', () => {
  it('attributes revenue, direct costs and payroll to the right business', () => {
    const ledger = { revenue: { charging: 200, store: 20, cafe: 50, tips: 10, contracts: 100 }, expenses: { electricity: 40, ingredients: 15, parts: 999, property: 30, salaries: 0 } };
    const p = businessProfits({ ledger, businesses: biz, employees: [emp(100, 'charging'), emp(80, 'cafe'), emp(60, 'cafe'), emp(500, 'charging', true)], homeOf });
    const station = p.rows.find((r) => r.id === 'station'), cafe = p.rows.find((r) => r.id === 'cafe');
    expect(station).toMatchObject({ revenue: 220, costs: 40, payroll: 100, profit: 80, staff: 1 });
    expect(cafe).toMatchObject({ revenue: 50, costs: 15, payroll: 140, profit: -105, staff: 2 });
    expect(p.rows).toHaveLength(2); // the wash is not open: not listed
  });

  it('income that belongs to no single business is "other"; shared costs are never split by guesswork', () => {
    const ledger = { revenue: { charging: 100, tips: 10, contracts: 100 }, expenses: { electricity: 10, property: 30, equipment: 70, hiring: 5, mystery: 3 } };
    const p = businessProfits({ ledger, businesses: biz, employees: [], homeOf });
    expect(p.other).toBe(110);
    expect(p.shared).toBe(108); // property + equipment + hiring + an unknown category
    expect(p.totalRevenue).toBe(210);
    expect(p.totalProfit).toBe(100 - 10 + 110 - 108);
  });

  it('the total equals the sum of the parts (no double counting of payroll)', () => {
    const ledger = { revenue: { charging: 500, cafe: 100, tips: 20 }, expenses: { electricity: 100, ingredients: 30, property: 10, salaries: 50 } };
    const p = businessProfits({ ledger, businesses: biz, employees: [emp(100, 'charging'), emp(40, 'cafe')], homeOf });
    const parts = p.rows.reduce((n, r) => n + r.profit, 0);
    expect(p.totalProfit).toBeCloseTo(parts + p.other - p.shared, 2);
    expect(p.shared).toBe(60); // property + salaries already booked (severance)
  });

  it('works with an empty ledger and no businesses', () => {
    const p = businessProfits({ ledger: { revenue: {}, expenses: {} }, businesses: [], employees: [], homeOf });
    expect(p).toEqual({ rows: [], other: 0, shared: 0, totalRevenue: 0, totalProfit: 0 });
  });

  it('margin is null when there is no revenue (no division by zero)', () => {
    const p = businessProfits({ ledger: { revenue: {}, expenses: {} }, businesses: biz, employees: [emp(10, 'charging')], homeOf });
    expect(p.rows[0].margin).toBeNull();
    expect(p.rows[0].profit).toBe(-10);
  });
});

describe('missions and goals for the café', () => {
  it('café missions are appended after every old mission, so saved progress keeps its meaning', () => {
    const econ = new EconomyManager(new EventBus(), { cash: 0 });
    const m = new MissionManager(new EventBus(), econ);
    const ids = m.list().map((x) => x.id);
    expect(ids.slice(-4)).toEqual(['m_barista', 'm_cafe10', 'm_cafe_up', 'm_cafe_money']);
    expect(ids.indexOf('m_rev')).toBe(ids.length - 5); // the old last mission keeps its position
  });

  it('the café mission chain progresses from real café events', () => {
    const bus = new EventBus();
    const econ = new EconomyManager(bus, { cash: 0 });
    const m = new MissionManager(bus, econ);
    m.index = m.list().findIndex((x) => x.id === 'm_barista');
    bus.emit('employee:hired', { employee: { role: 'attendant' } });
    expect(m.current.id).toBe('m_barista'); // wrong role: not counted
    bus.emit('employee:hired', { employee: { role: 'barista' } });
    expect(m.current.id).toBe('m_cafe10');
    for (let i = 0; i < 10; i++) bus.emit('cafe:served', { amount: 4 });
    expect(m.current.id).toBe('m_cafe_up');
    bus.emit('cafe:upgraded', { kind: 'machine' });
    expect(m.current.id).toBe('m_cafe_money');
    bus.emit('cafe:served', { amount: 299 }); expect(m.current.id).toBe('m_cafe_money');
    bus.emit('cafe:served', { amount: 1 }); expect(m.current).toBeNull();
    expect(econ.cash).toBeGreaterThan(0); // every mission paid its reward through the economy
  });

  it('a barista hired BEFORE the mission appeared still completes it', () => {
    const bus = new EventBus();
    const m = new MissionManager(bus, new EconomyManager(bus, { cash: 0 }));
    m.have = { baristas: () => 1, employees: () => 1 };
    m.index = m.list().findIndex((x) => x.id === 'm_cafe_money') - 3;
    m.syncCurrent();
    expect(m.current.id).toBe('m_cafe10');
  });

  it('daily / weekly café goals only roll when the café is open', () => {
    const cfg = data('missions');
    const bus = new EventBus();
    const econ = new EconomyManager(bus, { cash: 0 });
    const stats = new StatsTracker(bus);
    const mk = (open) => new GoalManager({ bus, economy: econ, stats, cfg, progression: { isUnlocked: () => true, stage: 3 }, ctx: { washBuilt: () => false, garageBuilt: () => false, cafeBuilt: () => open, employees: () => 0, properties: () => 0, decor: () => 0 } });
    const closed = mk(false), open = mk(true);
    expect(cfg.daily.filter((t) => t.requires === 'cafe').length).toBeGreaterThanOrEqual(2);
    expect(cfg.daily.filter((t) => t.requires === 'cafe').every((t) => !closed.available(t))).toBe(true);
    expect(cfg.daily.filter((t) => t.requires === 'cafe').every((t) => open.available(t))).toBe(true);
    expect(cfg.weekly.some((t) => t.requires === 'cafe')).toBe(true);
    expect(cfg.achievements.map((a) => a.id)).toEqual(expect.arrayContaining(['a_cafe50', 'a_cafe_rev']));
  });

  it('a café daily goal completes from café orders and pays its reward once', () => {
    const cfg = data('missions');
    const bus = new EventBus();
    const econ = new EconomyManager(bus, { cash: 0 });
    const stats = new StatsTracker(bus);
    const goals = new GoalManager({ bus, economy: econ, stats, cfg, progression: { isUnlocked: () => true, stage: 3 }, ctx: { washBuilt: () => false, garageBuilt: () => false, cafeBuilt: () => true, employees: () => 0, properties: () => 0, decor: () => 0 } });
    const tpl = cfg.daily.find((t) => t.id === 'd_cafe');
    const g = goals.make(tpl, 'daily');
    goals.daily = [g];
    goals.dailyBonusDone = true; // the all-dailies bonus is a separate reward: not under test here
    for (let i = 0; i < g.target - 1; i++) bus.emit('cafe:served', { amount: 3 });
    goals.check(); expect(g.done).toBe(false);
    bus.emit('cafe:served', { amount: 3 });
    const cash = econ.cash;
    goals.check(); expect(g.done).toBe(true);
    expect(econ.cash).toBe(cash + g.reward.cash);
    goals.check(); expect(econ.cash).toBe(cash + g.reward.cash); // not paid twice
  });
});

describe('economy integrity over a long run', () => {
  it('cash, revenue and the ledger stay consistent, never negative, never NaN, with no duplicate payments', async () => {
    const { makeWorld, spawnCustomer, parkAndPlug } = await import('./helpers.js');
    const w = makeWorld({ cash: 5000 });
    const start = w.economy.cash;
    let served = 0;
    w.bus.on('customer:paid', () => served++);
    for (let i = 0; i < 60; i++) {
      parkAndPlug(w, spawnCustomer(w)); // a customer arrives, plugs in and charges for a while
      for (let t = 0; t < 300; t++) w.station.update(1);
      for (const b of w.station.bays) { if (b.state === 'done') { w.station.release(b.id); w.station.vehicleLeft(b.id); } }
      w.customers.update(1);
      expect(Number.isFinite(w.economy.cash)).toBe(true);
      expect(w.economy.cash).toBeGreaterThanOrEqual(0);
    }
    const L = w.economy.ledger;
    const revenue = Object.values(L.revenue).reduce((a, b) => a + b, 0);
    expect(served).toBeGreaterThan(20);
    expect(Math.abs(revenue - w.economy.totalRevenue)).toBeLessThan(0.05);
    const expenses = Object.values(L.expenses).reduce((a, b) => a + b, 0);
    expect(Math.abs(w.economy.cash - (start + revenue - expenses))).toBeLessThan(0.5); // every cent is in the ledger
    expect(w.economy.txOrder.length).toBe(new Set(w.economy.txOrder).size); // no payment id used twice
  });

  it('the café adds revenue and costs only through the ledger (source "cafe", category "ingredients")', async () => {
    const bus = new EventBus();
    const { Cafe } = await import('../src/businesses/Cafe.js');
    const { TaskManager } = await import('../src/employees/TaskManager.js');
    const economy = new EconomyManager(bus, { cash: 1000 });
    const cafe = new Cafe({ bus, economy, cfg: data('cafe'), hub: { built: { coffee: true } }, tasks: new TaskManager(bus) });
    cafe.spawnTimer = 1e12;
    const start = economy.cash;
    cafe.restock('beans', 10);
    for (let i = 0; i < 5; i++) { const c = { id: `k${i}`, kind: 'walkin', type: 'commuter', def: { label: 'C', spend: 1 }, patience: 40, maxPatience: 40, state: 'arriving' }; cafe.placeOrder(c, 'espresso'); cafe.customers.set(c.id, c); cafe.finishOrder(c.order); }
    const L = economy.ledger;
    expect(L.revenue.cafe).toBe(17.5);
    expect(L.expenses.ingredients).toBe(5);
    const tips = L.revenue.tips || 0;
    expect(economy.cash).toBeCloseTo(start + 17.5 + tips - 5, 2);
  });
});
