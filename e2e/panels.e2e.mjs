import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto((process.env.EVCT_URL || 'http://localhost:5173/')); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
await p.waitForFunction(() => window.__game?.ui, null, { timeout: 90000 }); await p.waitForTimeout(800);
await p.evaluate(() => { const G = __game; G.economy.cash = 900000; G.economy.reputation = 90; G.progression.stage = 4; for (const d of ['residential', 'commercial', 'industrial', 'highway']) G.districts.unlock(d); G.wash.build(); G.garage.build(); G.properties.buy('hub_small'); G.customers.enabled = false; G.player.pos.set(60, 0.34, 60); });
// ---- every panel opens, renders and closes
const names = ['business', 'staff', 'finance', 'missions', 'stats', 'map', 'station', 'wash', 'garage', 'hub_small', 'settings', 'help', 'save', 'pause'];
for (const m of names) {
  const r = await p.evaluate(async (m) => {
    const G = __game, ui = G.ui; ui.open(m); await new Promise((r) => setTimeout(r, 250));
    const card = document.getElementById('modal-card'); const len = card.textContent.trim().length; const opened = ui.modal === m;
    ui.closeModal(); const closed = ui.modal === null && document.getElementById('modal').classList.contains('hidden') || ui.modal === null;
    return { opened, len, closed, paused: G.paused };
  }, m);
  check(`panel ${m} opens with content and closes`, r.opened && r.len > 20 && r.closed, JSON.stringify(r));
}
const afterPause = await p.evaluate(() => __game.paused);
check('closing the pause panel resumes the game', afterPause === false, 'paused=' + afterPause);
// ---- Statistics updates live (event-driven) while open
await p.evaluate(() => { __game.ui.open('stats'); });
await p.waitForTimeout(300);
const before = await p.evaluate(() => document.getElementById('modal-card').textContent);
await p.evaluate(() => { const G = __game; G.economy.earn(250, 'charging', 'test-stat-1'); G.stats.total.served += 3; G.bus.emit('customer:paid', { customer: { def: { icon: 'x' } }, satisfaction: 80, tip: 0 }); });
await p.waitForTimeout(500);
const after = await p.evaluate(() => document.getElementById('modal-card').textContent);
check('Statistics panel changes while open (served + revenue)', before !== after && /Customers served\s*\d+/.test(after), '');
const served = await p.evaluate(() => ({ shown: (document.getElementById('modal-card').textContent.match(/Customers served(\d+)/) || [])[1], real: __game.stats.total.served }));
check('Statistics shows the real served count', +served.shown === served.real, JSON.stringify(served));
// ---- in-place refresh keeps scroll, focus and DOM identity
await p.evaluate(() => { __game.ui.open('staff'); });
await p.waitForTimeout(300);
const keep = await p.evaluate(async () => {
  const card = document.getElementById('modal-card'); const btn = card.querySelector('button.btn'); const id = btn ? btn.dataset.empAct : null;
  card.scrollTop = 40; btn?.focus(); const node = btn;
  __game.economy.cash += 1; __game.ui._modalHtml = null; __game.ui.renderModal(); // force a render with (possibly) changed values
  await new Promise((r) => setTimeout(r, 50));
  return { scroll: card.scrollTop, sameNode: card.querySelector('button.btn') === node, focused: document.activeElement === node, id };
});
check('refresh keeps the same button node and its focus', keep.sameNode && keep.focused, JSON.stringify(keep));
// (the in-place patcher itself is unit-tested in tests/dom-patch.test.js)
// ---- a press in progress is never interrupted
const press = await p.evaluate(async () => {
  const ui = __game.ui; ui.closeModal(); ui.open('staff'); await new Promise((r) => setTimeout(r, 250));
  const card = document.getElementById('modal-card'); card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  ui._modalHtml = null; ui.renderModal(); const dirty = ui._dirty;
  addEventListener('pointerup', () => {}, true); dispatchEvent(new PointerEvent('pointerup')); await new Promise((r) => setTimeout(r, 200));
  return { dirty, cleared: ui._dirty === false };
});
check('render is deferred while a pointer is down, then runs', press.dirty && press.cleared, JSON.stringify(press));
console.log(R.join('\n')); console.log('ERRORS:', [...new Set(errs)].join('|') || 'none');
await browser.close();

