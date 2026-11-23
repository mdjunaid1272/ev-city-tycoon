import { chromium } from 'playwright-core';
// The café kitchen (cooking-game screen): the Café button walks the player in and opens it; tickets, stations, timing, tips, closing, phone layout.
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const URL = process.env.EVCT_URL || 'http://localhost:5173/';

async function boot(viewport, touch) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
  await p.waitForFunction(() => window.__game?.kitchenUI, null, { timeout: 90000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const G = __game; G.progression.stage = 3; G.economy.cash = 90000; G.economy.reputation = 40; G.customers.enabled = false; G.hub.build('coffee', G.progression); G.player.pos.set(17.5, 0.34, -3.5); });
  await p.waitForTimeout(600);
  return p;
}
// deterministic sim steps while the real frame loop keeps rendering (headless frames are slow)
const sim = (p, secs) => p.evaluate((secs) => { const G = __game, dt = 0.05; const was = G.paused; G.paused = true; for (let t = 0; t < secs; t += dt) { G.time += dt; G.cafe.update(dt); G.employees.update(dt); G.cafeView.playerPos = G.player.pos; G.cafeView.update(dt); G.player.update(dt, G.camera.moveYaw); if (G.kitchenWhenThere) { const pp = G.player.pos; if (G.player.target === null && G.player.route.length === 0 && !G.kitchenUI.isOpen) { /* arrival handled below */ } } G.kitchenUI.update(dt); }
  G.paused = was; G.kitchenUI.refresh(); }, secs);
const arrive = (p) => p.waitForFunction(() => __game.kitchenUI.isOpen, null, { timeout: 120000 }).then(() => true, () => false); // the real frame loop walks the player and opens the kitchen

let p = await boot({ width: 1100, height: 680 }, false);
await p.evaluate(() => { __game.timeScaleDebug = 1; });
await p.evaluate(() => { for (let i = 0; i < 4; i++) __game.cafe.spawnWalkIn(); });
await p.waitForTimeout(500);
const btn = await p.evaluate(() => { const b = document.getElementById('cafe-open'); return b && { shown: b.style.display }; });
check('the Café button hangs over the door', btn && btn.shown === 'block', JSON.stringify(btn));
await p.locator('#cafe-open').click({ force: true });
check('tapping it sends the player in; the kitchen is not open yet', await p.evaluate(() => __game.kitchenWhenThere === true && !__game.kitchenUI.isOpen && (__game.player.target || __game.player.route.length) ? true : false));
check('on arrival at the counter the kitchen opens by itself', await arrive(p));
await p.waitForTimeout(400);
const ui = await p.evaluate(() => ({ visible: !document.getElementById('kitchen').classList.contains('hidden'), cards: document.querySelectorAll('#kitchen .k-c').length, stations: document.querySelectorAll('#kitchen .k-st').length, hudInert: document.getElementById('hud').inert, enabled: __game.player.enabled, board: getComputedStyle(document.getElementById('cafe-board')).display }));
check('the kitchen shows tickets and six stations, locks the HUD and the player', ui.visible && ui.cards === 4 && ui.stations === 6 && ui.hudInert && !ui.enabled && ui.board === 'none', JSON.stringify(ui));

// pick a ticket, cook it
const first = await p.evaluate(() => { const c = document.querySelector('#kitchen .k-c'); return { oid: c.dataset.oid, pid: __game.cafe.orders.find((o) => o.id === c.dataset.oid).pid }; });
await p.locator(`#kitchen [data-oid="${first.oid}"]`).click({ force: true });
const sel = await p.evaluate((oid) => ({ sel: document.querySelector('#kitchen .k-c.sel')?.dataset.oid, claimed: __game.cafe.orders.find((o) => o.id === oid).kitchen, need: [...document.querySelectorAll('#kitchen .k-st.need')].map((b) => b.dataset.st), steps: document.querySelectorAll('#kitchen .k-step').length }), first.oid);
check('selecting a customer claims the order and lights up the stations it needs', sel.sel === first.oid && sel.claimed && sel.need.length >= 1 && sel.steps >= 1, JSON.stringify(sel));
const wrong = await p.evaluate(() => { const need = new Set([...document.querySelectorAll('#kitchen .k-st.need')].map((b) => b.dataset.st)); return [...document.querySelectorAll('#kitchen .k-st')].map((b) => b.dataset.st).find((s) => !need.has(s)); });
await p.locator(`#kitchen [data-st="${wrong}"]`).click({ force: true }); await p.waitForTimeout(250);
check('a wrong station says what the order still needs', await p.evaluate(() => /Still needs/.test(document.getElementById('k-note').textContent)));
// cook every step of the ticket
for (let i = 0; i < 8; i++) {
  const todo = await p.evaluate(() => { const L = __game.kitchenUI.logic; return { next: L.nextStations(), ready: Object.entries(L.jobs).filter(([, j]) => j.state === 'ready').map(([s]) => s), open: !!L.ticket }; });
  if (!todo.open) break;
  for (const s of todo.next) await p.locator(`#kitchen [data-st="${s}"]`).click({ force: true });
  await sim(p, 4);
  for (const s of await p.evaluate(() => Object.entries(__game.kitchenUI.logic.jobs).filter(([, j]) => j.state === 'ready').map(([s]) => s))) await p.locator(`#kitchen [data-st="${s}"]`).click({ force: true });
}
const served = await p.evaluate(() => ({ session: { ...__game.kitchenUI.logic.session }, today: __game.cafe.today.served, tips: __game.economy.ledger.revenue.tips || 0, tips2: document.getElementById('k-tips').textContent, ticketsLeft: document.querySelectorAll('#kitchen .k-c').length }));
check('cooking all steps serves the customer: paid, tipped, counted, ticket gone', served.session.served >= 1 && served.today >= 1 && served.ticketsLeft === 3 && served.session.tips > 0 && /\$[1-9]|\$0\.[1-9]/.test(served.tips2), JSON.stringify(served));

// keyboard: number selects a ticket, Esc closes and gives the order back
await p.keyboard.press('1'); await p.waitForTimeout(250);
const k1 = await p.evaluate(() => ({ claimed: __game.cafe.orders.filter((o) => o.kitchen).length }));
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
const closed = await p.evaluate(() => ({ hidden: document.getElementById('kitchen').classList.contains('hidden'), open: __game.kitchenUI.isOpen, claimed: __game.cafe.orders.filter((o) => o.kitchen).length, enabled: __game.player.enabled, hudInert: document.getElementById('hud').inert, paused: __game.paused || !!__game.ui.modal }));
check('keyboard: 1 selects the first customer, Esc closes the kitchen (no pause menu) and returns the order', k1.claimed === 1 && closed.hidden && !closed.open && closed.claimed === 0 && closed.enabled && !closed.hudInert && !closed.paused, JSON.stringify({ k1, closed }));
// already inside: the button opens it directly
await p.evaluate(() => { __game.player.pos.set(16.4, 0.34, -17.8); __game.cafeView.playerPos = __game.player.pos; }); await sim(p, 0.2);
await p.waitForTimeout(700);
await p.locator('#cafe-open').click({ force: true }); await p.waitForTimeout(300);
check('standing inside, the Café button opens the kitchen straight away', await p.evaluate(() => __game.kitchenUI.isOpen));
// the gear goes to the manager board
await p.locator('#kitchen [data-k="manage"]').click({ force: true }); await p.waitForTimeout(400);
check('the gear closes the kitchen and opens the café manager', await p.evaluate(() => !__game.kitchenUI.isOpen && __game.ui.modal === 'cafe'));
await p.context().close();

// phone: everything fits, big targets
p = await boot({ width: 390, height: 780 }, true);
await p.evaluate(() => { for (let i = 0; i < 4; i++) __game.cafe.spawnWalkIn(); __game.player.pos.set(16.4, 0.34, -17.8); __game.openKitchen(); });
await sim(p, 0.5); await p.waitForTimeout(500);
const m = await p.evaluate(() => {
  const r = (e) => e.getBoundingClientRect(), k = document.getElementById('kitchen');
  const sts = [...document.querySelectorAll('#kitchen .k-st')].map(r), cust = r(document.getElementById('k-cust')), close = r(document.querySelector('#kitchen [data-k="close"]'));
  return { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, scrollH: k.scrollHeight, h: k.clientHeight, minStation: Math.min(...sts.map((q) => Math.min(q.width, q.height))), stOut: sts.some((q) => q.left < 0 || q.right > innerWidth || q.bottom > innerHeight), close: [close.width, close.height], custTop: cust.top, noteBottom: r(document.getElementById('k-foot')).bottom };
});
check('phone: no overflow, stations and the close button are at least 44px, everything on screen', m.sw <= m.vw && m.scrollH <= m.h + 2 && m.minStation >= 64 && !m.stOut && m.close[0] >= 44 && m.close[1] >= 44 && m.noteBottom <= m.vh, JSON.stringify(m));
await p.screenshot({ path: process.env.EVCT_SHOT || 'C:/dev/evct-deps/shots/kitchen_mobile.png' });
await p.context().close();

// desktop screenshot with a ticket in progress
p = await boot({ width: 1280, height: 720 }, false);
await p.evaluate(() => { for (let i = 0; i < 5; i++) __game.cafe.spawnWalkIn(); __game.player.pos.set(16.4, 0.34, -17.8); __game.openKitchen(); const L = __game.kitchenUI.logic; const o = __game.cafe.orders.find((x) => x.pid === 'latte') || __game.cafe.orders[0]; L.select(o.id); L.tapStation(L.nextStations()[0]); L.update(1); });
await sim(p, 0.3); await p.waitForTimeout(400);
await p.screenshot({ path: 'C:/dev/evct-deps/shots/kitchen_desktop.png' });
await p.context().close();

console.log(R.join('\n')); console.log('ERRORS:', errs.length ? [...new Set(errs)].join(' | ') : 'none');
await browser.close();
process.exit(R.some((r) => r.startsWith('FAIL')) || errs.length ? 1 : 0);
