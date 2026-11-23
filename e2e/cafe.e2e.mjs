import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const URL = process.env.EVCT_URL || 'http://localhost:5173/';
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
await p.waitForFunction(() => window.__game?.cafe, null, { timeout: 90000 }); await p.waitForTimeout(1000);
await p.evaluate(() => { const G = __game; G.economy.cash = 80000; G.economy.reputation = 50; G.progression.stage = 4; G.customers.enabled = false; G.player.pos.set(60, 0.34, 60); });

// ---- build the Coffee Shop through the real Upgrades board
await p.evaluate(() => __game.ui.open('upgrades')); await p.waitForTimeout(400);
const hadButton = await p.evaluate(() => !!document.querySelector('#modal-card [data-up="hub:coffee"]'));
check('the Upgrades board offers the Coffee Shop', hadButton);
await p.click('#modal-card [data-up="hub:coffee"]'); await p.waitForTimeout(600);
const built = await p.evaluate(() => ({ built: __game.cafe.built, vis: __game.cafeView.root.visible, stock: __game.cafe.stock.beans, colliders: __game.colliders.boxes.length }));
check('buying the Coffee Shop opens the café: visible, with opening stock', built.built && built.vis && built.stock > 0, JSON.stringify(built));
await p.evaluate(() => __game.ui.closeModal());

// ---- staff: a barista candidate appears and can be hired from the Staff board
const cand = await p.evaluate(() => { const G = __game; const c = G.employees.makeCandidate(); c.role = 'barista'; c.skill = 3; c.cost = G.employees.hireCost(3); c.salary = 150; G.employees.candidates.push(c); return { avail: G.employees.roleAvailable('barista'), id: c.id }; });
check('baristas are available once the café exists', cand.avail);
await p.evaluate(() => __game.ui.open('staff')); await p.waitForTimeout(400);
await p.click(`#modal-card [data-emp-act="hire:${cand.id}"]`); await p.waitForTimeout(400);
const staff = await p.evaluate(() => ({ n: __game.employees.employees.filter((e) => e.dept === 'cafe').length, max: __game.employees.maxStaff }));
check('the barista is hired into the café department', staff.n === 1, JSON.stringify(staff));
await p.evaluate(() => __game.ui.closeModal());

// ---- let the café run for a while (accelerated simulation) and check the full loop
const run = await p.evaluate(() => {
  const G = __game; for (let i = 0; i < 2500; i++) { G.cafe.update(0.1); G.employees.update(0.1); G.cafeView.update(0.1); }
  const s = G.cafe.stats;
  return { orders: s.orders, served: s.served, revenue: s.revenue, lost: s.lost, rev: G.economy.ledger.revenue.cafe, tasks: G.employees.employees.find((e) => e.dept === 'cafe')?.tasksDone, figs: G.cafeView.figures.size, active: G.cafeView.figures.size <= 8 };
});
check('walk-in customers order, the barista prepares, customers pay and leave', run.served > 10 && run.tasks >= run.served - 1 && Math.abs(run.rev - run.revenue) < 0.01, JSON.stringify(run));
check('the visual pool never exceeds 8 figures', run.active);

// ---- floating Café button + board
await p.evaluate(() => { const G = __game; G.player.pos.set(17.5, 0.34, -3.5); G.camera.tp.smooth.set(17.5, 1.6, -3.5); }); // on the lot, in front of the café door
await p.waitForTimeout(1200);
const btn = await p.evaluate(() => { const b = document.getElementById('cafe-open'); return b ? { shown: b.style.display, text: b.textContent } : null; });
check('a floating Café button appears above the door', btn && btn.shown === 'block', JSON.stringify(btn));
await p.locator('#cafe-open').click({ force: true }); await p.waitForTimeout(500);
const walk = await p.evaluate(() => { const G = __game, t = G.player.target, r = G.player.route, last = r.length ? r[r.length - 1] : t; return { modal: G.ui.modal, last: last && { x: last.x, z: last.z }, stops: 1 + r.length, via: [t, ...r].map((q) => q && [+q.x.toFixed(1), +q.z.toFixed(1)]) }; });
check('tapping the Café button sends the player on a route inside, ending at a barista spot behind the counter (no board yet)', walk.modal === null && walk.last && Math.abs(walk.last.z + 17.8) < 0.01 && (Math.abs(walk.last.x - 16.4) < 0.01 || Math.abs(walk.last.x - 18.6) < 0.01) && walk.stops >= 2, JSON.stringify(walk));
// the route goes through the DOOR (x 16.4 .. 18.6 at z -7.5) and never through a wall or the counter
const routeOk = await p.evaluate(() => { const G = __game, pts = [{ x: G.player.pos.x, z: G.player.pos.z }, G.player.target, ...G.player.route]; let ok = true; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; for (let k = 0; k <= 40; k++) { const x = a.x + ((b.x - a.x) * k) / 40, z = a.z + ((b.z - a.z) * k) / 40; if (G.colliders.boxes.some((bx) => bx.h >= 1 && x > bx.minX && x < bx.maxX && z > bx.minZ && z < bx.maxZ && bx.maxZ - bx.minZ < 15 && bx.maxX - bx.minX < 15 && z < -7 && z > -20 && x > 13.5 && x < 21.5)) ok = false; } } return ok; });
check('the route passes only through free space (door, aisle, around the counter)', routeOk);
await p.evaluate(() => { const G = __game; G.player.target = null; G.player.pos.set(16.4, 0.34, -17.8); G.camera.tp.smooth.set(16.4, 1.6, -17.8); });
await p.waitForTimeout(1000);
await p.locator('#cafe-open').click({ force: true }); await p.waitForTimeout(500);
check('already at the counter, the same button opens the café board', await p.evaluate(() => __game.ui.modal === 'cafe'));
for (const tab of ['menu', 'stock', 'upgrades', 'stats', 'overview']) {
  await p.click(`#modal-card [data-tab="cafe:${tab}"]`); await p.waitForTimeout(250);
}
const priceBefore = await p.evaluate(() => __game.cafe.prices.espresso);
await p.click('#modal-card [data-tab="cafe:menu"]'); await p.waitForTimeout(250);
await p.click('#modal-card [data-cafe="price:espresso:+"]'); await p.waitForTimeout(250);
check('the Menu tab changes prices for real', await p.evaluate((b) => __game.cafe.prices.espresso > b, priceBefore));
await p.click('#modal-card [data-tab="cafe:upgrades"]'); await p.waitForTimeout(250);
const cashBefore = await p.evaluate(() => __game.economy.cash);
await p.click('#modal-card [data-cafe="up:machine"]'); await p.waitForTimeout(300);
check('the Upgrades tab buys an upgrade with cash', await p.evaluate((c) => __game.cafe.levels.machine === 1 && __game.economy.cash === c - 2500, cashBefore));
await p.evaluate(() => __game.ui.closeModal());
// the owner would otherwise keep taking orders at the counter: step away so the baristas' own work is what the next checks measure
await p.evaluate(() => { __game.player.pos.set(-8, 0.34, 17); __game.player.target = null; }); await p.waitForTimeout(600);

// ---- selecting the café building in management view
await p.evaluate(() => __game.camera.setMode('management'));
await p.waitForFunction(() => __game.camera.inManagement && __game.camera.blend > 0.99 && !__game.camera.transitioning, null, { timeout: 60000 });
const sel = await p.evaluate(() => {
  const G = __game; G.camera.mg.focus.set(17.5, 0, -17.5); for (let i = 0; i < 8; i++) G.camera.update(0.1); G.sm.camera.updateMatrixWorld(true);
  const T = G.sm.camera.position.constructor; const v = new T(17.5, 2.0, -17.5).project(G.sm.camera);
  G.onClick({ x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, button: 0 });
  const info = G.ui.selectionFn ? G.ui.selectionFn() : null;
  return { title: info?.title, rows: info?.rows.map((r) => r[0]), actions: info?.actions.map((a) => a.label), why: { paused: G.paused, trans: G.camera.transitioning, mode: G.camera.mode, modal: G.ui.modal, decor: G.decor.active, sel: !!G.ui.selectionFn } };
});
check('the café building is selectable with the standard panel', sel.title === 'Café' && ['Level', 'Status', 'Capacity', 'Occupancy', 'Revenue today'].every((k) => sel.rows.includes(k)) && sel.actions.includes('Manage'), JSON.stringify(sel));
await p.evaluate(() => { __game.ui.clearSelection(); __game.camera.setMode('third'); });

// ---- team training program (employee efficiency upgrade) is a real upgrade in the Upgrades board
const team = await p.evaluate(() => { const G = __game; const it = G.upgrades.list().find((i) => i.id === 'team:training'); const speed0 = G.employees.workMult(G.employees.employees[0]); const cash0 = G.economy.cash; const r = G.upgrades.buy('team:training'); return { group: it?.group, desc: it?.desc, ok: r.ok, lvl: G.employees.efficiencyLevel, gain: G.employees.workMult(G.employees.employees[0]) / speed0, paid: cash0 - G.economy.cash }; });
check('Upgrades board lists the team training program; buying it speeds the team up by 5% for $3,000', team.group === 'Team' && team.ok && team.lvl === 1 && Math.abs(team.gain - 1.05) < 1e-6 && team.paid === 3000, JSON.stringify(team));
const staffBoard = await p.evaluate(async () => { __game.ui.open('staff'); await new Promise((r) => setTimeout(r, 400)); const t = document.getElementById('modal-card').textContent; __game.ui.closeModal(); return { workload: /Workload/.test(t), status: /Waiting for work|Preparing an order|Starting shift/.test(t), training: /1\/3/.test(t) }; });
check('the Staff board shows workload, plain-language status and the training level', staffBoard.workload && staffBoard.status && staffBoard.training, JSON.stringify(staffBoard));
// ---- save and reload: everything the player set up comes back
const before = await p.evaluate(async () => { const G = __game; await G.save(); return { levels: { ...G.cafe.levels }, price: G.cafe.prices.espresso, stock: { ...G.cafe.stock }, served: G.cafe.stats.served, barista: G.employees.employees.filter((e) => e.dept === 'cafe').length }; });
await p.reload();
await p.waitForFunction(() => window.__game?.cafe, null, { timeout: 90000 }); await p.waitForTimeout(1200);
const after = await p.evaluate(() => { const G = __game; return { built: G.cafe.built, vis: G.cafeView.root.visible, levels: { ...G.cafe.levels }, price: G.cafe.prices.espresso, stock: { ...G.cafe.stock }, served: G.cafe.stats.served, barista: G.employees.employees.filter((e) => e.dept === 'cafe').length }; });
check('the café, its upgrades, prices, stock, statistics and barista survive save + reload', after.built && after.vis && JSON.stringify(after.levels) === JSON.stringify(before.levels) && after.price === before.price && JSON.stringify(after.stock) === JSON.stringify(before.stock) && after.served === before.served && after.barista === before.barista, JSON.stringify({ before, after }));
const resumed = await p.evaluate(() => { const G = __game; G.customers.enabled = false; for (let i = 0; i < 1200; i++) { G.cafe.update(0.1); G.employees.update(0.1); } return G.cafe.stats.served; });
check('the café keeps working after loading', resumed > after.served, `${after.served} -> ${resumed}`);

console.log(R.join('\n')); console.log('ERRORS:', [...new Set(errs)].join('|') || 'none');
await browser.close();
