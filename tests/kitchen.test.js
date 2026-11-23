import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { EconomyManager } from '../src/economy/EconomyManager.js';
import { TaskManager } from '../src/employees/TaskManager.js';
import { Cafe } from '../src/businesses/Cafe.js';
import { CafeKitchen } from '../src/businesses/CafeKitchen.js';
import { data } from './helpers.js';

function make({ menu = 2 } = {}) {
  const bus = new EventBus(), economy = new EconomyManager(bus, { cash: 50000, gems: 0 }), tasks = new TaskManager(bus);
  const hub = { built: { coffee: true, store: false, lounge: false } };
  const cafe = new Cafe({ bus, economy, cfg: data('cafe'), hub, tasks, getHour: () => 12, getReputation: () => 0, getStage: () => 4, saved: null });
  cafe.onBuilt(); cafe.levels.menu = menu; cafe.spawnTimer = 1e12;
  const kitchen = new CafeKitchen({ cafe, bus });
  const order = (pid = 'espresso', patience = 40) => {
    const c = { id: `c${Math.random()}`, kind: 'walkin', type: 'commuter', def: { label: 'Commuter', icon: '🧑‍💼', spend: 1, prefs: { [pid]: 1 } }, state: 'arriving', patience, maxPatience: patience, order: null, ref: null };
    const r = cafe.placeOrder(c, pid); if (r.ok) cafe.customers.set(c.id, c); return r.order;
  };
  const run = (secs) => { for (let t = 0; t < secs; t += 0.1) { cafe.update(0.1); kitchen.update(0.1); } };
  return { bus, economy, tasks, cafe, kitchen, order, run };
}

describe('café kitchen: data', () => {
  it('every product has a recipe made only of real stations, and every station is used', () => {
    const { cafe } = make(); const k = cafe.cfg.kitchen;
    for (const id of Object.keys(cafe.cfg.products)) { expect(k.recipes[id], id).toBeTruthy(); for (const s of k.recipes[id]) expect(k.stations[s], `${id}:${s}`).toBeTruthy(); }
    const used = new Set(Object.values(k.recipes).flat());
    expect(Object.keys(k.stations).filter((s) => !used.has(s))).toEqual([]);
    const keys = Object.values(k.stations).map((s) => s.key); expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('café kitchen: claiming orders', () => {
  it('selecting a ticket claims the order: staff can no longer take it', () => {
    const w = make(); const o = w.order('latte'); w.cafe.publishTasks();
    expect(w.tasks.open('cafe')).toHaveLength(1);
    expect(w.kitchen.select(o.id).ok).toBe(true);
    expect(o.kitchen).toBe(true); expect(o.state).toBe('preparing'); expect(o.by).toBe('owner');
    expect(w.tasks.open('cafe')).toHaveLength(0);
    w.cafe.publishTasks(); expect(w.tasks.open('cafe')).toHaveLength(0);
    expect(w.kitchen.ticket.steps).toEqual({ cup: 'todo', espresso: 'todo', steamer: 'todo' });
  });
  it('refuses an order a barista is already working on', () => {
    const w = make(); const o = w.order('espresso'); w.cafe.publishTasks();
    w.tasks.request({ id: 'barista1', dept: 'cafe', pos: { x: 0, z: 0 } });
    expect(w.kitchen.select(o.id)).toMatchObject({ ok: false });
    expect(o.kitchen).toBeFalsy();
  });
  it('closing the kitchen gives unfinished orders back to the queue (and to the staff)', () => {
    const w = make(); const a = w.order('espresso'), b = w.order('croissant');
    w.kitchen.select(a.id); w.kitchen.tapStation('cup'); w.kitchen.select(b.id);
    w.kitchen.close();
    expect([a.kitchen, b.kitchen]).toEqual([false, false]); expect([a.state, b.state]).toEqual(['queued', 'queued']);
    w.cafe.publishTasks(); expect(w.tasks.open('cafe')).toHaveLength(2);
    expect(w.kitchen.tickets.size).toBe(0);
  });
  it('a customer who gives up removes the ticket and breaks the combo', () => {
    const w = make(); const o = w.order('espresso', 3); w.kitchen.select(o.id); w.kitchen.combo = 3;
    w.run(4);
    expect(w.kitchen.tickets.size).toBe(0); expect(w.kitchen.selected).toBeNull(); expect(w.kitchen.combo).toBe(0);
    expect(w.kitchen.note.kind).toBe('bad');
  });
});

describe('café kitchen: cooking', () => {
  it('needs a ticket, and only accepts stations the recipe needs', () => {
    const w = make(); const o = w.order('espresso');
    expect(w.kitchen.tapStation('espresso')).toMatchObject({ ok: false, reason: 'no ticket' });
    w.kitchen.select(o.id);
    expect(w.kitchen.tapStation('oven')).toMatchObject({ ok: false, reason: 'not needed' });
    expect(w.kitchen.note.text).toMatch(/Still needs: Cups, Espresso machine/);
    expect(w.kitchen.nextStations().sort()).toEqual(['cup', 'espresso']);
  });

  it('a full espresso: parallel stations, perfect timing, payment + quality tip, stats', () => {
    const w = make({}); const o = w.order('espresso'); w.kitchen.select(o.id);
    expect(w.kitchen.tapStation('cup').ok).toBe(true); expect(w.kitchen.tapStation('espresso').ok).toBe(true);
    expect(w.kitchen.tapStation('espresso')).toMatchObject({ ok: false, reason: 'Still working…' });
    w.kitchen.update(0.7); expect(w.kitchen.jobs.cup.state).toBe('ready'); expect(w.kitchen.jobs.espresso.state).toBe('working');
    expect(w.kitchen.tapStation('cup').collected).toBe(true);
    w.kitchen.update(2.0); expect(w.kitchen.jobs.espresso.state).toBe('ready');
    const r = w.kitchen.tapStation('espresso');
    expect(r).toMatchObject({ ok: true, served: true, quality: 1 });
    expect(w.cafe.orders).toHaveLength(0); expect(w.cafe.stats.served).toBe(1);
    expect(w.economy.ledger.revenue.cafe).toBe(3.5);
    expect(r.bonus).toBeCloseTo(3.5 * 0.6 * 1 * 1.25, 1); // first good order: combo 1 -> x1.25
    expect(w.kitchen.combo).toBe(1); expect(w.kitchen.session.served).toBe(1); expect(w.kitchen.note.kind).toBe('perfect');
    expect(w.kitchen.selected).toBeNull();
  });

  it('serving cannot pay twice', () => {
    const w = make(); const o = w.order('croissant'); w.kitchen.select(o.id);
    expect(w.cafe.serveKitchen(o, { quality: 1, mult: 1 }).ok).toBe(true);
    expect(w.cafe.serveKitchen(o, { quality: 1, mult: 1 })).toMatchObject({ ok: false });
    expect(w.cafe.stats.served).toBe(1);
  });

  it('waiting too long lowers the quality; the combo needs good orders in a row', () => {
    const w = make();
    const cook = (pid, wait) => { const o = w.order(pid); w.kitchen.select(o.id); w.kitchen.tapStation('press'); w.kitchen.update(3.1); w.kitchen.update(wait); return w.kitchen.tapStation('press'); };
    const a = cook('sandwich', 0.5); expect(a.quality).toBe(1); expect(w.kitchen.combo).toBe(1);
    const b = cook('sandwich', 3); expect(b.quality).toBe(0.65); expect(w.kitchen.combo).toBe(2); // still good
    expect(b.bonus).toBeGreaterThan(a.bonus * 0.65); // bigger combo multiplier
    const c = cook('sandwich', 6); expect(c.quality).toBe(0.3); expect(w.kitchen.combo).toBe(0); // stale: combo lost
  });

  it('the oven burns an item that is left; collecting the burnt one resets the step and the combo', () => {
    const w = make(); const o = w.order('croissant'); w.kitchen.select(o.id); w.kitchen.combo = 4;
    w.kitchen.tapStation('oven'); w.kitchen.update(3.5); w.kitchen.update(7.5);
    expect(w.kitchen.jobs.oven.state).toBe('burnt'); expect(w.kitchen.ticket.steps.oven).toBe('burnt');
    expect(w.kitchen.tapStation('oven')).toMatchObject({ ok: true, cleared: true });
    expect(w.kitchen.combo).toBe(0); expect(w.kitchen.session.burnt).toBe(1); expect(w.kitchen.ticket.steps.oven).toBe('todo');
    expect(w.kitchen.tapStation('oven').started).toBe(true); // can be started again
  });

  it('a better espresso machine makes every station faster', () => {
    const w = make(); const base = w.kitchen.stationDuration('espresso');
    w.cafe.levels.machine = 2;
    expect(w.kitchen.stationDuration('espresso')).toBeCloseTo(base / (1 + 0.12 * 2), 5);
  });

  it('works on several tickets at once: jobs stay with their own order', () => {
    const w = make(); const a = w.order('espresso'), b = w.order('iced');
    w.kitchen.select(a.id); w.kitchen.tapStation('cup');
    w.kitchen.select(b.id); expect(w.kitchen.nextStations().sort()).toEqual(['cup', 'espresso', 'ice'].filter((s) => s !== 'cup' || true).filter((s) => s !== 'cup' || !w.kitchen.jobs.cup));
    expect(w.kitchen.jobs.cup.oid).toBe(a.id);
    w.kitchen.update(1);
    // collecting the cup for order A while B is selected still credits A
    w.kitchen.tapStation('cup');
    expect(w.kitchen.tickets.get(a.id).steps.cup).toBe('done'); expect(w.kitchen.tickets.get(b.id).steps.cup).toBe('todo');
  });
});