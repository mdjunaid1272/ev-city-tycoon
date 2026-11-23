import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { EconomyManager } from '../src/economy/EconomyManager.js';
import { CafeMiniGame } from '../src/businesses/CafeMiniGame.js';
import { CafeRecipeManager } from '../src/businesses/CafeRecipeManager.js';
import { data } from './helpers.js';

function make({ rng = () => 0.5, day = 1, level = 0, start = 1e9 } = {}) {
  const bus = new EventBus(), economy = new EconomyManager(bus, { cash: 100, gems: 0 });
  let clock = start, today = day;
  const mg = new CafeMiniGame({ economy, bus, cfg: data('cafe'), getDay: () => today, getMachineLevel: () => level, now: () => clock, rng });
  const run = (secs, dt = 0.1) => { for (let t = 0; t < secs && mg.running; t += dt) mg.update(dt); };
  const addCustomer = (items, type = 'regular', patience = 60) => { const t = mg.k.customers[type]; const c = { id: `t${Math.random()}`, type, label: t.label, icon: t.icon, color: t.color, mult: t.mult, patience, maxPatience: patience, items, served: [], spawnedAt: 0 }; mg.session.customers.push(c); return c; };
  /** Cook and serve one product perfectly (no mistakes, collected at once). */
  const cook = (pid, c, adds = true) => {
    const R = mg.recipes; mg.tapCustomer(c.id);
    if (adds) for (const [raw, n] of Object.entries(R.needs(pid))) for (let i = 0; i < n; i++) expect(mg.addIngredient(raw).ok).toBe(true);
    // run the machines in dependency order until the build is finished
    let guard = 0;
    while (mg.session.build && guard++ < 400) {
      const b = mg.session.build;
      const ready = Object.entries(mg.session.jobs).find(([, j]) => j.state === 'ready');
      if (ready) { mg.tapMachine(ready[0]); continue; }
      if (Object.keys(mg.session.jobs).length) { mg.update(0.2); continue; }
      const id = R.machinesFor(pid).find((m) => R.inputsFor(m, b.tray).ok);
      if (!id) break;
      mg.tapMachine(id);
    }
    return mg.tapCustomer(c.id);
  };
  return { bus, economy, mg, run, addCustomer, cook, tick: (ms) => { clock += ms; }, setDay: (d) => { today = d; } };
}

describe('café mini-game: data', () => {
  it('every product can be made from raw ingredients with the defined machines and assemblies', () => {
    const cfg = data('cafe'), R = new CafeRecipeManager(cfg.miniGame);
    for (const pid of Object.keys(cfg.products)) {
      expect(cfg.miniGame.products[pid], pid).toBeTruthy();
      for (const raw of Object.keys(R.needs(pid))) expect(cfg.miniGame.ingredients[raw], `${pid}:${raw}`).toBeTruthy();
      for (const m of R.machinesFor(pid)) expect(cfg.miniGame.machines[m], `${pid}:${m}`).toBeTruthy();
    }
    const w = make(); w.mg.start('quick');
    for (const pid of Object.keys(cfg.products)) { const c = w.addCustomer([pid]); expect(w.cook(pid, c).served, pid).toBe(true); }
    expect(w.mg.session.served).toBe(Object.keys(cfg.products).length);
  });
  it('keys are unique and every mode has increasing star thresholds', () => {
    const k = data('cafe').miniGame, keys = [...Object.values(k.ingredients), ...Object.values(k.machines)].map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of Object.values(k.modes)) expect([...m.stars].sort((a, b) => a - b)).toEqual(m.stars);
  });
});

describe('café mini-game: session lifecycle', () => {
  it('starts, runs and ends on time; can be replayed; never changes the café business', () => {
    const w = make(); expect(w.mg.state).toBe('idle');
    expect(w.mg.start('quick').ok).toBe(true); expect(w.mg.start('quick')).toMatchObject({ ok: false });
    w.mg.session.spawnTimer = 1e9; w.mg.session.left = 5; w.run(6);
    expect(w.mg.state).toBe('ended'); expect(w.mg.result.reason).toBe('time');
    w.mg.dismiss(); expect(w.mg.state).toBe('idle');
    expect(w.mg.start('rush').ok).toBe(true); expect(w.mg.running).toBe(true);
    expect(w.mg.start('nope')).toMatchObject({ ok: false });
  });
  it('customers arrive by themselves, never more than the queue allows, and the level rises with served orders', () => {
    const w = make({ rng: () => 0.3 }); w.mg.start('quick'); w.run(30);
    expect(w.mg.session.customers.length).toBeGreaterThan(0); expect(w.mg.session.customers.length).toBeLessThanOrEqual(4);
    const before = w.mg.session.level; w.mg.session.served = 8; w.mg.session.level = w.mg.levelOf(w.mg.session);
    expect(w.mg.session.level).toBeGreaterThan(before);
  });
  it('customers who run out of patience are strikes; too many strikes end the shift', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9; const bus = vi.fn(); w.bus.on('minigame:lost', bus);
    w.addCustomer(['espresso'], 'rusher', 1); w.run(2);
    expect(w.mg.session.strikes).toBe(1); expect(w.mg.session.combo).toBe(0); expect(bus).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 2; i++) { w.addCustomer(['espresso'], 'rusher', 0.3); w.run(0.5); }
    expect(w.mg.state).toBe('ended'); expect(w.mg.result.reason).toBe('walkouts');
  });
  it('quitting ends the session and pays only what was earned, without the star bonus', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9;
    w.cook('espresso', w.addCustomer(['espresso'])); w.mg.quit();
    expect(w.mg.result).toMatchObject({ reason: 'quit', stars: 0 });
    expect(w.mg.result.payout).toBeCloseTo(w.mg.result.coinsEarned, 2);
  });
});

describe('café mini-game: cooking and serving', () => {
  it('a wrong ingredient is refused and counted as a mistake (no perfect bonus afterwards)', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9; const c = w.addCustomer(['espresso']);
    w.mg.tapCustomer(c.id);
    expect(w.mg.addIngredient('milk')).toMatchObject({ ok: false, reason: 'wrong' });
    expect(w.mg.session.build.mistakes).toBe(1); expect(w.mg.session.build.tray).toHaveLength(0);
    for (const r of ['cup', 'beans']) w.mg.addIngredient(r);
    expect(w.mg.addIngredient('cup')).toMatchObject({ ok: false }); // only one cup is needed
    const r = w.cook('espresso', c, false);
    expect(r.served).toBe(true); expect(r.perfect).toBe(false);
  });
  it('a wrong machine and a machine without its ingredients are handled', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9; const c = w.addCustomer(['croissant']);
    w.mg.tapCustomer(c.id); w.mg.addIngredient('dough');
    expect(w.mg.tapMachine('press')).toMatchObject({ ok: false, reason: 'wrong machine' });
    expect(w.mg.tapMachine('steamer')).toMatchObject({ ok: false, reason: 'wrong machine' });
    const w2 = make(); w2.mg.start('quick'); w2.mg.session.spawnTimer = 1e9; const c2 = w2.addCustomer(['espresso']); w2.mg.tapCustomer(c2.id); w2.mg.addIngredient('cup');
    expect(w2.mg.tapMachine('espresso')).toMatchObject({ ok: false, reason: 'missing' });
  });
  it('adding an ingredient without choosing anybody picks the most impatient customer', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9;
    const a = w.addCustomer(['croissant'], 'regular', 60), b = w.addCustomer(['croissant'], 'regular', 60); b.patience = 10;
    expect(w.mg.addIngredient('dough').ok).toBe(true); expect(w.mg.session.build.cid).toBe(b.id); void a;
  });
  it('a perfect order scores more, pays more coins and builds the combo', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9;
    const r1 = w.cook('espresso', w.addCustomer(['espresso'])); expect(r1).toMatchObject({ served: true, perfect: true });
    expect(w.mg.session.combo).toBe(1);
    const r2 = w.cook('croissant', w.addCustomer(['croissant'])); expect(r2.perfect).toBe(true); expect(w.mg.session.combo).toBe(2);
    expect(r2.points).toBeGreaterThan(0); expect(w.mg.session.coins).toBeGreaterThan(0);
  });
  it('late collection lowers the quality and breaks the combo; the oven burns what is left', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9; const c = w.addCustomer(['croissant']); w.mg.tapCustomer(c.id);
    w.mg.addIngredient('dough'); w.mg.tapMachine('oven'); w.run(3.4); w.run(6); // 6 s late
    const r = w.mg.tapMachine('oven'); expect(r.collected).toBe(true);
    const out = w.mg.tapCustomer(c.id); expect(out.served).toBe(true); expect(out.quality).toBeLessThan(0.65); expect(w.mg.session.combo).toBe(0);
    const w2 = make(); w2.mg.start('quick'); w2.mg.session.spawnTimer = 1e9; const c2 = w2.addCustomer(['croissant']); w2.mg.tapCustomer(c2.id);
    w2.mg.addIngredient('dough'); w2.mg.tapMachine('oven'); w2.run(3.4); w2.run(7.5);
    expect(w2.mg.session.jobs.oven.state).toBe('burnt');
    w2.mg.session.combo = 3; expect(w2.mg.tapMachine('oven')).toMatchObject({ discarded: true });
    expect(w2.mg.session.combo).toBe(0); expect(w2.mg.session.build.used.dough).toBe(0); expect(w2.mg.addIngredient('dough').ok).toBe(true); // can start again
  });
  it('serving the wrong customer is refused: points lost, combo reset, the product stays', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9;
    const a = w.addCustomer(['espresso']), b = w.addCustomer(['croissant']); w.mg.session.score = 100; w.mg.session.combo = 2;
    w.cook('espresso', a); // a is served already; make another espresso for nobody: build one for b's colleague
    const c = w.addCustomer(['espresso']); w.mg.tapCustomer(c.id);
    for (const r of ['cup', 'beans']) w.mg.addIngredient(r);
    let guard = 0; while (w.mg.session.build && guard++ < 400) { const rd = Object.entries(w.mg.session.jobs).find(([, j]) => j.state === 'ready'); if (rd) w.mg.tapMachine(rd[0]); else if (Object.keys(w.mg.session.jobs).length) w.mg.update(0.2); else w.mg.tapMachine(w.mg.recipes.machinesFor('espresso').find((m) => w.mg.recipes.inputsFor(m, w.mg.session.build.tray).ok)); }
    expect(w.mg.session.pickup).toHaveLength(1);
    const before = w.mg.session.score; w.mg.session.combo = 4;
    expect(w.mg.tapCustomer(b.id)).toMatchObject({ ok: false, reason: 'wrong customer' });
    expect(w.mg.session.score).toBe(before - 25); expect(w.mg.session.combo).toBe(0); expect(w.mg.session.pickup).toHaveLength(1); expect(w.mg.session.wrong).toBe(1);
    expect(w.mg.tapCustomer(c.id).served).toBe(true); expect(w.mg.session.pickup).toHaveLength(0);
  });
  it('a tourist with two items is only done after both are served', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9; const t = w.addCustomer(['espresso', 'croissant'], 'tourist', 200);
    expect(w.cook('espresso', t).done).toBe(false); expect(w.mg.session.customers).toContain(t);
    expect(w.mg.remaining(t)).toEqual(['croissant']);
    expect(w.cook('croissant', t).done).toBe(true); expect(w.mg.session.customers).not.toContain(t);
    expect(w.mg.session.served).toBe(2);
  });
  it('VIPs are worth much more than regulars', () => {
    const a = make(); a.mg.start('quick'); a.mg.session.spawnTimer = 1e9; const ra = a.cook('latte', a.addCustomer(['latte'], 'regular'));
    const b = make(); b.mg.start('quick'); b.mg.session.spawnTimer = 1e9; const rb = b.cook('latte', b.addCustomer(['latte'], 'vip'));
    expect(rb.points).toBeGreaterThan(ra.points * 2); expect(b.mg.session.coins).toBeGreaterThan(a.mg.session.coins * 2);
  });
});

describe('café mini-game: rewards and anti-farming', () => {
  const play = (w, mode, orders = 6) => { w.mg.start(mode); w.mg.session.spawnTimer = 1e9; for (let i = 0; i < orders; i++) w.cook(i % 2 ? 'croissant' : 'espresso', w.addCustomer([i % 2 ? 'croissant' : 'espresso'])); w.mg.session.left = 0.01; w.mg.update(0.1); const r = w.mg.result; w.mg.dismiss(); return r; };

  it('pays once, through EconomyManager.grant: cash goes up, revenue / stage goals do not', () => {
    const w = make(); const cash = w.economy.cash, rev = w.economy.totalRevenue, earned = vi.fn(); w.bus.on('cash:earned', earned);
    const r = play(w, 'quick');
    expect(r.payout).toBeGreaterThan(0); expect(w.economy.cash).toBeCloseTo(cash + r.payout, 2);
    expect(w.economy.totalRevenue).toBe(rev); expect(w.economy.ledger.revenue.minigame).toBeUndefined(); expect(earned).not.toHaveBeenCalled();
    const again = w.mg.end('time'); expect(again).toBeNull(); expect(w.economy.cash).toBeCloseTo(cash + r.payout, 2); // cannot pay twice
  });
  it('the session cap limits what one shift can pay', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9; w.mg.session.coins = 9999; w.mg.session.score = 5000; w.mg.session.left = 0.01; w.mg.update(0.1);
    expect(w.mg.result.payout).toBe(w.mg.k.modes.quick.coinCap); expect(w.mg.result.limited).toBe('session cap');
  });
  it('the daily coin cap, the daily number of rewarded sessions and the cooldown all stop the farming', () => {
    const w = make(); const R = w.mg.k.rewards;
    // cooldown: an immediate second session is practice only
    play(w, 'quick'); const st = w.mg.status(); expect(st.rewarded).toBe(false); expect(st.cooldownLeft).toBeGreaterThan(0); expect(st.why).toMatch(/cooldown/i);
    const cash = w.economy.cash; const r2 = play(w, 'quick'); expect(r2.rewarded).toBe(false); expect(r2.payout).toBe(0); expect(w.economy.cash).toBe(cash);
    // after the cooldown it pays again, until the daily number of sessions is used up
    let paid = 0, plays = 0;
    for (let i = 0; i < 30; i++) { w.tick(R.cooldownSeconds * 1000 + 1); const r = play(w, 'marathon', 12); plays++; if (r.payout > 0) paid++; }
    expect(w.mg.meta.dayPlays).toBeLessThanOrEqual(R.maxSessionsPerDay); expect(w.mg.meta.dayCoins).toBeLessThanOrEqual(R.dayCoinCap + 1e-9);
    w.tick(R.cooldownSeconds * 1000 + 1); expect(w.mg.status().rewarded).toBe(false);
    expect(paid).toBeLessThan(plays);
  });
  it('a new day resets the allowance', () => {
    const w = make(); w.mg.meta.day = 1; w.mg.meta.dayPlays = 10; w.mg.meta.dayCoins = 250; w.tick(60_000);
    expect(w.mg.status()).toMatchObject({ rewarded: false });
    w.setDay(2); expect(w.mg.status()).toMatchObject({ rewarded: true, playsLeft: 10, coinsLeft: 250 });
  });
  it('stars, best scores and the star bonus', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9; w.mg.session.score = 700; w.mg.session.left = 0.01; w.mg.update(0.1);
    expect(w.mg.result.stars).toBe(2); expect(w.mg.result.newBest).toBe(true); expect(w.mg.meta.best.quick).toEqual({ score: 700, stars: 2 });
    w.mg.dismiss(); w.tick(60_000); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9; w.mg.session.score = 100; w.mg.session.left = 0.01; w.mg.update(0.1);
    expect(w.mg.result.newBest).toBe(false); expect(w.mg.meta.best.quick.score).toBe(700);
  });
});

describe('café mini-game: save data', () => {
  it('only small meta data is saved and it round-trips; corrupt data is repaired', () => {
    const w = make(); w.mg.start('quick'); w.mg.session.spawnTimer = 1e9; w.cook('espresso', w.addCustomer(['espresso'])); w.mg.session.left = 0.01; w.mg.update(0.1);
    const saved = JSON.parse(JSON.stringify(w.mg.serialize()));
    expect(Object.keys(saved).sort()).toEqual(['best', 'coins', 'day', 'dayCoins', 'dayPlays', 'lastEnd', 'plays', 'v']);
    const w2 = make(); const mg2 = new CafeMiniGame({ economy: w2.economy, bus: w2.bus, cfg: data('cafe'), saved, getDay: () => 1, now: () => 1e9 });
    expect(mg2.serialize()).toEqual(saved);
    const bad = new CafeMiniGame({ economy: w2.economy, bus: w2.bus, cfg: data('cafe'), saved: { plays: -3, coins: 'x', best: { quick: { score: 'a', stars: 9 }, rush: { score: 10, stars: 9 } }, dayCoins: NaN } });
    expect(bad.meta.plays).toBe(0); expect(bad.meta.coins).toBe(0); expect(bad.meta.best.quick).toBeUndefined(); expect(bad.meta.best.rush).toEqual({ score: 10, stars: 3 });
    expect(new CafeMiniGame({ economy: w2.economy, bus: w2.bus, cfg: data('cafe'), saved: 'junk' }).meta.plays).toBe(0);
    expect(new CafeMiniGame({ economy: w2.economy, bus: w2.bus, cfg: data('cafe'), saved: null }).state).toBe('idle');
  });
});