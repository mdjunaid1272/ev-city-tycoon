import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
async function open(touch = false) {
  const ctx = await browser.newContext({ viewport: touch ? { width: 400, height: 800 } : { width: 1000, height: 600 }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto((process.env.EVCT_URL || 'http://localhost:5173/')); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
  await p.waitForFunction(() => window.__game?.tutorial, null, { timeout: 90000 }); await p.waitForTimeout(800);
  return p;
}
let p = await open();
// ---- customer counts: queue customers are counted once
const c = await p.evaluate(() => {
  const G = __game; G.customers.enabled = false; G.player.pos.set(60, 0.34, 60);
  G.tutorial.finish();
  for (let i = 0; i < 12; i++) G.customers.spawn('regular');
  for (let i = 0; i < 4000; i++) { G.traffic.update(0.1, { x: 0, z: 0 }); G.customers.update(0.1); G.station.update(0.1); G.stationView.update(0.1, { x: 500, z: 500 }); for (const x of G.customers.customers.values()) x.patience = x.maxPatience; if (G.customers.queue.length >= 2) break; }
  G.ui.updateDaily();
  const shown = +document.getElementById('d-cust').textContent;
  const total = G.customers.customers.size, queue = G.customers.queue.length;
  const inMap = G.customers.queue.every((q) => G.customers.customers.has(q.id));
  const detail = ['dd-queued', 'dd-waiting', 'dd-charging', 'dd-service'].map((id) => +document.getElementById(id).textContent);
  return { shown, total, queue, inMap, oldFormula: total + queue, detail };
});
check('queued customers are inside the customer map (so adding queue length double counts)', c.inMap && c.queue > 0, JSON.stringify(c));
check('HUD shows each customer once', c.shown === c.total && c.shown !== c.oldFormula, JSON.stringify(c));
check('breakdown never exceeds the total and queued matches the queue', c.detail.reduce((a, b) => a + b, 0) <= c.shown && c.detail[0] === c.queue, JSON.stringify(c.detail));
// ---- tutorial: bay target never falls back to an arbitrary bay
const t = await p.evaluate(() => {
  const G = __game; const T = G.tutorial;
  for (const b of G.station.bays) { b.state = 'empty'; }
  const none = T.targets.bay(['waiting', 'charging']);
  G.station.bays[1].state = 'charging';
  const one = T.targets.bay(['waiting', 'charging']);
  const wantIdx = G.stationView.interactables.find((i) => i.id === 'bay1').pos.x;
  G.station.bays[1].state = 'empty';
  return { none, oneX: one?.x, wantIdx, term: !!T.targets.terminal() };
});
check('no bay in the requested state -> no target', t.none === null, JSON.stringify(t));
check('matching bay is targeted', t.oneX === t.wantIdx, JSON.stringify(t));
check('terminal step has a target', t.term);
// ---- tutorial pause: success countdown frozen while paused
const pz = await p.evaluate(() => {
  const G = __game, T = G.tutorial; T.done = false; T.begin(1, false); T.state = 'ok'; T.okTimer = 1.0;
  G.paused = true; for (let i = 0; i < 30; i++) T.update(0.1);
  const frozen = { step: T.step, timer: +T.okTimer.toFixed(2) };
  G.paused = false; for (let i = 0; i < 12; i++) T.update(0.1);
  return { frozen, after: T.step };
});
check('tutorial countdown does not run while paused', pz.frozen.step === 1 && pz.frozen.timer === 1, JSON.stringify(pz));
check('tutorial resumes after unpause', pz.after === 2, JSON.stringify(pz));
// ---- walking progress ignores pause and teleports
const wk = await p.evaluate(() => {
  const G = __game, T = G.tutorial; T.done = false; T.begin(0, false); T.update(0.1);
  G.player.pos.x += 50; T.update(0.1); // fast travel
  G.paused = true; G.player.pos.x += 2; T.update(0.1); G.paused = false; T.update(0.1);
  return T.n.walked;
});
check('teleport / pause do not count as walking', wk < 1, 'walked=' + wk);
// ---- skip + replay + persistence
const sk = await p.evaluate(() => { const T = __game.tutorial; T.skip(); const a = T.serialize(); T.restart(); const b = T.serialize(); return { a, b, dup: document.querySelectorAll('#tut-hand').length, markers: __game.sm.scene.children.filter((o) => o === T.marker).length }; });
check('skip finishes, replay restarts at step 0, single hand + marker', sk.a.done && !sk.b.done && sk.b.step === 0 && sk.dup === 1 && sk.markers === 1, JSON.stringify(sk));
const hint = await p.evaluate(() => { const T = __game.tutorial; T.touch = false; T.render(); const d = document.getElementById('tut-hint').textContent; T.touch = true; T.render(); const m = document.getElementById('tut-hint').textContent; return { d, m }; });
check('desktop and mobile move hints are separate and mention the joystick', /mouse/.test(hint.d) && /joystick/.test(hint.m), JSON.stringify(hint));
await p.context().close();
// ---- real touch device
p = await open(true);
const tt = await p.evaluate(() => ({ touch: document.body.classList.contains('touch'), hint: document.getElementById('tut-hint').textContent, joy: document.getElementById('joy-base').getBoundingClientRect().width > 0 }));
check('touch device: joystick hint shown and joystick visible', tt.touch && /joystick/.test(tt.hint) && tt.joy, JSON.stringify(tt));
await p.context().close();
console.log(R.join('\n')); console.log('ERRORS:', errs.join('|') || 'none');
await browser.close();

