import { chromium } from 'playwright-core';
// The café order board: appears only while the player is inside the café, lists live orders, tapping a waiting order makes the owner take it next.
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const URL = process.env.EVCT_URL || 'http://localhost:5173/';

async function boot(viewport, touch) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
  await p.waitForFunction(() => window.__game?.cafeBoard, null, { timeout: 90000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const G = __game; G.progression.stage = 3; G.economy.cash = 90000; G.economy.reputation = 40; G.customers.enabled = false; G.hub.build('coffee', G.progression); G.player.pos.set(17.5, 0.34, -3.5); });
  await p.waitForTimeout(600);
  return p;
}
// one deterministic simulation step (headless frames are slow); the real frame loop still renders and updates the board
const step = (p, n) => p.evaluate((n) => { const G = __game, dt = 0.05; const was = G.paused; G.paused = true; for (let i = 0; i < n; i++) { G.time += dt; G.cafe.update(dt); G.ownerWork.update(dt); G.employees.update(dt); G.cafeView.playerPos = G.player.pos; G.cafeView.update(dt); G.player.update(dt, G.camera.moveYaw); } G.paused = was; G.cafeBoard.update(1); }, n);

let p = await boot({ width: 1100, height: 680 }, false);
const outside = await p.evaluate(() => ({ hidden: document.getElementById('cafe-board').classList.contains('hidden'), inside: __game.cafeView.inside }));
check('the board is hidden while the player is outside the café', outside.hidden && !outside.inside, JSON.stringify(outside));

await p.evaluate(() => { const G = __game; G.player.pos.set(17.5, 0.34, -10); for (let i = 0; i < 4; i++) G.cafe.spawnWalkIn(); });
await step(p, 4);
await p.waitForTimeout(500);
const inside = await p.evaluate(() => { const b = document.getElementById('cafe-board'); return { hidden: b.classList.contains('hidden'), rows: b.querySelectorAll('.cb-o').length, n: b.querySelector('.cb-n')?.textContent, head: b.querySelector('.cb-h b')?.textContent, foot: b.querySelector('.cb-f')?.textContent, orders: __game.cafe.orders.length }; });
check('inside the café the board shows every open order with a count and the day summary', !inside.hidden && inside.rows === Math.min(6, inside.orders) && inside.rows >= 3 && Number(inside.n) === inside.orders && /Served today/.test(inside.foot), JSON.stringify(inside));

// tapping a waiting order: the owner takes THAT one next
const pick = await p.evaluate(() => { const rows = [...document.querySelectorAll('#cafe-board [data-cb-order]')]; return rows.length ? rows[rows.length - 1].dataset.cbOrder : null; });
await p.locator(`#cafe-board [data-cb-order="${pick}"]`).click({ force: true });
await step(p, 1); // refresh the board now instead of waiting for the next frame
const marked = await p.evaluate((k) => ({ prefer: __game.ownerWork.preferKey === k, walking: !!__game.player.target, text: document.querySelector(`#cafe-board [data-cb-order="${k}"]`)?.textContent || '' }), pick);
check('tapping a waiting order marks it "Next" and does not walk the character', marked.prefer && !marked.walking && /Next/.test(marked.text), JSON.stringify(marked));
await p.evaluate(() => __game.player.pos.set(16.4, 0.34, -17.8));
await step(p, 6);
const taken = await p.evaluate((k) => ({ working: __game.ownerWork.working, key: __game.ownerWork.task?.key, row: document.querySelector('#cafe-board .cb-o.busy em')?.textContent }), pick);
check('the owner starts on the tapped order, and the board shows "You"', taken.working && taken.key === pick && /^You/.test(taken.row || ''), JSON.stringify(taken));
await step(p, 400);
const done = await p.evaluate(() => ({ served: __game.cafe.today.served, foot: document.querySelector('#cafe-board .cb-f')?.textContent }));
check('served orders and revenue update in the footer', done.served >= 1 && new RegExp(`Served today ${done.served}`).test(done.foot), JSON.stringify(done));

// fold, manage, hidden with a board open / in management view
await p.locator('#cafe-board [data-cb="fold"]').click({ force: true }); await p.waitForTimeout(200);
check('the fold button hides the list but keeps the header', await p.evaluate(() => !document.querySelector('#cafe-board .cb-list') && !!document.querySelector('#cafe-board .cb-h')));
await p.locator('#cafe-board [data-cb="fold"]').click({ force: true }); await p.waitForTimeout(200);
await p.locator('#cafe-board [data-cb="manage"]').click({ force: true }); await p.waitForTimeout(400);
const opened = await p.evaluate(() => ({ modal: __game.ui.modal }));
await step(p, 2);
check('the gear opens the café manager, and the board hides behind an open board', opened.modal === 'cafe' && await p.evaluate(() => document.getElementById('cafe-board').classList.contains('hidden')), JSON.stringify(opened));
await p.evaluate(() => __game.ui.closeModal());
await p.evaluate(() => __game.player.pos.set(17.5, 0.34, -3.5)); await step(p, 2);
check('walking out of the café hides the board again', await p.evaluate(() => document.getElementById('cafe-board').classList.contains('hidden')));
await p.context().close();

// phone: the board fits next to the camera buttons and does not cover the joystick / bottom bar
p = await boot({ width: 390, height: 780 }, true);
await p.evaluate(() => { const G = __game; G.player.pos.set(17.5, 0.34, -10); for (let i = 0; i < 4; i++) G.cafe.spawnWalkIn(); });
await step(p, 4); await p.waitForTimeout(600);
const m = await p.evaluate(() => {
  const r = document.getElementById('cafe-board').getBoundingClientRect(), cam = document.getElementById('cam-bar').getBoundingClientRect(), nav = document.getElementById('nav')?.getBoundingClientRect();
  return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, camL: cam.left, sw: document.documentElement.scrollWidth, navTop: nav ? nav.top : null };
});
const ov = await p.evaluate(() => { const r = document.getElementById('cafe-board').getBoundingClientRect(); const hit = (id) => { const q = document.getElementById(id)?.getBoundingClientRect(); return !!q && q.width > 0 && !(r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom); }; return { daily: hit('daily'), mission: hit('mission'), joy: hit('joy-base'), cam: hit('cam-bar'), nav: hit('bottom-nav') || hit('nav') }; });
check('phone: the board fits on screen and covers neither the daily / objective panels, the joystick, the camera buttons nor the bottom bar', m.l >= 0 && m.r <= m.vw && m.b <= m.vh && m.sw <= m.vw && !ov.daily && !ov.mission && !ov.joy && !ov.cam && !ov.nav, JSON.stringify({ m, ov }));
await p.screenshot({ path: process.env.EVCT_SHOT || 'C:/dev/evct-deps/shots/cafe_board_mobile.png' });
await p.context().close();

console.log(R.join('\n')); console.log('ERRORS:', errs.length ? [...new Set(errs)].join(' | ') : 'none');
await browser.close();
process.exit(R.some((r) => r.startsWith('FAIL')) || errs.length ? 1 : 0);
