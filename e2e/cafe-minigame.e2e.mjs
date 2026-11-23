import { chromium } from 'playwright-core';
// Café mini-game: optional, independent of the café business. Entry through the Café button / menu, a full session played through the UI,
// rewards (one capped payout, not revenue), replay, exit, save data, phone layout, and the city keeps running around it.
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const URL = process.env.EVCT_URL || 'http://localhost:5173/';

async function boot(viewport, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
  await p.waitForFunction(() => window.__game?.miniGameUI, null, { timeout: 90000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const G = __game; G.progression.stage = 3; G.economy.cash = 90000; G.economy.reputation = 40; G.customers.enabled = false; G.hub.build('coffee', G.progression); G.player.pos.set(17.5, 0.34, -3.5); });
  await p.waitForTimeout(600);
  return p;
}
const sim = (p, secs) => p.evaluate((secs) => { const G = __game, dt = 0.05; for (let t = 0; t < secs; t += dt) { G.cafe.update(dt); G.miniGameUI.update(dt); } G.miniGameUI.refresh(); }, secs);
const clickSel = (p, sel) => p.locator(sel).first().click({ force: true });
/** make the first customer's first item through the UI only (clicks), like a player */
async function cookViaUI(p, cid) {
  await clickSel(p, `#mg [data-cid="${cid}"]`);
  for (let guard = 0; guard < 200; guard++) {
    const a = await p.evaluate(() => {
      const L = __game.cafeMiniGame, s = L.session, b = s.build; if (!b) return { done: s.pickup.length > 0 };
      const need = Object.keys(L.recipes.needs(b.pid)).find((r) => L.recipes.acceptsRaw(b.pid, b.used, r));
      if (need) return { sel: `#mg [data-ing="${need}"]` };
      const ready = Object.entries(s.jobs).find(([, j]) => j.state === 'ready');
      if (ready) return { sel: `#mg [data-mach="${ready[0]}"]` };
      if (Object.keys(s.jobs).length) return { wait: true };
      const m = L.recipes.machinesFor(b.pid).find((id) => L.recipes.inputsFor(id, b.tray).ok);
      return m ? { sel: `#mg [data-mach="${m}"]` } : { wait: true };
    });
    if (a.done) return true;
    if (a.sel) await clickSel(p, a.sel); else await sim(p, 0.3);
  }
  return false;
}

let p = await boot({ width: 1100, height: 680 });
const before = await p.evaluate(() => { const G = __game; return { cash: G.economy.cash, rev: G.economy.totalRevenue, stage: G.progression.stage, mg: G.miniGameUI.isOpen }; });

// ---- entry: the Café button walks in, then the menu offers the mini-game
await p.locator('#cafe-open').click({ force: true });
await p.waitForFunction(() => __game.ui.modal === 'cafemenu', null, { timeout: 120000 });
const menu = await p.evaluate(() => ({ modes: document.querySelectorAll('#modal-card [data-cafe^="mg:"]').length, manage: !!document.querySelector('#modal-card [data-cafe="manage"]'), text: document.getElementById('modal-card').textContent, paused: __game.paused }));
check('the Café button walks in and offers a menu: three mini-game modes and "Manage the café"; the city is not paused', menu.modes === 3 && menu.manage && /optional/i.test(menu.text) && !menu.paused, JSON.stringify({ ...menu, text: menu.text.slice(0, 80) }));
// the mini-game is optional: the business keeps its own board
await p.locator('#modal-card [data-cafe="manage"]').click({ force: true }); await p.waitForTimeout(300);
check('"Manage the café" opens the normal café board (no mini-game needed)', await p.evaluate(() => __game.ui.modal === 'cafe'));
await p.evaluate(() => __game.openCafeMenu()); await p.waitForTimeout(300);
await p.locator('#modal-card [data-cafe="mg:quick"]').click({ force: true }); await p.waitForTimeout(500);
const open = await p.evaluate(() => ({ ui: __game.miniGameUI.isOpen, running: __game.cafeMiniGame.running, shown: !document.getElementById('mg').classList.contains('hidden'), mgmt: __game.camera.inManagement || __game.camera.transitioning, hud: getComputedStyle(document.getElementById('hud')).visibility, modal: __game.ui.modal, guests: __game.cafeView.suppressGuests, enabled: __game.player.enabled }));
check('starting a session shows the game screen over the 3D café, hides the HUD, locks walking', open.ui && open.running && open.shown && open.mgmt && open.hud === 'hidden' && open.modal === null && open.guests && !open.enabled, JSON.stringify(open));

// ---- a session
await sim(p, 12);
const cust = await p.evaluate(() => ({ cards: document.querySelectorAll('#mg .mg-c').length, figs: __game.miniGameUI.view.figs.size, shown: __game.miniGameUI.view.group.visible, sprites: __game.miniGameUI.view.group.children.length }));
check('customers appear as ticket cards and as figures in the 3D café', cust.cards >= 1 && cust.figs >= 1 && cust.shown, JSON.stringify(cust));
const first = await p.evaluate(() => __game.cafeMiniGame.session.customers[0]?.id);
// a wrong ingredient is refused with feedback
await clickSel(p, `#mg [data-cid="${first}"]`);
const bad = await p.evaluate(() => { const L = __game.cafeMiniGame; const pid = L.remaining(L.session.customers[0])[0]; return { unneeded: Object.keys(L.k.ingredients).find((r) => !(L.recipes.needs(pid)[r])), pid }; });
await clickSel(p, `#mg [data-ing="${bad.unneeded}"]`); await sim(p, 0.2);
const bad2 = await p.evaluate(() => ({ note: document.getElementById('mg-note').textContent, kind: document.getElementById('mg-note').className, mistakes: __game.cafeMiniGame.session.mistakes, tray: __game.cafeMiniGame.session.build?.tray.length }));
check('a wrong ingredient is refused: message, mistake counted, nothing on the tray', /not needed/i.test(bad2.note) && /bad/.test(bad2.kind) && bad2.mistakes === 1 && bad2.tray === 0, JSON.stringify(bad2));
// cook for real through the UI and serve
const made = await cookViaUI(p, first);
check('the first order can be cooked through the UI (ingredients, machines, pickup counter)', made, '');
const pickup = await p.evaluate(() => ({ n: document.querySelectorAll('#mg .mg-pk').length, view: __game.miniGameUI.view.pickupSprites.filter((s) => s.visible).length }));
await sim(p, 0.3);
check('the finished product sits on the pickup counter in the UI and in the 3D café', pickup.n >= 1, JSON.stringify(pickup));
// serving the wrong customer: add a second customer with a different item
const other = await p.evaluate(() => { const L = __game.cafeMiniGame, s = L.session; const want = L.remaining(s.customers.find((c) => c.id === s.pickup[0]?.cid) || s.customers[0]); const o = s.customers.find((c) => !L.remaining(c).includes(s.pickup[0].pid)); return o ? o.id : null; });
if (other) {
  const sc = await p.evaluate(() => __game.cafeMiniGame.session.score);
  await clickSel(p, `#mg [data-cid="${other}"]`);
  const wrong = await p.evaluate((sc) => ({ wrong: __game.cafeMiniGame.session.wrong, score: __game.cafeMiniGame.session.score, pk: __game.cafeMiniGame.session.pickup.length, sc }), sc);
  check('serving the wrong customer is refused: penalty, product stays on the counter', wrong.wrong === 1 && wrong.score <= sc && wrong.pk >= 1, JSON.stringify(wrong));
}
const owner = await p.evaluate(() => { const L = __game.cafeMiniGame, s = L.session, pk = s.pickup[0]; const c = s.customers.find((x) => L.remaining(x).includes(pk.pid)); return c ? c.id : null; });
await clickSel(p, `#mg [data-cid="${owner}"]`);
const served = await p.evaluate(() => ({ served: __game.cafeMiniGame.session.served, score: __game.cafeMiniGame.session.score, coins: __game.cafeMiniGame.session.coins, scoreText: document.getElementById('mg-score').textContent }));
check('serving the right customer scores points and earns coins (shown on the HUD)', served.served >= 1 && served.score > 0 && served.coins > 0, JSON.stringify(served));
const noMoney = await p.evaluate(() => ({ dayCoins: __game.cafeMiniGame.meta.dayCoins, lifetime: __game.cafeMiniGame.meta.coins, coinsInSession: __game.cafeMiniGame.session.coins }));
check('nothing is paid during the session: coins only accrue, the payout happens once at the end', noMoney.dayCoins === 0 && noMoney.lifetime === 0 && noMoney.coinsInSession > 0, JSON.stringify(noMoney));

// patience: a customer who waits too long walks out (a strike), the 3D figure leaves
await p.evaluate(() => { const s = __game.cafeMiniGame.session; const c = s.customers[s.customers.length - 1]; if (c) c.patience = 0.1; });
await sim(p, 0.5);
check('a customer who runs out of patience walks out: strike counted', await p.evaluate(() => __game.cafeMiniGame.session.strikes >= 1 && __game.cafeMiniGame.session.lost >= 1));

// the café business keeps running by itself while the mini-game is open
const biz = await p.evaluate(() => { const G = __game; const t0 = G.cafe.time; for (let i = 0; i < 100; i++) G.cafe.update(0.1); return { advanced: G.cafe.time - t0, orders: G.cafe.stats.orders }; });
check('the café business simulation keeps running during the mini-game (passive revenue is independent)', biz.advanced > 9, JSON.stringify(biz));

// ---- end of session: results, one capped payout, not revenue
const pre = await p.evaluate(() => ({ cash: __game.economy.cash, rev: __game.economy.totalRevenue }));
await p.evaluate(() => { const s = __game.cafeMiniGame.session; s.left = 0.05; s.spawnTimer = 1e9; });
await sim(p, 0.5); await p.waitForTimeout(300);
const res = await p.evaluate(() => { const r = __game.cafeMiniGame.result, G = __game; return { shown: !document.getElementById('mg-result').classList.contains('hidden'), stars: document.querySelectorAll('#mg-result .mg-stars .on').length, r, cash: G.economy.cash, rev: G.economy.totalRevenue, ledger: { ...G.economy.ledger.revenue }, text: document.getElementById('mg-result').textContent }; });
check('the results screen shows score, stars and the payout', res.shown && res.r.reason === 'time' && /points/.test(res.text) && res.stars === res.r.stars, JSON.stringify({ r: res.r }));
check('the payout is added to city cash once, as a grant: not revenue, not in the ledger', res.r.payout > 0 && Math.abs(res.cash - (pre.cash + res.r.payout)) < 0.01 && res.rev === pre.rev && !('minigame' in res.ledger), JSON.stringify({ cash: res.cash, pre, payout: res.r.payout, rev: res.rev }));
// replay immediately: the cooldown makes it a practice run
await p.locator('#mg [data-mg="again"]').click({ force: true }); await p.waitForTimeout(300);
const again = await p.evaluate(() => ({ running: __game.cafeMiniGame.running, rewarded: __game.cafeMiniGame.session.rewarded, title: document.getElementById('mg-title').textContent, resultHidden: document.getElementById('mg-result').classList.contains('hidden') }));
check('"Play again" starts a new session at once; inside the cooldown it is a practice run (no reward)', again.running && !again.rewarded && /practice/i.test(again.title) && again.resultHidden, JSON.stringify(again));
await p.evaluate(() => { const s = __game.cafeMiniGame.session; s.coins = 50; s.left = 0.05; });
await sim(p, 0.5);
const cashPractice = await p.evaluate(() => ({ cash: __game.economy.cash, r: __game.cafeMiniGame.result }));
check('a practice run pays nothing, however many coins it earned', cashPractice.r.payout === 0 && Math.abs(cashPractice.cash - res.cash) < 0.01, JSON.stringify(cashPractice.r));

// ---- exit: the city is back
await p.locator('#mg [data-mg="exit"]').click({ force: true }); await p.waitForTimeout(500);
const back = await p.evaluate(() => ({ open: __game.miniGameUI.isOpen, hidden: document.getElementById('mg').classList.contains('hidden'), hud: getComputedStyle(document.getElementById('hud')).visibility, inert: document.getElementById('hud').inert, enabled: __game.player.enabled, owner: __game.ownerWork.suspended, guests: __game.cafeView.suppressGuests, state: __game.cafeMiniGame.state, figs: __game.miniGameUI.view.figs.size, stage: __game.progression.stage }));
check('exiting returns to the city: HUD back, walking enabled, real café customers back, no leftovers', !back.open && back.hidden && back.hud === 'visible' && !back.inert && back.enabled && !back.owner && !back.guests && back.state === 'idle' && back.figs === 0 && back.stage === 3, JSON.stringify(back));
await p.evaluate(() => { __game.camera.setMode('third'); });
await p.waitForTimeout(900);
// normal city interaction still works: open a board, click the café button again
await p.evaluate(() => { __game.player.pos.set(17.5, 0.34, -3.5); }); await p.waitForTimeout(800);
await p.evaluate(() => __game.ui.open('finance')); await p.waitForTimeout(300);
check('normal boards still open after the mini-game', await p.evaluate(() => __game.ui.modal === 'finance'));
await p.evaluate(() => __game.ui.closeModal());

// ---- save / load keeps the city intact and remembers the mini-game stats
const saved = await p.evaluate(async () => { const G = __game; await G.save(); const d = G.collect(); return { keys: Object.keys(d.cafeMiniGame).sort(), best: d.cafeMiniGame.best, plays: d.cafeMiniGame.plays, cash: G.economy.cash, stage: G.progression.stage }; });
await p.reload(); await p.waitForFunction(() => window.__game?.miniGameUI, null, { timeout: 90000 }); await p.waitForTimeout(1200);
const loaded = await p.evaluate(() => { const G = __game; return { plays: G.cafeMiniGame.meta.plays, best: G.cafeMiniGame.meta.best, cash: G.economy.cash, stage: G.progression.stage, state: G.cafeMiniGame.state, built: G.cafe.built }; });
check('save/load keeps the city progression and the mini-game stats (and no session is restored)', loaded.plays === saved.plays && JSON.stringify(loaded.best) === JSON.stringify(saved.best) && Math.abs(loaded.cash - saved.cash) < 1 && loaded.stage === 3 && loaded.state === 'idle' && loaded.built && saved.keys.join() === 'best,coins,day,dayCoins,dayPlays,lastEnd,plays,v', JSON.stringify({ saved, loaded }));
// an old save without mini-game data still loads
const oldSave = await p.evaluate(async () => { const G = __game; const d = JSON.parse(JSON.stringify(G.collect())); delete d.cafeMiniGame; await G.saver.save(d); removeEventListener('beforeunload', G.onUnload); removeEventListener('visibilitychange', G.onHide); G.autosave = -1e9; return true; });
await p.reload(); await p.waitForFunction(() => window.__game?.miniGameUI, null, { timeout: 90000 }); await p.waitForTimeout(1000);
check('a save from before the mini-game loads with empty mini-game stats', oldSave && await p.evaluate(() => __game.cafeMiniGame.meta.plays === 0 && __game.cafe.built && __game.progression.stage === 3));
await p.context().close();

// ---- keyboard + leaving mid-game
p = await boot({ width: 1100, height: 680 });
await p.evaluate(() => { __game.startMiniGame('rush'); });
await sim(p, 8);
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
check('Esc asks before leaving a running shift (no pause menu)', await p.evaluate(() => __game.ui.confirmOpen && __game.miniGameUI.isOpen && __game.ui.modal !== 'pause'));
await p.evaluate(() => __game.ui.resolveConfirm(false)); await p.waitForTimeout(200);
check('"Keep playing" keeps the shift running', await p.evaluate(() => __game.cafeMiniGame.running));
await p.evaluate(() => { const L = __game.cafeMiniGame, s = L.session; s.spawnTimer = 1e9; s.customers.length = 0; const t = L.k.customers.regular; const c = { id: 'kx', type: 'regular', label: t.label, icon: t.icon, color: t.color, mult: 1, patience: 99, maxPatience: 99, items: ['espresso'], served: [], spawnedAt: 0 }; s.customers.push(c); L.tapCustomer('kx'); });
await p.keyboard.press('2'); await p.waitForTimeout(150);
const key = await p.evaluate(() => ({ tray: __game.cafeMiniGame.session.build?.tray.map((x) => x.t) || [] }));
check('keyboard shortcut: the number key 2 puts coffee beans on the tray', key.tray.join() === 'beans', JSON.stringify(key));
await p.evaluate(() => __game.miniGameUI.leave()); await p.waitForTimeout(300);
const left = await p.evaluate(() => ({ state: __game.cafeMiniGame.state, plays: __game.cafeMiniGame.meta.plays, cash: __game.economy.cash }));
check('leaving mid-shift ends the session cleanly (counts as a play, pays only what was earned)', left.state === 'idle' && left.plays === 1, JSON.stringify(left));
await p.context().close();

// ---- phone layout
p = await boot({ width: 390, height: 780 }, true);
await p.evaluate(() => { __game.startMiniGame('quick'); });
await sim(p, 14); await p.waitForTimeout(500);
const m = await p.evaluate(() => {
  const r = (e) => e.getBoundingClientRect(), q = (s) => [...document.querySelectorAll(s)].map(r);
  const ing = q('#mg .mg-ing-b'), mach = q('#mg .mg-mach-b'), bench = r(document.querySelector('#mg .mg-bench')), top = r(document.querySelector('#mg .mg-top')), cust = r(document.getElementById('mg-cust'));
  return { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, ingW: Math.min(...ing.map((x) => x.width)), ingH: Math.min(...ing.map((x) => x.height)), machH: Math.min(...mach.map((x) => x.height)), out: [...ing, ...mach].some((x) => x.left < 0 || x.right > innerWidth), benchBottom: bench.bottom, free: bench.top - cust.bottom, quit: r(document.querySelector('#mg [data-mg="quit"]')).height };
});
check('phone: no overflow, tiles are big enough to tap, quit button 44px, the 3D café keeps a visible window', m.sw <= m.vw && !m.out && m.ingW >= 44 && m.ingH >= 44 && m.machH >= 44 && m.quit >= 44 && m.benchBottom <= m.vh && m.free >= 120, JSON.stringify(m));
await p.screenshot({ path: process.env.EVCT_SHOT || 'C:/dev/evct-deps/shots/minigame_mobile.png' });
await p.context().close();

// ---- desktop screenshot mid-game
p = await boot({ width: 1280, height: 720 });
await p.evaluate(() => { __game.startMiniGame('quick'); });
await sim(p, 25); await p.waitForTimeout(800);
await p.evaluate(() => { const L = __game.cafeMiniGame; const c = L.session.customers[0]; if (c) { L.tapCustomer(c.id); const pid = L.remaining(c)[0]; for (const r of Object.keys(L.recipes.needs(pid))) L.addIngredient(r); const m = L.recipes.machinesFor(pid).find((id) => L.recipes.inputsFor(id, L.session.build.tray).ok); if (m) L.tapMachine(m); } __game.miniGameUI.refresh(); });
await sim(p, 0.4); await p.waitForTimeout(500);
await p.screenshot({ path: 'C:/dev/evct-deps/shots/minigame_desktop.png' });
await p.context().close();

console.log(R.join('\n')); console.log('ERRORS:', errs.length ? [...new Set(errs)].join(' | ') : 'none');
await browser.close();
process.exit(R.some((r) => r.startsWith('FAIL')) || errs.length ? 1 : 0);
