import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { EconomyManager } from '../src/economy/EconomyManager.js';
import { CafeCozy } from '../src/businesses/CafeCozy.js';
import { CafeRoster } from '../src/businesses/CafeRoster.js';
import { CafeDecor } from '../src/businesses/CafeDecor.js';
import { data } from './helpers.js';

const cfg = () => data('cafe-cozy');
const lcg = (seed = 7) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

function make({ xp = 0, day = 1, hour = 12, rng = lcg(), saved = null, level = 0 } = {}) {
  const bus = new EventBus(), economy = new EconomyManager(bus, { cash: 100, gems: 0 });
  let clock = 1e9, today = day;
  const cz = new CafeCozy({ economy, bus, cfg: cfg(), saved, getDay: () => today, getHour: () => hour, getMachineLevel: () => level, now: () => clock, rng });
  if (!saved) cz.xp = xp;
  cz.lastLevel = cz.level;
  const run = (secs, dt = 0.1) => { for (let t = 0; t < secs && cz.open; t += dt) cz.update(dt); };
  /** put a hand-made customer in the shop (keeps tests independent of the random arrivals) */
  const addCustomer = (rid, lines, patience = 100) => {
    const def = cz.cfg.customers[rid];
    const c = { id: `t${Math.random()}`, rid, name: def.name, icon: def.icon, category: def.category, vip: def.vip, colors: { shirt: def.shirt, hat: def.hat, skin: def.skin }, lines: lines.map((l) => (typeof l === 'string' ? { pid: l, requests: [], done: false, product: null } : { requests: [], done: false, product: null, ...l })), patience, maxPatience: patience, state: 'waiting', eatLeft: 0, sats: [], liked: false, chatReady: false, spawnedAt: 0 };
    cz.session.customers.push(c); return c;
  };
  const open = () => { expect(cz.openShift().ok).toBe(true); cz.session.spawnTimer = 1e9; };
  /** cook the customer's first open line perfectly (no mistakes), then serve */
  const cook = (c, { addons = [], serve = true } = {}) => {
    cz.tapCustomer(c.id);
    const li = c.lines.findIndex((l) => !l.done), pid = c.lines[li].pid, B = cz.book;
    if (B.isDisplay(pid)) cz.tapDisplay(pid);
    else {
      for (const [raw, n] of Object.entries(B.needs(pid))) for (let i = 0; i < n; i++) { const r = cz.addIngredient(raw); if (!r.ok) throw new Error(`add ${raw}: ${r.reason}`); }
      for (const a of addons) cz.addIngredient(a);
      let guard = 0;
      while (cz.session.build && guard++ < 500) {
        const b = cz.session.build, ready = Object.entries(cz.session.jobs).find(([, j]) => j.state === 'ready');
        if (ready) { cz.tapMachine(ready[0]); continue; }
        if (Object.keys(cz.session.jobs).length) { cz.update(0.2); continue; }
        const id = B.machinesFor(pid).find((m) => B.inputsFor(m, b.tray, pid).ok);
        if (!id) break;
        cz.tapMachine(id);
      }
    }
    return serve ? cz.tapCustomer(c.id) : null;
  };
  return { bus, economy, cz, run, addCustomer, open, cook, tick: (ms) => { clock += ms; }, setDay: (d) => { today = d; } };
}

describe('café cozy: data', () => {
  it('every one of the 19 products can be made from its ingredients with the machines available (and unlock levels are sane)', () => {
    const w = make({ xp: 99999 }); w.open();
    const ids = Object.keys(cfg().products); expect(ids.length).toBe(19);
    expect(Object.values(cfg().products).filter((p) => p.kind === 'drink')).toHaveLength(11);
    expect(Object.values(cfg().products).filter((p) => p.kind === 'dessert')).toHaveLength(8);
    for (const pid of ids) { const c = w.addCustomer('mina', [pid]); const r = w.cook(c); expect(r.served, pid).toBe(true); }
    expect(w.cz.session.served).toBe(19);
    for (const [id, p] of Object.entries(cfg().products)) { expect(p.level).toBeGreaterThanOrEqual(1); expect(p.level, id).toBeLessThanOrEqual(w.cz.maxLevel); for (const m of p.machines) expect(w.cz.cfg.machines[m].level, `${id}:${m}`).toBeLessThanOrEqual(p.level); }
  });
  it('the recipe book explains every product step by step', () => {
    const w = make(); for (const pid of Object.keys(cfg().products)) { const st = w.cz.book.steps(pid); expect(st.length, pid).toBeGreaterThanOrEqual(1); }
    expect(w.cz.book.steps('latte').map((s) => s.text).join('|')).toMatch(/Coffee grinder.*Espresso machine.*Milk steamer.*Combine/);
  });
  it('requests only point at products they fit, and need add-ons that exist', () => {
    for (const [id, r] of Object.entries(cfg().requests)) { for (const p of r.only) expect(cfg().products[p], `${id}:${p}`).toBeTruthy(); const a = r.addon || r.forbid; expect(cfg().ingredients[a] || a === 'ice', `${id}:${a}`).toBeTruthy(); }
  });
  it('every customer has a profile and a story with chapters, and categories cover the spec', () => {
    const c = cfg().customers, cats = new Set(Object.values(c).map((x) => x.category));
    for (const k of ['student', 'office', 'tourist', 'artist', 'regular', 'vip', 'story']) expect(cats.has(k), k).toBe(true);
    for (const [id, x] of Object.entries(c)) { expect(x.name && x.personality && x.bio, id).toBeTruthy(); expect(x.story.length, id).toBeGreaterThanOrEqual(3); expect(x.likes.drinks.length).toBeGreaterThan(0); for (const b of x.story) { expect(b.lines.length).toBeGreaterThanOrEqual(2); expect(b.lines[0].text.length).toBeGreaterThan(10); } expect(x.story.at(-1).reward?.unlock?.decor, id).toBeTruthy(); expect(cfg().decor.items[x.story.at(-1).reward.unlock.decor].gift, id).toBe(true); }
  });
});

describe('café cozy: shifts, customers, orders', () => {
  it('a shift opens, serves, closes with a summary, and can be repeated', () => {
    const w = make(); expect(w.cz.state).toBe('idle'); expect(w.cz.openShift().ok).toBe(true); expect(w.cz.openShift()).toMatchObject({ ok: false });
    w.cz.session.spawnTimer = 1e9; w.cook(w.addCustomer('mina', ['espresso']));
    const sum = w.cz.closeShift(); expect(sum.served).toBe(1); expect(w.cz.state).toBe('summary');
    w.cz.dismiss(); expect(w.cz.state).toBe('idle'); w.tick(60_000); expect(w.cz.openShift().ok).toBe(true);
  });
  it('customers arrive by themselves, one at a time, never more than the queue allows; closing time comes after the shift quota', () => {
    const w = make(); w.cz.openShift(); const s = w.cz.session;
    w.run(8); expect(s.customers.length).toBeGreaterThanOrEqual(1); expect(s.customers.length).toBeLessThanOrEqual(w.cz.cfg.service.maxQueue);
    for (let i = 0; i < 1600; i++) { w.cz.update(0.25); }
    expect(s.spawned).toBeLessThanOrEqual(w.cz.cfg.service.shiftCustomers);
    expect(s.closing).toBe(true); expect(['summary']).toContain(w.cz.state); // everybody left unhappy-or-served, the café closed by itself
  });
  it('arrivals respect the café level and the customers\' usual hours', () => {
    const w = make({ xp: 0, hour: 8, rng: lcg(3) });
    const r = new CafeRoster({ cfg: cfg(), rng: lcg(3) });
    const seen = new Set(); for (let i = 0; i < 400; i++) { r.last = null; seen.add(r.pick({ level: 1, hour: 8, day: 1 })); }
    for (const id of seen) expect(cfg().customers[id].level).toBeLessThanOrEqual(1);
    expect(seen.has('vale')).toBe(false);
    const morning = { mina: 0, priya: 0 }; for (let i = 0; i < 600; i++) { r.last = null; const id = r.pick({ level: 1, hour: 8, day: 1 }); if (id in morning) morning[id]++; }
    expect(morning.mina).toBeGreaterThan(morning.priya); void w; // Mina is a morning person, Priya comes after work
  });
  it('orders use unlocked products only, may have two items, and requests appear from level 2', () => {
    const w = make({ xp: 0, rng: lcg(11) }); w.cz.openShift(); const s = w.cz.session;
    for (let i = 0; i < 40; i++) { s.customers.length = 0; const c = w.cz.spawnCustomer(); for (const l of c.lines) { expect(cfg().products[l.pid].level).toBeLessThanOrEqual(1); expect(l.requests).toEqual([]); } }
    const w2 = make({ xp: 600, rng: lcg(11) }); w2.cz.openShift(); let reqs = 0, two = 0;
    for (let i = 0; i < 200; i++) { w2.cz.session.customers.length = 0; const c = w2.cz.spawnCustomer(); if (c.lines.length === 2) two++; for (const l of c.lines) { expect(cfg().products[l.pid].level).toBeLessThanOrEqual(w2.cz.level); reqs += l.requests.length; } }
    expect(reqs).toBeGreaterThan(0); expect(two).toBeGreaterThan(0);
  });
  it('a customer who waits too long leaves; nobody is punished (no strikes, the café stays open)', () => {
    const w = make(); w.open(); const c = w.addCustomer('priya', ['espresso'], 1); w.run(2);
    expect(w.cz.session.customers).not.toContain(c); expect(w.cz.open).toBe(true); expect(w.cz.session.lost).toBe(1); expect(w.cz.state).toBe('open');
  });
});

describe('café cozy: preparing drinks and desserts', () => {
  it('wrong ingredient / wrong machine are mistakes with a message; nothing is consumed by a refusal', () => {
    const w = make(); w.open(); const c = w.addCustomer('mina', ['latte']); w.cz.tapCustomer(c.id); const milk = w.cz.pantry.milk;
    expect(w.cz.addIngredient('flour')).toMatchObject({ ok: false, reason: 'wrong' }); expect(w.cz.note.kind).toBe('bad'); expect(w.cz.session.build.mistakes).toBe(1);
    expect(w.cz.tapMachine('oven')).toMatchObject({ ok: false }); expect(w.cz.pantry.flour).toBe(w.cz.cfg.pantry.cap);
    expect(w.cz.addIngredient('milk').ok).toBe(true); expect(w.cz.pantry.milk).toBe(milk - 1);
    expect(w.cz.addIngredient('milk')).toMatchObject({ ok: false, reason: 'wrong' }); // a latte needs one milk only
    expect(w.cz.tapMachine('espresso')).toMatchObject({ ok: false, reason: 'missing' });
  });
  it('latte follows its recipe: grind, espresso, steam, combine; the result is a latte', () => {
    const w = make(); w.open(); const c = w.addCustomer('mina', ['latte']); w.cz.tapCustomer(c.id);
    for (const r of ['cup', 'beans', 'milk']) w.cz.addIngredient(r);
    expect(w.cz.tapMachine('grinder').started).toBe(true); w.run(1.5); expect(w.cz.tapMachine('grinder').collected).toBe(true);
    expect(w.cz.tapMachine('espresso').started).toBe(true); expect(w.cz.tapMachine('steamer').started).toBe(true); w.run(2.6);
    w.cz.tapMachine('espresso'); w.cz.tapMachine('steamer');
    expect(w.cz.session.pickup.map((p) => p.pid)).toEqual(['latte']); expect(w.cz.session.build).toBeNull();
    expect(w.cz.tapCustomer(c.id).served).toBe(true);
  });
  it('cappuccino needs two steamed milks; mocha a chocolate; the drip machine makes tea', () => {
    const w = make({ xp: 9999 }); w.open();
    const cap = w.cook(w.addCustomer('juno', ['cappuccino'])); expect(cap.served).toBe(true);
    const tea = w.addCustomer('okafor', ['tea']); w.cz.tapCustomer(tea.id); for (const r of ['cup', 'tea', 'water']) w.cz.addIngredient(r);
    expect(w.cz.tapMachine('grinder')).toMatchObject({ ok: false }); expect(w.cz.tapMachine('drip').started).toBe(true);
  });
  it('desserts: donut and croissant come from the display (stock is used), the rest are baked: mixer then oven', () => {
    const w = make({ xp: 9999 }); w.open(); const stock = w.cz.display.donut;
    expect(w.cook(w.addCustomer('theo', ['donut'])).served).toBe(true); expect(w.cz.display.donut).toBe(stock - 1);
    const c = w.addCustomer('theo', ['brownie']); w.cz.tapCustomer(c.id); for (const r of ['flour', 'chocolate', 'egg']) w.cz.addIngredient(r);
    expect(w.cz.tapMachine('oven')).toMatchObject({ ok: false, reason: 'missing' }); // nothing mixed yet
    expect(w.cz.tapMachine('mixer').started).toBe(true); w.run(2.2); w.cz.tapMachine('mixer'); expect(w.cz.tapMachine('oven').started).toBe(true); w.run(3.4); expect(w.cz.tapMachine('oven').collected).toBe(true);
    expect(w.cz.session.pickup[0].pid).toBe('brownie');
    const d = w.addCustomer('theo', ['croissant']); w.cz.tapCustomer(d.id); expect(w.cz.tapDisplay('donut')).toMatchObject({ ok: false, reason: 'wrong' });
  });
  it('the oven burns what is left: the ingredients can be gathered again, the display runs out, the pantry runs out', () => {
    const w = make({ xp: 9999 }); w.open(); const c = w.addCustomer('rosa', ['cookie']); w.cz.tapCustomer(c.id); for (const r of ['flour', 'butter', 'chocolate']) w.cz.addIngredient(r);
    w.cz.tapMachine('mixer'); w.run(2.2); w.cz.tapMachine('mixer'); w.cz.tapMachine('oven'); w.run(3.1); w.run(9);
    expect(w.cz.session.jobs.oven.state).toBe('burnt'); w.cz.session.combo = 3;
    expect(w.cz.tapMachine('oven')).toMatchObject({ discarded: true }); expect(w.cz.session.combo).toBe(0); expect(w.cz.session.build.used.flour).toBe(0);
    expect(w.cz.addIngredient('flour').ok).toBe(true);
    w.cz.pantry.butter = 0; expect(w.cz.addIngredient('butter')).toMatchObject({ ok: false, reason: 'out' });
    w.cz.display.donut = 0; const dd = w.addCustomer('rosa', ['donut']); w.cz.discardBuild(); w.cz.tapCustomer(dd.id); expect(w.cz.tapDisplay('donut')).toMatchObject({ ok: false, reason: 'out' });
  });
  it('restocking spends city cash (a supplies expense); a new shift refills the pantry a little by itself', () => {
    const w = make(); w.cz.pantry.milk = 0; w.cz.display.donut = 0; const info = w.cz.restockInfo(); expect(info.cost).toBeGreaterThan(0);
    const cash = w.economy.cash, exp = w.economy.todayExpenses; const r = w.cz.restock(); expect(r.ok).toBe(true);
    expect(w.economy.cash).toBeCloseTo(cash - info.cost, 2); expect(w.economy.todayExpenses).toBeGreaterThan(exp); expect(w.cz.pantry.milk).toBe(w.cz.cfg.pantry.cap);
    expect(w.cz.restock()).toMatchObject({ ok: false });
    w.economy.cash = 0; w.cz.pantry.milk = 0; expect(w.cz.restock()).toMatchObject({ ok: false, reason: 'Not enough cash for supplies' });
    w.cz.pantry.milk = 0; w.cz.openShift(); expect(w.cz.pantry.milk).toBe(w.cz.cfg.pantry.regenPerShift);
  });
  it('machines are locked until their level, and a better espresso machine makes everything faster', () => {
    const w = make({ xp: 0 }); w.open(); const c = w.addCustomer('mina', ['espresso']); w.cz.tapCustomer(c.id);
    expect(w.cz.tapMachine('blender')).toMatchObject({ ok: false, reason: 'locked' }); expect(w.cz.tapMachine('oven')).toMatchObject({ ok: false, reason: 'locked' });
    const slow = make({ level: 0 }), fast = make({ level: 3 }); expect(fast.cz.machineSeconds({ seconds: 2.4 })).toBeCloseTo(slow.cz.machineSeconds({ seconds: 2.4 }) / (1 + 0.12 * 3), 5);
  });
});

describe('café cozy: multi-product orders and special requests', () => {
  it('a drink + dessert order is only finished after both are served, in either order', () => {
    const w = make({ xp: 200 }); w.open(); const c = w.addCustomer('lena', ['latte', 'croissant']);
    expect(w.cook(c).done).toBe(false); expect(c.state).toBe('waiting'); expect(w.cz.remaining(c)).toHaveLength(1);
    expect(w.cook(c).done).toBe(true); expect(c.state).toBe('eating'); expect(w.cz.session.served).toBe(2);
  });
  it('products can be made ahead: two items on the pickup counter, then served to the right customer', () => {
    const w = make(); w.open(); const a = w.addCustomer('mina', ['espresso']), b = w.addCustomer('priya', ['tea']);
    w.cook(a, { serve: false }); w.cook(b, { serve: false }); expect(w.cz.session.pickup).toHaveLength(2);
    expect(w.cz.tapCustomer(b.id).served).toBe(true); expect(w.cz.tapCustomer(a.id).served).toBe(true);
  });
  it('tapping a customer whose order is not ready just chooses them (no penalty); the finished product stays on the counter until its customer is tapped', () => {
    const w = make(); w.open(); const a = w.addCustomer('mina', ['espresso']), b = w.addCustomer('priya', ['tea']); w.cz.session.combo = 3;
    w.cook(a, { serve: false }); expect(w.cz.tapCustomer(b.id)).toMatchObject({ ok: true, selected: true }); expect(w.cz.session.activeId).toBe(b.id); expect(w.cz.session.combo).toBe(3); expect(w.cz.session.pickup).toHaveLength(1);
    expect(w.cz.tapCustomer(a.id).served).toBe(true);
  });
  it('requests: the add-on satisfies them, forgetting spoils the mood, "no sugar" makes sugar a mistake', () => {
    const w = make({ xp: 600 }); w.open();
    const good = w.addCustomer('mina', [{ pid: 'latte', requests: ['cinnamon'] }]), bad = w.addCustomer('mina', [{ pid: 'latte', requests: ['cinnamon'] }]);
    const rg = w.cook(good, { addons: ['cinnamon'] }), rb = w.cook(bad);
    expect(rg.satisfaction).toBeGreaterThan(rb.satisfaction); expect(rg.perfect).toBe(true); expect(rb.perfect).toBe(false);
    const ns = w.addCustomer('priya', [{ pid: 'espresso', requests: ['noSugar'] }]); w.cz.tapCustomer(ns.id);
    expect(w.cz.addIngredient('sugarcube')).toMatchObject({ ok: false, reason: 'wrong' }); expect(w.cz.note.text).toMatch(/no sugar/i); expect(w.cz.addIngredient('cinnamon').ok).toBe(true); // other add-ons are fine
  });
  it('quality, favourites and a charming café raise satisfaction', () => {
    const a = make(); a.open(); const liked = a.cook(a.addCustomer('mina', ['latte'])); const not = a.cook(a.addCustomer('mina', ['espresso']));
    expect(liked.satisfaction).toBeGreaterThan(not.satisfaction);
    const b = make(); b.open(); b.cz.decor.owned.add('plantPalm'); const base = b.cook(b.addCustomer('mina', ['espresso'])).satisfaction;
    const c = make(); c.open(); c.cz.xp = 9999; for (const [s, it] of [['plantL', 'plantPalm'], ['cornerL', 'floorLamp']]) { c.cz.decor.owned.add(it); c.cz.decor.place(s, it); } const nice = c.cook(c.addCustomer('mina', ['espresso'])).satisfaction;
    expect(nice).toBeGreaterThan(base);
  });
});

describe('café cozy: customer stories and friendship', () => {
  it('the story is optional, told in order, never repeated, and rewards a decoration gift at the end', () => {
    const w = make({ xp: 200 }); w.open(); const found = [];
    for (let visit = 0; visit < 5; visit++) {
      const c = w.addCustomer('mina', ['latte']); expect(w.cook(c).done).toBe(true);
      if (visit === 2) { expect(c.chatReady).toBe(false); expect(w.cz.chat(c.id)).toMatchObject({ ok: false }); } // chapters come on her 1st, 2nd and 4th visit
      if (c.chatReady) { const d = w.cz.chat(c.id).dialogue; found.push(d.title); const r = w.cz.finishDialogue(d.choices.length ? 0 : null); expect(r.ok).toBe(true); expect(w.cz.session.dialogue).toBeNull(); }
      w.cz.finishVisit(c);
    }
    expect(found).toEqual(['Early bird', 'The portfolio', 'Good news']);
    expect(w.cz.decor.owned.has('wallSketch')).toBe(true); expect(w.cz.roster.storyProgress('mina')).toEqual({ done: 3, total: 3 });
    const again = w.addCustomer('mina', ['latte']); w.cook(again); expect(again.chatReady).toBe(false);
  });
  it('skipping a chat is free: the customer keeps their chapter for a later visit', () => {
    const w = make(); w.open(); const c = w.addCustomer('priya', ['americano']); w.cook(c); expect(c.chatReady).toBe(true);
    w.cz.chat(c.id); w.cz.skipDialogue(); expect(w.cz.roster.state.priya.beats).toEqual([]); w.cz.finishVisit(c);
    const d = w.addCustomer('priya', ['americano']); w.cook(d); expect(d.chatReady).toBe(true);
  });
  it('an open chat pauses only that customer\'s eating timer; answers add friendship; visits are remembered', () => {
    const w = make(); w.open(); const c = w.addCustomer('mina', ['latte']); w.cook(c); const d = w.cz.chat(c.id).dialogue; const eat = c.eatLeft;
    w.run(3); expect(c.eatLeft).toBe(eat); const f0 = w.cz.roster.state.mina.friend; w.cz.finishDialogue(null); expect(w.cz.roster.state.mina.friend).toBe(f0 + 2); void d;
    w.run(15); expect(w.cz.session.customers).not.toContain(c); const st = w.cz.roster.state.mina; expect(st.visits).toBe(1); expect(st.served.latte).toBe(1); expect(st.met).toBe(true); expect(st.lastDay).toBe(1);
  });
  it('choices change friendship; friendship levels and the profile reflect it', () => {
    const r = new CafeRoster({ cfg: cfg() }); r.recordVisit('priya', { day: 1, happy: true, served: ['americano'] });
    const a = r.completeBeat('priya', 0), b = r.completeBeat('priya', 1, 0), again = r.completeBeat('priya', 1, 0);
    expect(a.friend).toBe(2); expect(b.friend).toBe(4); expect(again.repeated).toBe(true);
    expect(r.levelOf('priya')).toBeGreaterThanOrEqual(1); const p = r.profile('priya'); expect(p.met).toBe(true); expect(p.chapters.map((x) => x.done)).toEqual([true, true, false]); expect(p.likes.drinks).toContain('americano');
    expect(r.profile('vale')).toMatchObject({ met: false, name: '???' });
  });
});

describe('café cozy: decoration', () => {
  it('buy, place, rotate, replace and remove: with café coins, kind-checked, nothing goes negative', () => {
    const w = make({ xp: 200 }); const D = w.cz.decor; w.cz.coins = 100;
    expect(w.cz.buyDecor('plantBloom')).toMatchObject({ ok: true }); expect(w.cz.coins).toBe(65); expect(w.cz.buyDecor('plantBloom')).toMatchObject({ ok: false });
    expect(D.place('plantL', 'plantBloom').ok).toBe(true); expect(D.placed.plantL.item).toBe('plantBloom'); expect(D.options('plantR').some((o) => o.id === 'plantBloom')).toBe(false); // already used
    expect(D.rotate('plantL')).toMatchObject({ ok: true, rot: 90 }); expect(D.rotate('table1')).toMatchObject({ ok: false });
    expect(D.place('wallW1', 'plantFern')).toMatchObject({ ok: false }); expect(D.place('plantL', 'tableRound')).toMatchObject({ ok: false });
    expect(D.remove('plantL').ok).toBe(true); expect(D.placed.plantL).toBeNull(); expect(D.remove('table1')).toMatchObject({ ok: false });
    w.cz.coins = 5; expect(w.cz.buyDecor('plantPalm')).toMatchObject({ ok: false, reason: 'Not enough café coins' }); expect(w.cz.coins).toBe(5);
    expect(w.cz.buyDecor('chandelier')).toMatchObject({ ok: false }); // gifts cannot be bought
  });
  it('furniture unlocks with the café level; tables and rugs can be replaced', () => {
    const w = make({ xp: 0 }); w.cz.coins = 500; expect(w.cz.buyDecor('sofaSet')).toMatchObject({ ok: false, reason: expect.stringMatching(/level/) });
    w.cz.xp = 540; expect(w.cz.level).toBe(5); expect(w.cz.buyDecor('tableSquare').ok).toBe(true); expect(w.cz.decor.place('table1', 'tableSquare').ok).toBe(true);
    expect(w.cz.decor.placed.table1.item).toBe('tableSquare'); expect(w.cz.decor.options('table2').some((o) => o.id === 'tableSquare')).toBe(true); // tables may repeat
  });
  it('themes and floors: six themes, bought with coins, level-gated, applied to the café; appeal adds up', () => {
    const w = make({ xp: 0 }); const D = w.cz.decor; expect(Object.keys(cfg().decor.themes)).toHaveLength(6); expect(D.theme).toBe('wooden');
    w.cz.coins = 1000; expect(w.cz.buyTheme('beach')).toMatchObject({ ok: false }); w.cz.xp = 99999;
    const a0 = D.appeal(); expect(w.cz.buyTheme('pastel').ok).toBe(true); expect(D.setTheme('pastel')).toBe(true); expect(D.setTheme('beach')).toBe(false); expect(D.appeal()).toBe(a0 - cfg().decor.themes.wooden.appeal + cfg().decor.themes.pastel.appeal);
    expect(D.floorColors()).toEqual(cfg().decor.themes.pastel.floor); expect(w.cz.buyFloor('mint').ok).toBe(true); D.setFloor('mint'); expect(D.floorColors()).toEqual(cfg().decor.floors.mint.colors);
  });
  it('placement can never block the walking aisle: slots keep clear of the door-to-counter corridor, and kinds are restricted', () => {
    const slots = cfg().decor.slots;
    for (const [id, s] of Object.entries(slots)) {
      if (['rug', 'ceiling', 'wall', 'window', 'counter'].includes(s.kind)) continue; // flat, overhead or wall-mounted: no collider
      expect(Math.abs(s.x - 17.5), `${id} stays out of the aisle (x 16.4 .. 18.6)`).toBeGreaterThan(1.2);
      expect(s.x, id).toBeGreaterThan(13.8); expect(s.x, id).toBeLessThan(21.0); expect(s.z, id).toBeLessThan(-7.5); expect(s.z, id).toBeGreaterThan(-19.5);
    }
    for (const [id, s] of Object.entries(slots)) { if (s.default) expect(cfg().decor.items[s.default].kind, id).toBe(s.kind); expect(s.rot.length).toBeGreaterThanOrEqual(1); }
    const kinds = new Set(Object.values(cfg().decor.items).map((i) => i.kind)); for (const k of ['table', 'floor', 'wall', 'window', 'rug', 'counter', 'ceiling']) expect(kinds.has(k), k).toBe(true);
    expect(Object.keys(slots).filter((s) => slots[s].kind === 'table')).toHaveLength(5); // the five seats the café already has
  });
});

describe('café cozy: progression and rewards', () => {
  it('xp raises the café level and announces what unlocks; levels never go down', () => {
    const w = make(); const ev = vi.fn(); w.bus.on('cozy:level', ev); w.open(); expect(w.cz.level).toBe(1);
    w.cz.addXp(60); expect(w.cz.level).toBe(2); const e = ev.mock.calls[0][0]; expect(e.level).toBe(2); expect(e.unlocks.drinks).toContain('cappuccino'); expect(e.unlocks.customers).toContain('theo'); expect(e.unlocks.themes).toContain('minimal');
    w.cz.addXp(10000); expect(w.cz.level).toBe(w.cz.maxLevel); expect(w.cz.levelProgress().next).toBeNull(); w.cz.addXp(-5); expect(w.cz.level).toBe(w.cz.maxLevel);
    const all = []; for (let l = 1; l <= w.cz.maxLevel; l++) { const u = w.cz.unlocksAt(l); all.push(...u.drinks, ...u.desserts); } expect(new Set(all).size).toBe(19);
  });
  it('first-time recipes give a discovery bonus; perfect and happy orders earn more coins, xp and combos', () => {
    const w = make(); w.open(); const x0 = w.cz.xp; const a = w.cook(w.addCustomer('mina', ['espresso'])); expect(w.cz.xp - x0).toBeGreaterThan(w.cz.cfg.progress.xp.served);
    const c1 = w.cz.coins; const b = w.cook(w.addCustomer('mina', ['espresso'])); const gain1 = w.cz.coins - c1; expect(gain1).toBeGreaterThan(0);
    expect(w.cz.session.combo).toBe(2); expect(a.perfect && b.perfect).toBe(true);
    const vip = make({ xp: 600 }); vip.open(); const v0 = vip.cz.coins; vip.cook(vip.addCustomer('vale', ['latte'])); const vgain = vip.cz.coins - v0; const reg = make({ xp: 600 }); reg.open(); const r0 = reg.cz.coins; reg.cook(reg.addCustomer('mina', ['latte'])); expect(vgain).toBeGreaterThan(reg.cz.coins - r0);
  });
  it('café coins are capped per day, but one-time story gifts are not', () => {
    const w = make(); w.open(); const cap = w.cz.cfg.rewards.city.dayCoinCap; const got = w.cz.addCoins(cap + 999); expect(got).toBe(cap); expect(w.cz.addCoins(10)).toBe(0);
    expect(w.cz.addCoins(25, { capped: false })).toBe(25); w.setDay(2); expect(w.cz.addCoins(10)).toBe(10);
  });
  it('city rewards: a small capped cash grant + reputation at the end of a rewarded shift: a grant, never revenue; limits and cooldown stop farming', () => {
    const w = make({ xp: 600 }); const rev = w.economy.totalRevenue, rep = w.economy.reputation, cash = w.economy.cash; const earned = vi.fn(); w.bus.on('cash:earned', earned);
    const shift = (n) => { w.open(); for (let i = 0; i < n; i++) w.cook(w.addCustomer('priya', ['latte'])); return w.cz.closeShift(); };
    const s1 = shift(5); expect(s1.rewarded).toBe(true); expect(s1.cash).toBeGreaterThan(0); expect(s1.rep).toBe(1);
    expect(w.economy.cash).toBeCloseTo(cash + s1.cash, 2); expect(w.economy.totalRevenue).toBe(rev); expect(earned).not.toHaveBeenCalled(); expect(w.economy.reputation).toBe(rep + 1);
    w.cz.dismiss(); const s2 = shift(5); expect(s2.rewarded).toBe(false); expect(s2.cash).toBe(0); expect(s2.why).toMatch(/Rest/); // cooldown
    const R = w.cz.cfg.rewards.city; let total = s1.cash;
    for (let i = 0; i < 20; i++) { w.cz.dismiss(); w.tick(R.cooldownSeconds * 1000 + 1); const s = shift(8); total += s.cash; }
    expect(total).toBeLessThanOrEqual(R.dayCashCap + 1e-9); expect(w.cz.today.shifts).toBeLessThanOrEqual(R.shiftsPerDay); expect(w.economy.reputation - rep).toBeLessThanOrEqual(R.dayReputationCap);
    w.cz.dismiss(); w.setDay(2); w.tick(R.cooldownSeconds * 1000 + 1); expect(w.cz.status().rewarded).toBe(true);
  });
  it('the café business gets only a small, capped arrival boost from the cozy café (no revenue of its own)', () => {
    const w = make(); expect(w.cz.cafeBonus()).toBeGreaterThanOrEqual(1); w.cz.xp = 99999; expect(w.cz.cafeBonus()).toBeLessThanOrEqual(1.12 + 1e-9);
  });
});

describe('café cozy: saving', () => {
  it('everything round-trips (progress, coins, pantry, roster, decor, day state) and corrupt data is repaired', () => {
    const w = make({ xp: 200 }); w.open(); w.cook(w.addCustomer('mina', ['latte'])); w.cz.coins = 77; w.cz.pantry.milk = 3; w.cz.decor.grant('wallClock'); w.cz.closeShift();
    const saved = JSON.parse(JSON.stringify(w.cz.serialize())); const w2 = make({ saved }); expect(w2.cz.serialize()).toEqual(saved);
    expect(w2.cz.xp).toBe(w.cz.xp); expect(w2.cz.coins).toBe(77); expect(w2.cz.pantry.milk).toBe(3); expect(w2.cz.decor.owned.has('wallClock')).toBe(true); expect(w2.cz.state).toBe('idle');
    const bad = make({ saved: { xp: -4, coins: 'x', pantry: { milk: 9999, cup: 'a' }, decor: { theme: 'nope', placed: { table1: { item: 'chandelier', rot: 7 }, ghost: {} }, owned: ['zzz'] }, roster: { mina: { visits: -3, beats: [9, 'a', 1, 1] } }, discovered: ['x', 'latte'] } });
    expect(bad.cz.xp).toBe(0); expect(bad.cz.coins).toBe(0); expect(bad.cz.pantry.milk).toBe(bad.cz.cfg.pantry.cap); expect(bad.cz.decor.theme).toBe('wooden'); expect(bad.cz.decor.placed.table1.item).toBe('tableRound');
    expect(bad.cz.roster.state.mina.beats).toEqual([1]); expect(bad.cz.roster.state.mina.visits).toBe(0); expect(bad.cz.discovered.has('latte')).toBe(true);
    expect(make({ saved: 'junk' }).cz.level).toBe(1); expect(make().cz.coins).toBe(cfg().progress.starterCoins);
  });
  it('a session in progress is never saved (only long-term data)', () => {
    const w = make(); w.open(); w.addCustomer('mina', ['latte']); const s = w.cz.serialize(); expect(JSON.stringify(s)).not.toMatch(/customers|pickup|build/); expect(Object.keys(s).sort()).toEqual(['coins', 'decor', 'discovered', 'display', 'life', 'pantry', 'roster', 'today', 'v', 'xp']);
  });
});