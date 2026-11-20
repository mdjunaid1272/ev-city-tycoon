import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
// count net listeners per (target, type) on window and the canvas from the very first script
await ctx.addInitScript(() => {
  window.__NO_TUTORIAL = false; localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' }));
  const net = (window.__net = {});
  const wrap = (proto, name) => {
    const add = proto.addEventListener, rem = proto.removeEventListener;
    proto.addEventListener = function (type, fn, opts) { const k = `${name(this)}:${type}`; if (fn) { (net[k] ||= new Map()); const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture); const id = type + cap; const set = net[k]; const key = fn; const m = set.get(key) || new Set(); if (!m.has(cap)) { m.add(cap); set.set(key, m); } } return add.call(this, type, fn, opts); };
    proto.removeEventListener = function (type, fn, opts) { const k = `${name(this)}:${type}`; const set = net[k]; if (set && fn) { const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture); const m = set.get(fn); if (m) { m.delete(cap); if (!m.size) set.delete(fn); } } return rem.call(this, type, fn, opts); };
  };
  wrap(EventTarget.prototype, (t) => (t === window ? 'window' : t && t.id === 'c' ? 'canvas' : t && t.id === 'joy-zone' ? 'joy' : 'other'));
  window.__live = () => Object.fromEntries(Object.entries(net).filter(([k]) => /^(window|canvas|joy):/.test(k)).map(([k, v]) => [k, v.size]).filter(([, n]) => n > 0));
});
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(process.env.EVCT_URL || 'http://localhost:5173/');
await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
await p.waitForFunction(() => window.__game?.tutorial, null, { timeout: 90000 }); await p.waitForTimeout(1500);
const before = await p.evaluate(() => window.__live());
const gameTypes = ['window:keydown', 'window:keyup', 'window:blur', 'window:resize', 'window:visibilitychange', 'window:beforeunload', 'canvas:pointerdown', 'canvas:pointermove', 'canvas:pointerup', 'canvas:wheel', 'joy:pointerdown'];
check('the running game has registered its listeners', gameTypes.every((k) => (before[k] || 0) > 0), JSON.stringify(before));
const busBefore = await p.evaluate(() => __game.bus.count());
check('the game has many bus subscriptions while running', busBefore > 100, 'count=' + busBefore);
await p.evaluate(() => { window.__keep = __game; });
await p.evaluate(() => { window.__keep.dispose(); window.__keep.dispose(); }); // twice on purpose: must be harmless
await p.waitForTimeout(300);
const frameA = await p.evaluate(() => __keep.sm.renderer.info.render.frame);
await p.waitForTimeout(700);
const frameB = await p.evaluate(() => __keep.sm.renderer.info.render.frame);
const after = await p.evaluate(() => window.__live());
// listeners only the game uses must be gone entirely; types the browser tooling also uses must have dropped by the game's share
const shared = ['window:beforeunload', 'window:pointerdown', 'window:pointerup', 'window:pointercancel'];
const ownTypes = gameTypes.filter((k) => !shared.includes(k));
const leaked = [...ownTypes.filter((k) => (after[k] || 0) > 0), ...shared.filter((k) => (after[k] || 0) >= (before[k] || 0))];
check('after dispose() no game listener is left on window / canvas / joystick', leaked.length === 0, 'leaked=' + JSON.stringify(leaked) + ' before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after));
check('every EventBus subscription is removed', await p.evaluate(() => __keep.bus.count() === 0));
check('the render loop has stopped', frameA === frameB, `${frameA} -> ${frameB}`);
check('window.__game is released', await p.evaluate(() => window.__game === undefined));
check('the HUD is no longer blocked', await p.evaluate(() => !document.getElementById('hud').inert));
check('no tutorial markers or hand remain in the page', await p.evaluate(() => !document.getElementById('tut-hand') && !document.body.classList.contains('tut-on')));
console.log(R.join('\n')); console.log('ERRORS:', [...new Set(errs)].join('|') || 'none');
await browser.close();
