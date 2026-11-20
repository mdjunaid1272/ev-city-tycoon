import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
async function open(touch) {
  const ctx = await browser.newContext({ viewport: touch ? { width: 390, height: 780 } : { width: 1100, height: 700 }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto((process.env.EVCT_URL || 'http://localhost:5173/')); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
  await p.waitForFunction(() => window.__game?.ui, null, { timeout: 90000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const G = __game; G.economy.cash = 900000; G.customers.enabled = false; G.player.pos.set(60, 0.34, 60); });
  return p;
}
// ===== desktop =====
let p = await open(false);
const vp = await p.evaluate(() => document.querySelector('meta[name=viewport]').content);
check('viewport allows browser zoom', !/user-scalable\s*=\s*no|maximum-scale/.test(vp), vp);
// open Staff from the bottom nav with the keyboard-ish path
await p.focus('.sc[data-open="staff"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
const f1 = await p.evaluate(() => ({ modal: __game.ui.modal, inCard: document.getElementById('modal-card').contains(document.activeElement) || document.activeElement === document.getElementById('modal-card') }));
check('opening a board moves focus into it', f1.modal === 'staff' && f1.inCard, JSON.stringify(f1));
let escaped = 0; for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); if (!(await p.evaluate(() => document.getElementById('modal-card').contains(document.activeElement)))) escaped++; }
check('Tab never leaves the open board (40 presses)', escaped === 0, 'escaped=' + escaped);
escaped = 0; for (let i = 0; i < 40; i++) { await p.keyboard.press('Shift+Tab'); if (!(await p.evaluate(() => document.getElementById('modal-card').contains(document.activeElement)))) escaped++; }
check('Shift+Tab never leaves the open board', escaped === 0, 'escaped=' + escaped);
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
const f2 = await p.evaluate(() => ({ modal: __game.ui.modal, back: document.activeElement?.dataset?.open }));
check('Escape closes the board and focus returns to the nav button', f2.modal === null && f2.back === 'staff', JSON.stringify(f2));
// pause is blocking: HUD inert, settings keeps the pause state
await p.evaluate(() => __game.ui.open('pause')); await p.waitForTimeout(200);
const b1 = await p.evaluate(() => ({ inert: document.getElementById('hud').inert, paused: __game.paused }));
await p.evaluate(() => __game.ui.open('settings')); await p.waitForTimeout(200);
const b2 = await p.evaluate(() => ({ modal: __game.ui.modal, paused: __game.paused, inert: document.getElementById('hud').inert }));
check('pause blocks the HUD behind it', b1.inert && b1.paused, JSON.stringify(b1));
check('pause -> settings stays paused, still blocking', b2.modal === 'settings' && b2.paused && b2.inert, JSON.stringify(b2));
await p.evaluate(() => __game.ui.closeModal()); await p.waitForTimeout(150);
const b3 = await p.evaluate(() => ({ inert: document.getElementById('hud').inert, paused: __game.paused }));
check('closing resumes and unblocks the HUD', !b3.inert && !b3.paused, JSON.stringify(b3));
// non-blocking boards keep the nav usable
await p.evaluate(() => __game.ui.open('staff')); await p.waitForTimeout(150);
check('normal boards do not block the HUD (nav still works)', await p.evaluate(() => !document.getElementById('hud').inert));
await p.evaluate(() => __game.ui.closeModal());
// confirm dialog: focus on the safe button, background inert, focus restored
const cf = await p.evaluate(async () => {
  const ui = __game.ui; ui.open('staff'); await new Promise((r) => setTimeout(r, 100));
  const trigger = document.querySelector('#modal-card button.btn'); trigger.focus();
  const pr = ui.askConfirm({ title: 'T', text: 'x', yes: 'Yes', danger: true });
  const at = document.activeElement?.dataset?.cf, inert = document.getElementById('modal').inert;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  ui.resolveConfirm(false); const ok = await pr;
  return { at, inert, ok, restored: document.activeElement === trigger, inertAfter: document.getElementById('modal').inert };
});
check('confirm: Cancel focused first, background inert, focus restored', cf.at === 'no' && cf.inert && cf.ok === false && cf.restored && !cf.inertAfter, JSON.stringify(cf));
await p.context().close();
// ===== touch =====
p = await open(true);
await p.evaluate(() => __game.ui.open('staff')); await p.waitForTimeout(300);
const sizes = await p.evaluate(() => {
  const out = {}; const q = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
  const small = [];
  for (const sel of ['#topbar .ibtn', '#cam-bar .ibtn', '.sc', '#modal-card .btn', '#btn-sprint']) for (const e of q(sel)) { const r = e.getBoundingClientRect(); if (r.width > 0 && (r.width < 43.5 || r.height < 43.5)) small.push(`${sel}:${Math.round(r.width)}x${Math.round(r.height)}`); }
  return { small: [...new Set(small)] };
});
check('touch: important controls are at least 44px', sizes.small.length === 0, JSON.stringify(sizes.small));
await p.evaluate(() => __game.ui.closeModal()); await p.waitForTimeout(200);
const ov = await p.evaluate(() => {
  const ids = ['topbar', 'daily', 'cam-bar', 'shortcuts', 'btn-sprint', 'btn-interact', 'joy-base'];
  const rects = ids.map((id) => { const e = document.getElementById(id); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width ? { id, l: r.left, t: r.top, r: r.right, b: r.bottom } : null; }).filter(Boolean);
  const hits = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) hits.push(a.id + '/' + b.id); }
  return hits;
});
check('touch: no overlap between HUD controls, sprint button and joystick', ov.length === 0, JSON.stringify(ov));
const clip = await p.evaluate(() => { const bad = []; for (const id of ['topbar', 'shortcuts', 'cam-bar', 'daily']) { const r = document.getElementById(id).getBoundingClientRect(); if (r.left < -1 || r.right > innerWidth + 1) bad.push(id); } return bad; });
check('touch: nothing clipped horizontally', clip.length === 0, JSON.stringify(clip));
await p.context().close();
console.log(R.join('\n')); console.log('ERRORS:', [...new Set(errs)].join('|') || 'none');
await browser.close();


