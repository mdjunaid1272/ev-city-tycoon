import { chromium } from 'playwright-core';
// A save written by the PREVIOUS version (no café, old tutorial format, no staff training) must still load, with sensible defaults.
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const URL = process.env.EVCT_URL || 'http://localhost:5173/';
const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
await ctx.addInitScript(() => { try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
await p.waitForFunction(() => window.__game?.cafe, null, { timeout: 90000 }); await p.waitForTimeout(1000);

// play a little, then write the save the way the old version did
const old = await p.evaluate(async () => {
  const G = __game; G.economy.cash = 12345; G.economy.reputation = 22; G.progression.stage = 3; G.customers.enabled = false;
  G.hub.build('coffee', G.progression); // an old save that already owns the Coffee Shop
  const c = G.employees.makeCandidate(); c.role = 'attendant'; c.skill = 2; c.cost = 100; G.employees.candidates.push(c); G.employees.hire(c.id);
  G.tutorial.begin(3, false); // mid-tutorial, old format below
  const data = JSON.parse(JSON.stringify(G.collect()));
  delete data.cafe; // no café data in older saves
  data.tutorial = { done: false, step: 3 }; // old tutorial format
  delete data.employees.efficiencyLevel; // no team training
  data.missions = { index: 5, progress: 0 }; // an old position in the mission list
  data.hub = { built: { store: false, coffee: true, lounge: false }, sales: { store: 0, coffee: 12.5 }, count: { store: 0, coffee: 3 } }; // old hub with real coffee sales history
  await G.saver.save(data);
  return { cash: G.economy.cash, rep: G.economy.reputation, staff: G.employees.employees.length };
});
check('wrote an old-format save', old.staff === 1, JSON.stringify(old));
// the game saves itself when the page unloads: switch that off so the reload really reads the OLD-format file written above
await p.evaluate(() => { removeEventListener('beforeunload', __game.onUnload); removeEventListener('visibilitychange', __game.onHide); __game.autosave = -1e9; });
await p.reload();
await p.waitForFunction(() => window.__game?.cafe, null, { timeout: 90000 }); await p.waitForTimeout(1500);
const now = await p.evaluate(() => {
  const G = __game;
  return {
    cash: G.economy.cash, rep: G.economy.reputation, stage: G.progression.stage, staff: G.employees.employees.length,
    cafeBuilt: G.cafe.built, cafeView: G.cafeView.root.visible, stock: { ...G.cafe.stock }, levels: { ...G.cafe.levels }, served: G.cafe.stats.served,
    tut: { step: G.tutorial.step, done: G.tutorial.done, state: G.tutorial.state, hasN: typeof G.tutorial.n === 'object' },
    mission: G.missions.index, eff: G.employees.efficiencyLevel, hubCoffee: G.hub.sales.coffee,
  };
});
check('an old save loads: cash, reputation, stage and staff are intact', now.cash === old.cash && now.rep === 22 && now.stage === 3 && now.staff === 1, JSON.stringify(now));
check('the café starts with defaults and opening stock for an owned Coffee Shop', now.cafeBuilt && now.cafeView && now.stock.beans > 0 && JSON.stringify(now.levels) === '{"machine":0,"storage":0,"seating":0,"menu":0}' && now.served === 0, JSON.stringify({ stock: now.stock, levels: now.levels }));
check('the old tutorial position is kept and the new counters get defaults', now.tut.step === 3 && !now.tut.done && now.tut.hasN, JSON.stringify(now.tut));
check('mission position, team training and old coffee sales history are preserved / defaulted', now.mission >= 5 && now.eff === 0 && now.hubCoffee === 12.5, JSON.stringify({ m: now.mission, e: now.eff, c: now.hubCoffee }));
// the loaded game plays: the café serves, staff work, and saving again writes the new format
const play = await p.evaluate(async () => {
  const G = __game; G.customers.enabled = false;
  const c = G.employees.makeCandidate(); c.role = 'barista'; c.skill = 2; c.cost = 100; G.employees.candidates.push(c); G.employees.hire(c.id);
  G.cafe.spawnTimer = 1; G.cafe.setAutoRestock(true);
  for (let i = 0; i < 1500; i++) { G.cafe.update(0.1); G.employees.update(0.1); G.cafeView.update(0.1); }
  await G.save();
  const d = await G.saver.load();
  return { served: G.cafe.stats.served, newFormat: !!d.cafe && d.tutorial.v === 2 && d.employees.efficiencyLevel === 0 };
});
check('the loaded game works, and saving again writes the new format', play.served > 5 && play.newFormat, JSON.stringify(play));
await p.reload();
await p.waitForFunction(() => window.__game?.cafe, null, { timeout: 90000 }); await p.waitForTimeout(1000);
check('the re-saved game loads again with the café progress', await p.evaluate(() => __game.cafe.stats.served > 5));
console.log(R.join('\n')); console.log('ERRORS:', [...new Set(errs)].join('|') || 'none');
await browser.close();
