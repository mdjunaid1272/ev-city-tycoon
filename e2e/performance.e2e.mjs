import { chromium } from 'playwright-core';
// Rendering cost of the cafe, resource growth over a long run, and leaks when panels are opened and closed many times.
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [], NUM = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const URL = process.env.EVCT_URL || 'http://localhost:5173/';

async function boot(quality) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
  await ctx.addInitScript((q) => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: q })); } catch (e) {} }, quality);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
  await p.waitForFunction(() => window.__game?.cafe, null, { timeout: 90000 }); await p.waitForTimeout(1200);
  await p.evaluate(() => { const G = __game; G.economy.cash = 500000; G.economy.reputation = 60; G.progression.stage = 4; G.customers.enabled = false; G.player.pos.set(14, 0.34, -3); G.camera.tp.smooth.set(14, 1.6, -3); });
  return { ctx, p };
}
const frameInfo = (p) => p.evaluate(() => { const G = __game, R = G.sm.renderer; R.info.autoReset = false; R.info.reset(); G.sm.render(); const i = R.info; const o = { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, programs: i.programs?.length || 0 }; R.info.autoReset = true; return o; });

for (const q of ['low', 'medium', 'high']) {
  const { ctx, p } = await boot(q);
  await p.waitForTimeout(800);
  const without = await frameInfo(p);
  await p.evaluate(() => {
    const G = __game; G.hub.build('coffee', G.progression); G.cafe.upgrade('seating'); G.cafe.upgrade('seating'); G.cafe.upgrade('menu');
    const c = G.employees.makeCandidate(); c.role = 'barista'; c.skill = 3; c.cost = 100; G.employees.candidates.push(c); G.employees.hire(c.id);
    G.cafe.setAutoRestock(true); G.cafe.spawnTimer = 1; for (let i = 0; i < 400; i++) { G.cafe.update(0.1); G.employees.update(0.1); G.cafeView.update(0.1); }
  });
  await p.waitForTimeout(800);
  const withCafe = await frameInfo(p);
  const d = { calls: withCafe.calls - without.calls, tris: withCafe.tris - without.tris, geos: withCafe.geos - without.geos, tex: withCafe.tex - without.tex };
  NUM.push(`${q}: without ${JSON.stringify(without)}  with cafe ${JSON.stringify(withCafe)}  delta ${JSON.stringify(d)}`);
  const limit = q === 'low' ? { calls: 45, tris: 20000 } : { calls: 90, tris: 30000 }; // medium / high also draw a shadow pass
  check(`${q}: the whole café adds fewer than ${limit.calls} draw calls and ${limit.tris} triangles`, d.calls < limit.calls && d.tris < limit.tris, JSON.stringify(d));
  if (q === 'medium') {
    // ---- resources stay flat over a long run (no per-order allocations)
    await p.evaluate(() => { const G = __game; for (let i = 0; i < 4000; i++) { G.cafe.update(0.1); G.employees.update(0.1); G.cafeView.update(0.1); } }); // warm-up: the pool of figures fills once
    const before = await frameInfo(p);
    const scene0 = await p.evaluate(() => { let n = 0; __game.sm.scene.traverse(() => n++); return n; });
    await p.evaluate(() => { const G = __game; for (let i = 0; i < 12000; i++) { G.cafe.update(0.1); G.employees.update(0.1); G.cafeView.update(0.1); } });
    await p.waitForTimeout(500);
    const after = await frameInfo(p);
    const scene1 = await p.evaluate(() => { let n = 0; __game.sm.scene.traverse(() => n++); return n; });
    const run = await p.evaluate(() => ({ served: __game.cafe.stats.served, figs: __game.cafeView.figures.size, pool: __game.cafeView.pool.length, orders: __game.cafe.orders.length, customers: __game.cafe.customers.size }));
    // a geometry is uploaded to the GPU the first time it is drawn, so the first run may add one-off uploads (the café room has several separate meshes: walls, glass, roof, floor, windows); a SECOND run may only add a few (traffic and pedestrians show a car / character style for the first time at random), never keep growing
    await p.evaluate(() => { const G = __game; for (let i = 0; i < 12000; i++) { G.cafe.update(0.1); G.employees.update(0.1); G.cafeView.update(0.1); } });
    await p.waitForTimeout(500);
    const after2 = await frameInfo(p);
    const scene2 = await p.evaluate(() => { let n = 0; __game.sm.scene.traverse(() => n++); return n; });
    check('40 simulated minutes of café service: no new scene objects, textures, or (after the first upload) geometries', scene1 === scene0 && scene2 === scene0 && after.tex === before.tex && after2.tex === before.tex && after.geos - before.geos <= 8 && after2.geos - after.geos <= 4, `geos ${before.geos}->${after.geos}->${after2.geos} tex ${before.tex}->${after2.tex} nodes ${scene0}->${scene2}`);
    check('the café really served customers meanwhile, with a bounded set of figures', run.served > 100 && run.figs + run.pool <= 8 && run.orders <= 8, JSON.stringify(run));
    // ---- CPU time per frame of the café systems under load
    const cpu = await p.evaluate(() => { const G = __game; const t0 = performance.now(); const n = 3000; for (let i = 0; i < n; i++) { G.cafe.update(0.016); G.cafeView.update(0.016); } return (performance.now() - t0) / n; });
    NUM.push(`café update + view: ${cpu.toFixed(4)} ms per frame`);
    check('café simulation + view cost under 0.5 ms per frame', cpu < 0.5, cpu.toFixed(4) + ' ms');
    // ---- open / close boards many times: no DOM growth, no leaked toasts / timers
    const cycle = () => p.evaluate(async () => { const ui = __game.ui; for (let i = 0; i < 150; i++) { for (const n of ['cafe', 'staff', 'finance', 'station', 'business']) { ui.open(n); } ui.closeModal(); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 30)); } });
    await cycle(); await p.waitForTimeout(400); // the first round leaves the last board's content in the card
    const dom0 = await p.evaluate(() => document.querySelectorAll('*').length);
    await cycle();
    await p.waitForTimeout(600);
    const dom1 = await p.evaluate(() => document.querySelectorAll('*').length);
    check('opening and closing boards 750 times does not grow the page', dom1 - dom0 < 20, `${dom0} -> ${dom1} elements`);
    const timers = await p.evaluate(() => ({ rq: !!__game.ui._rq, floats: Object.keys(__game.ui._floatBtns || {}).length }));
    check('no pending render timer and one button per floating control', !timers.rq && timers.floats <= 2, JSON.stringify(timers));
  }
  await ctx.close();
}
console.log(R.join('\n')); console.log(NUM.join('\n')); console.log('ERRORS:', [...new Set(errs)].join('|') || 'none');
await browser.close();
