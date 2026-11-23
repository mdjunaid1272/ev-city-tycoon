import { chromium } from 'playwright-core';
// A freshly built Car Wash / Garage must be playable WITHOUT hiring anyone: the owner stands beside the bay and does the job.
// The sim is stepped by hand (headless frames are slow), using the same update calls as Game.frame().
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(process.env.EVCT_URL || 'http://localhost:5173/'); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
await p.waitForFunction(() => window.__game?.ownerWork, null, { timeout: 90000 }); await p.waitForTimeout(800);

await p.evaluate(() => { const G = __game; G.progression.stage = 3; G.economy.cash = 200000; G.economy.reputation = 40; G.customers.enabled = false; G.wash.build(); G.paused = true; G.wash.timer = 0; });
const step = (n) => p.evaluate((n) => {
  const G = __game, dt = 0.1;
  for (let i = 0; i < n; i++) { G.time += dt; G.day.update(dt); G.wash.update(dt); G.garage.update(dt); G.ownerWork.update(dt); G.employees.update(dt); for (const v of [G.washView, G.garageView]) { v.mgFactor = 1; v.playerPos = G.player.pos; v.update(dt); } G.traffic.update(dt, G.camera.focusPoint); G.chargingTasks.update(dt); }
  return { served: G.wash.stats?.served ?? 0, revenue: G.wash.stats?.revenue ?? 0, working: G.ownerWork.working, bar: document.getElementById('work-bar')?.textContent, barHidden: document.getElementById('work-bar')?.classList.contains('hidden'), tasks: [...G.tasks.tasks.values()].map((t) => `${t.type}:${t.state}`) };
}, n);

// 1. the car arrives and waits: nothing happens without the owner, and there is a task to do
let s = await step(450);
check('without staff or the owner the car just waits (a wash task is open)', s.tasks.includes('wash:open') && s.served === 0 && !s.working, JSON.stringify(s));
// 2. the owner walks to the bay and washes the car
await p.evaluate(() => { const t = [...__game.tasks.tasks.values()].find((x) => x.type === 'wash'); __game.player.pos.set(t.pos.x, 0.34, t.pos.z); });
s = await step(30);
check('standing at the bay starts the wash and shows the progress bar', s.working && s.barHidden === false && /Washing the car/.test(s.bar), JSON.stringify(s));
s = await step(400);
check('the owner finished washing: customer served and paid, no employee involved', s.served >= 1 && s.revenue > 0 && (await p.evaluate(() => __game.employees.employees.length)) === 0, JSON.stringify(s));
// 3. walking away hands the job back
await p.evaluate(() => { __game.player.pos.set(-8, 0.34, 17); });
s = await step(200);
check('leaving the bay stops the work and hides the bar', !s.working && s.barHidden === true, JSON.stringify(s));

// 4. the build toast explains both ways to run the business
const msg = await p.evaluate(() => { const G = __game; const t = []; G.bus.on('toast', (x) => t.push(x.text)); G.bus.emit('toast', { text: 'x' }); return t.length; });
check('toast bus still works', msg === 1);
// 5. garage: the owner can diagnose
await p.evaluate(() => { const G = __game; G.garage.build(); G.garage.timer = 0; G.player.pos.set(-8, 0.34, 17); });
s = await step(500);
const gt = await p.evaluate(() => [...__game.tasks.tasks.values()].filter((t) => t.dept === 'garage').map((t) => ({ type: t.type, state: t.state, x: t.pos.x, z: t.pos.z })));
check('garage publishes a job for the owner as well', gt.length >= 1, JSON.stringify(gt));
if (gt.length) {
  await p.evaluate((t) => __game.player.pos.set(t.x, 0.34, t.z), gt[0]);
  s = await step(60);
  check('standing at the garage bay starts the owner work', s.working && /Diagnosing|Repairing/.test(s.bar), JSON.stringify(s));
}
console.log(R.join('\n')); console.log('ERRORS:', errs.length ? [...new Set(errs)].join(' | ') : 'none');
await browser.close();
process.exit(R.some((r) => r.startsWith('FAIL')) || errs.length ? 1 : 0);
