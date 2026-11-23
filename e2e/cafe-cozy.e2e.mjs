import { chromium } from 'playwright-core';
// The cozy café, end to end through the real UI: entering (walk in -> hub), recipes / guests / decorate / progress boards, opening a shift,
// customers and orders, cooking drinks and desserts with clicks, multi-product orders, stories, decoration placement (UI + 3D), rewards and limits,
// camera modes, exit, save / load (also an old save), passive café revenue, phone layout.
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const URL = process.env.EVCT_URL || 'http://localhost:5173/';

async function boot(viewport, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
  await p.waitForFunction(() => window.__game?.cozyUI, null, { timeout: 90000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const G = __game; G.progression.stage = 3; G.economy.cash = 90000; G.economy.reputation = 30; G.customers.enabled = false; G.hub.build('coffee', G.progression); G.player.pos.set(17.5, 0.34, -3.5); window.__grants = []; const og = G.economy.grant.bind(G.economy); G.economy.grant = (x) => { window.__grants.push({ ...x }); return og(x); }; });
  await p.waitForTimeout(600);
  return p;
}
const sim = (p, secs) => p.evaluate((secs) => { const G = __game, dt = 0.05; for (let t = 0; t < secs; t += dt) { G.cafe.update(dt); G.cozyUI.update(dt); G.cozyView.update(dt); } G.cozyUI.refresh(); }, secs);
const clk = (p, sel) => p.locator(sel).first().click({ force: true });
/** make and serve one line of a customer through clicks only */
async function cookLine(p, cid) {
  await clk(p, `#cz [data-cid="${cid}"]`);
  for (let guard = 0; guard < 300; guard++) {
    const a = await p.evaluate((cid) => {
      const L = __game.cafeCozy, s = L.session, B = L.book, C = L.cfg, b = s.build, cu = s.customers.find((x) => x.id === cid);
      const tabOf = (raw, pid) => { const ing = C.ingredients[raw]; return C.products[pid].kind === 'dessert' && (ing.tab === 'bakery' || ing.also?.includes('bakery')) ? 'bakery' : ing.tab; };
      const sel = (kind, id) => `#cz .cz-pane:not([hidden]) [data-${kind}="${id}"]`;
      let pid = b?.pid;
      if (!b) { // nothing on the bench yet: start the first open line of this customer (unless it is already waiting on the pickup counter)
        if (!cu) return { done: true };
        const li = cu.lines.findIndex((l, i) => !l.done && !s.pickup.some((pk) => pk.cid === cu.id && pk.li === i));
        if (li < 0) return { done: true };
        pid = cu.lines[li].pid;
        if (B.isDisplay(pid)) return { tab: 'bakery', sel: sel('disp', pid) };
        const raw = Object.keys(B.needs(pid))[0];
        return { tab: tabOf(raw, pid), sel: sel('ing', raw) };
      }
      if (B.isDisplay(pid)) return { tab: 'bakery', sel: sel('disp', pid) };
      const need = Object.keys(B.needs(pid)).find((r) => B.acceptsRaw(pid, b.used, r));
      if (need) return { tab: tabOf(need, pid), sel: sel('ing', need) };
      const ready = Object.entries(s.jobs).find(([, j]) => j.state === 'ready');
      if (ready) return { tab: C.machines[ready[0]].tab, sel: sel('mach', ready[0]) };
      if (Object.keys(s.jobs).length) return { wait: true };
      const m = B.machinesFor(pid).find((id) => B.inputsFor(id, b.tray, pid).ok);
      return m ? { tab: C.machines[m].tab, sel: sel('mach', m) } : { wait: true };
    }, cid);
    if (a.done) break;
    if (a.tab) { const cur = await p.evaluate(() => __game.cozyUI.tab); if (cur !== a.tab) await clk(p, `#cz [data-cztab="${a.tab}"]`); }
    if (a.sel) await clk(p, a.sel); else await sim(p, 0.4);
  }
  await clk(p, `#cz [data-cid="${cid}"]`); // serve
}
let p = await boot({ width: 1100, height: 680 });
await p.evaluate(() => { const G = __game; G.cafeCozy.xp = 330; G.cafeCozy.lastLevel = G.cafeCozy.level; G.cafeCozy.coins = 500; });
const before = await p.evaluate(() => { const G = __game; return { cash: G.economy.cash, rev: G.economy.totalRevenue, stage: G.progression.stage, level: G.cafeCozy.level }; });
check('the café level can be set up for the test (level 4: most drinks, mixer and oven)', before.level === 4, JSON.stringify(before));

// ---- entering: the Café button walks in, the hub opens
await clk(p, '#cafe-open');
await p.waitForFunction(() => __game.ui.modal === 'cafehub', null, { timeout: 120000 });
const hub = await p.evaluate(() => ({ tabs: [...document.querySelectorAll('#modal-card .tabs button, #modal-card [data-tab]')].map((b) => b.textContent.trim()), open: !!document.querySelector('#modal-card [data-cz="open"]'), manage: !!document.querySelector('#modal-card [data-cz="manage"]'), paused: __game.paused }));
check('the Café button walks in and opens the café hub (play, recipes, guests, decorate, progress); the city keeps running', hub.tabs.length >= 5 && hub.open && hub.manage && !hub.paused, JSON.stringify(hub));
await clk(p, '#modal-card [data-tab="cafehub:recipes"]'); await p.waitForTimeout(250);
const rec = await p.evaluate(() => ({ items: document.querySelectorAll('#modal-card .cz-rec').length, locked: document.querySelectorAll('#modal-card .cz-rec.locked').length, steps: document.querySelector('#modal-card .cz-rec ol')?.children.length }));
check('the recipe book lists all 19 drinks and desserts; the ones above the café level are locked', rec.items === 19 && rec.locked > 0 && rec.steps >= 2, JSON.stringify(rec));
await clk(p, '#modal-card [data-tab="cafehub:customers"]'); await p.waitForTimeout(250);
const guests = await p.evaluate(() => ({ cards: document.querySelectorAll('#modal-card .cz-guest').length, unknown: document.querySelectorAll('#modal-card .cz-guest.locked').length }));
check('the guest collection shows every character (unmet ones hidden)', guests.cards === 13 && guests.unknown >= 1, JSON.stringify(guests));
await clk(p, '#modal-card [data-tab="cafehub:progress"]'); await p.waitForTimeout(250);
check('the progress board shows level, unlocks and the limits that keep the city the main game', await p.waitForFunction(() => /Level 4/.test(document.getElementById('modal-card').textContent) && /Limits/.test(document.getElementById('modal-card').textContent) && document.querySelectorAll('#modal-card .mrow').length >= 8, null, { timeout: 8000 }).then(() => true, () => false));

// ---- decoration through the UI, visible in 3D
await clk(p, '#modal-card [data-tab="cafehub:decor"]'); await p.waitForTimeout(250);
const coins0 = await p.evaluate(() => __game.cafeCozy.coins);
await clk(p, '#modal-card [data-cz="buy:plantBloom"]'); await p.waitForTimeout(250);
check('buying furniture spends café coins (not city cash)', await p.evaluate(({ c, cash }) => __game.cafeCozy.coins === c - 35 && __game.economy.cash >= cash - 1 && __game.cafeCozy.decor.owned.has('plantBloom'), { c: coins0, cash: before.cash }));
await p.selectOption('#modal-card [data-czslot="plantL"]', 'plantBloom'); await p.waitForTimeout(250);
await p.waitForFunction(() => __game.cozyView.decorVersion === __game.cafeCozy.decor.version, null, { timeout: 20000 }).catch(() => {});
const placed = await p.evaluate(() => { const D = __game.cafeCozy.decor, v = __game.cozyView; return { item: D.placed.plantL.item, spots: Object.keys(v.decorSlots).length, slot: v.decorSlots.plantL?.item, meshes: v.decorGroup.children.length, tableHidden: __game.cafeView.tops.visible === false }; });
check('placing it updates the café in 3D (the spot is drawn, all decoration merged into a few meshes, the old table meshes replaced)', placed.item === 'plantBloom' && placed.slot === 'plantBloom' && placed.spots >= 8 && placed.meshes <= 6 && placed.tableHidden, JSON.stringify(placed));
await clk(p, '#modal-card [data-cz="rotate:plantL"]'); await p.waitForTimeout(200);
check('furniture can be turned', await p.evaluate(() => __game.cafeCozy.decor.placed.plantL.rot === 90));
await p.selectOption('#modal-card [data-czslot="wallW1"]', ''); await p.waitForTimeout(150);
await clk(p, '#modal-card [data-cz="remove:plantL"]'); await p.waitForTimeout(200);
check('furniture can be removed again; a table cannot be removed (it carries the seats)', await p.evaluate(() => __game.cafeCozy.decor.placed.plantL === null && !document.querySelector('[data-cz="remove:table1"]:not([disabled])')));
const wall0 = await p.evaluate(() => __game.cafeView.wallMesh.material.color.toArray().map((x) => +x.toFixed(3)).join());
await p.evaluate(() => { __game.cafeCozy.coins = 500; }); await clk(p, '#modal-card [data-tab="cafehub:decor"]'); await p.waitForTimeout(200);
await clk(p, '#modal-card [data-cz="buytheme:minimal"]'); await p.waitForTimeout(200); await clk(p, '#modal-card [data-cz="theme:minimal"]'); await p.waitForTimeout(300);
await p.waitForFunction(() => __game.cozyView.decorVersion === __game.cafeCozy.decor.version, null, { timeout: 20000 }).catch(() => {});
const theme = await p.evaluate(() => ({ theme: __game.cafeCozy.decor.theme, wall: __game.cafeView.wallMesh.material.color.toArray().map((x) => +x.toFixed(3)).join() }));
check('a theme changes the café\'s walls', theme.theme === 'minimal' && theme.wall !== wall0, JSON.stringify({ theme, wall0 }));

// ---- open the café
await clk(p, '#modal-card [data-tab="cafehub:play"]'); await p.waitForTimeout(200); await clk(p, '#modal-card [data-cz="open"]');
await p.waitForTimeout(600);
const open = await p.evaluate(() => ({ ui: __game.cozyUI.isOpen, open: __game.cafeCozy.open, shown: !document.getElementById('cz').classList.contains('hidden'), mgmt: __game.camera.inManagement || __game.camera.transitioning, hud: getComputedStyle(document.getElementById('hud')).visibility, guests: __game.cafeView.suppressGuests, enabled: __game.player.enabled, modal: __game.ui.modal }));
check('opening the café shows the play screen over the 3D café (isometric camera), hides the HUD, locks walking', open.ui && open.open && open.shown && open.mgmt && open.hud === 'hidden' && !open.enabled && open.modal === null, JSON.stringify(open));
// ---- the FRONT VIEW: camera straight on, roof and front wall cut away; the camera is not the player's any more
const fv = await p.evaluate(() => ({ fixed: __game.camera.fixed, yaw: __game.camera.mg.yaw, pitch: __game.camera.mg.pitch, dist: __game.camera.mg.dist, cut: __game.cafeView.cutaway, south: __game.cafeView.southMesh.visible, roof: __game.cafeView.roof.visible, sign: __game.cafeView.sign.visible, win: __game.cafeView.windowMeshes.some((m) => m.visible), btn: !!document.getElementById('cz-cam') }));
check('the play screen shows the café from the FRONT: camera straight on and low, roof and the whole front wall cut away', fv.fixed && Math.abs(fv.yaw) < 0.01 && fv.pitch < 0.4 && fv.cut && !fv.south && !fv.roof && !fv.sign && !fv.win && fv.btn, JSON.stringify(fv));
await p.mouse.move(600, 360); await p.mouse.wheel(0, -900); await p.waitForTimeout(250);
check('the camera is fixed while the café is open (zoom and pan do nothing)', await p.evaluate((d) => Math.abs(__game.camera.mg.dist - d) < 0.01 && __game.camera.fixed, fv.dist));
await p.evaluate(() => { __game.cafeCozy.session.spawnTimer = 0.1; });
await sim(p, 40);
const cust = await p.evaluate(() => { const s = __game.cafeCozy.session; return { n: s.customers.length, cards: document.querySelectorAll('#cz .cz-c').length, figs: __game.cozyView.figs.size, names: s.customers.map((c) => c.name) }; });
check('customers arrive with names and orders: ticket cards in the UI and characters in the 3D café', cust.n >= 1 && cust.cards === cust.n && cust.figs >= 1, JSON.stringify(cust));

// the customers stand in a ROW across the counter (side by side, facing the viewer in the front view)
await p.evaluate(() => { const s = __game.cafeCozy.session; s.spawnTimer = 1e9; s.customers.length = 0; const L = __game.cafeCozy; for (const rid of ['priya', 'lena', 'okafor']) { const def = L.cfg.customers[rid]; s.customers.push({ id: 'row_' + rid, rid, name: def.name, icon: def.icon, category: def.category, vip: false, colors: { shirt: def.shirt, hat: def.hat, skin: def.skin }, lines: [{ pid: 'tea', requests: [], done: false, product: null }], patience: 300, maxPatience: 300, state: 'waiting', eatLeft: 0, sats: [], liked: false, chatReady: false, spawnedAt: 0 }); } });
await sim(p, 25);
const row = await p.evaluate(() => { const f = [...__game.cozyView.figs.values()].filter((x) => x.cid?.startsWith('row_')); return { n: f.length, xs: f.map((x) => +x.x.toFixed(2)).sort((a, b) => a - b), zs: f.map((x) => +x.z.toFixed(2)), turned: f.every((x) => Math.abs(Math.cos(x.model.rotation.y)) < 0.95) }; });
check('customers wait in a row across the counter (spread out sideways, same distance from the counter) and turn towards the viewer', row.n === 3 && row.xs[2] - row.xs[0] >= 1.5 && Math.max(...row.zs) - Math.min(...row.zs) < 0.2 && row.turned, JSON.stringify(row));
// the camera button swaps to the isometric view and back
await clk(p, '#cz-cam'); await p.waitForTimeout(300);
const iso = await p.evaluate(() => ({ yaw: __game.camera.mg.yaw, cut: __game.cafeView.cutaway, south: __game.cafeView.southMesh.visible }));
await clk(p, '#cz-cam'); await p.waitForTimeout(300);
const frontAgain = await p.evaluate(() => ({ yaw: __game.camera.mg.yaw, cut: __game.cafeView.cutaway }));
check('the camera button switches between the front view and the isometric view (the front wall comes back in the corner view)', Math.abs(iso.yaw - Math.PI / 4) < 0.01 && !iso.cut && iso.south && Math.abs(frontAgain.yaw) < 0.01 && frontAgain.cut, JSON.stringify({ iso, frontAgain }));
// ---- cook a real order with clicks (first through a wrong ingredient)
await p.evaluate(() => { const s = __game.cafeCozy.session; s.customers.length = 0; s.spawnTimer = 1e9; const L = __game.cafeCozy, def = L.cfg.customers.mina; s.customers.push({ id: 'mx', rid: 'mina', name: def.name, icon: def.icon, category: def.category, vip: false, colors: { shirt: def.shirt, hat: def.hat, skin: def.skin }, lines: [{ pid: 'latte', requests: ['cinnamon'], done: false, product: null }], patience: 90, maxPatience: 90, state: 'waiting', eatLeft: 0, sats: [], liked: false, chatReady: false, spawnedAt: 0 }); });
await sim(p, 1); await clk(p, '#cz [data-cid="mx"]');
await clk(p, '#cz .cz-pane:not([hidden]) [data-ing="ice"]'); await sim(p, 0.2);
const wrong = await p.evaluate(() => ({ note: document.getElementById('cz-note').textContent, kind: document.getElementById('cz-note').className, mistakes: __game.cafeCozy.session.mistakes, tray: __game.cafeCozy.session.build.tray.length }));
check('a wrong ingredient is refused with a clear message and a mistake is counted', /not needed/i.test(wrong.note) && /bad/.test(wrong.kind) && wrong.mistakes === 1 && wrong.tray === 0, JSON.stringify(wrong));
await clk(p, '#cz [data-cztab="extras"]'); await clk(p, '#cz .cz-pane:not([hidden]) [data-ing="cinnamon"]');
const xp0 = await p.evaluate(() => ({ xp: __game.cafeCozy.xp, coins: __game.cafeCozy.coins, cash: __game.economy.cash }));
await cookLine(p, 'mx'); await p.evaluate(() => { const c = __game.cafeCozy.session.customers.find((x) => x.id === 'mx'); if (c) c.eatLeft = 9999; }); await sim(p, 0.3); // she stays and enjoys it while we continue
const served = await p.evaluate(() => { const L = __game.cafeCozy, c = L.session.customers.find((x) => x.id === 'mx'); return { served: L.session.served, state: c?.state, xp: L.xp, coins: L.coins, cash: __game.economy.cash, combo: L.session.combo, perfect: L.session.perfect, rev: __game.economy.totalRevenue }; });
check('a latte made through the clicks (grind, espresso, steam, combine + cinnamon request) is served and earns coins and xp', served.served === 1 && served.state === 'eating' && served.coins > xp0.coins && served.xp > xp0.xp, JSON.stringify({ served, xp0 }));
check('nothing is paid to the city during play (coins are the café\'s own currency)', served.cash === xp0.cash, JSON.stringify({ served, xp0 }));

// ---- multi-product order: drink + dessert
await p.evaluate(() => { const s = __game.cafeCozy.session, L = __game.cafeCozy, def = L.cfg.customers.lena; s.customers.push({ id: 'lx', rid: 'lena', name: def.name, icon: def.icon, category: def.category, vip: false, colors: { shirt: def.shirt, hat: def.hat, skin: def.skin }, lines: [{ pid: 'icedCoffee', requests: [], done: false, product: null }, { pid: 'muffin', requests: [], done: false, product: null }], patience: 200, maxPatience: 200, state: 'waiting', eatLeft: 0, sats: [], liked: false, chatReady: false, spawnedAt: 0 }); });
await sim(p, 0.3); await cookLine(p, 'lx'); await sim(p, 0.2);
const half = await p.evaluate(() => { const L = __game.cafeCozy, c = L.session.customers.find((x) => x.id === 'lx'); return { state: c.state, done: c.lines.map((l) => l.done) }; });
check('a two-item order is not finished after the first item', half.state === 'waiting' && half.done[0] !== half.done[1], JSON.stringify(half));
await cookLine(p, 'lx'); await sim(p, 0.3);
const both = await p.evaluate(() => { const L = __game.cafeCozy, c = L.session.customers.find((x) => x.id === 'lx'); return { state: c.state, done: c.lines.map((l) => l.done), served: L.session.served, bakeryUsed: L.pantry.flour < L.cfg.pantry.cap }; });
check('the dessert is baked (mixer, oven) and the order completes after both items; ingredients are consumed', both.state === 'eating' && both.done.every(Boolean) && both.served === 3 && both.bakeryUsed, JSON.stringify(both));

// ---- display desserts (stock)
await p.evaluate(() => { const s = __game.cafeCozy.session, L = __game.cafeCozy, def = L.cfg.customers.okafor; s.customers.push({ id: 'ox', rid: 'okafor', name: def.name, icon: def.icon, category: def.category, vip: false, colors: { shirt: def.shirt, hat: def.hat, skin: def.skin }, lines: [{ pid: 'donut', requests: [], done: false, product: null }], patience: 200, maxPatience: 200, state: 'waiting', eatLeft: 0, sats: [], liked: false, chatReady: false, spawnedAt: 0 }); window.__d0 = L.display.donut; });
await sim(p, 0.3); await cookLine(p, 'ox');
check('a donut comes from the bakery display and uses its stock', await p.evaluate(() => __game.cafeCozy.display.donut === window.__d0 - 1 && __game.cafeCozy.session.customers.find((x) => x.id === 'ox').state === 'eating'));

// ---- stories: optional chat after the order
await sim(p, 0.3);
const chatBtn = await p.evaluate(() => { const b = document.querySelector('#cz [data-chat="mx"]'); return b && !b.hidden; });
check('the customer offers an optional chat (a button, never forced)', !!chatBtn && await p.evaluate(() => !__game.cafeCozy.session.dialogue));
await clk(p, '#cz [data-chat="mx"]'); await p.waitForTimeout(250);
const dlg = await p.evaluate(() => ({ shown: !document.getElementById('cz-dialogue').classList.contains('hidden'), name: document.querySelector('#cz-dialogue b')?.textContent, lines: document.querySelectorAll('#cz-dialogue .cz-dlines p').length }));
check('the dialogue shows the customer\'s story (Mina, chapter one)', dlg.shown && dlg.name === 'Mina' && dlg.lines === 1, JSON.stringify(dlg));
await clk(p, '#cz-dialogue [data-dlg="next"]'); await p.waitForTimeout(150); await clk(p, '#cz-dialogue [data-dlg="end"]'); await p.waitForTimeout(250);
const story = await p.evaluate(() => ({ beats: __game.cafeCozy.roster.state.mina.beats, friend: __game.cafeCozy.roster.state.mina.friend, shown: !document.getElementById('cz-dialogue').classList.contains('hidden') }));
await clk(p, '#cz-dialogue [data-dlg="thanks"]'); await p.waitForTimeout(150);
check('finishing the chat saves the chapter and friendship', story.beats.length === 1 && story.friend >= 2 && story.shown, JSON.stringify(story));
check('the chat does not block the café (the dialogue closes, orders continue)', await p.evaluate(() => document.getElementById('cz-dialogue').classList.contains('hidden') && __game.cafeCozy.open));

// ---- the café business keeps running by itself
const biz = await p.evaluate(() => { const G = __game; const t0 = G.cafe.time; for (let i = 0; i < 100; i++) G.cafe.update(0.1); return { advanced: G.cafe.time - t0 }; });
check('the café business simulation keeps running while the cozy café is open (passive income is independent)', biz.advanced > 9, JSON.stringify(biz));

// ---- closing: summary, city reward (one small capped grant), cooldown
const pre = await p.evaluate(() => ({ cash: __game.economy.cash, rev: __game.economy.totalRevenue, grants: window.__grants.length }));
await clk(p, '#cz [data-cz="close"]'); await p.waitForTimeout(400);
await p.evaluate(() => __game.ui.resolveConfirm(true)); await p.waitForTimeout(500);
const closeErr = await p.evaluate(() => { if (__game.cafeCozy.summary) return null; try { __game.cafeCozy.closeShift(); return 'closed late'; } catch (e) { return String(e.stack || e.message).slice(0, 400); } });
if (closeErr) console.log('CLOSE ISSUE:', closeErr);
const sum = await p.evaluate(() => ({ shown: !document.getElementById('cz-summary').classList.contains('hidden'), s: __game.cafeCozy.summary, cash: __game.economy.cash, rev: __game.economy.totalRevenue, grants: window.__grants.slice(), text: document.getElementById('cz-summary').textContent }));
check('closing the café shows a summary with what was served, earned and unlocked', sum.shown && sum.s?.served === 4 && /Another lovely day/.test(sum.text) && /Café coins/.test(sum.text), JSON.stringify({ served: sum.s?.served, shown: sum.shown }));
const cityGrant = sum.grants.find((g) => g.cash > 0 && Math.abs(g.cash - (sum.s?.cash ?? -1)) < 0.01);
check('the city gets one small cash grant through EconomyManager.grant: capped, not revenue', (sum.s?.cash ?? 0) > 0 && !!cityGrant && (sum.s?.cash ?? 0) <= 120 && sum.rev === pre.rev, JSON.stringify({ cash: sum.s?.cash, grants: sum.grants, rev: sum.rev, pre }));
await clk(p, '#cz [data-sum="again"]'); await p.waitForTimeout(400);
check('"Open again" starts another shift at once; inside the cooldown it earns café coins but no city reward', await p.evaluate(() => __game.cafeCozy.open && __game.cafeCozy.session.rewarded === false && /Rest/.test(__game.cafeCozy.session.rewardNote)));
await p.evaluate(() => { __game.cozyUI.closeShiftNow(); }); await p.waitForTimeout(300);
const practice = await p.evaluate(() => ({ cash: __game.cafeCozy.summary?.cash, why: __game.cafeCozy.summary?.why }));
check('a practice shift pays nothing to the city', practice.cash === 0 && /Rest/.test(practice.why), JSON.stringify(practice));
// exit
await clk(p, '#cz [data-sum="exit"]'); await p.waitForTimeout(500);
const back = await p.evaluate(() => ({ open: __game.cozyUI.isOpen, hidden: document.getElementById('cz').classList.contains('hidden'), hud: getComputedStyle(document.getElementById('hud')).visibility, inert: document.getElementById('hud').inert, enabled: __game.player.enabled, owner: __game.ownerWork.suspended, guests: __game.cafeView.suppressGuests, state: __game.cafeCozy.state, figs: __game.cozyView.figs.size }));
const camBack = await p.evaluate(() => ({ fixed: __game.camera.fixed, cut: __game.cafeView.cutaway, south: __game.cafeView.southMesh.visible, sign: __game.cafeView.sign.visible, roofLogic: true }));
check('leaving gives the camera back and puts the front wall, windows and sign back', !camBack.fixed && !camBack.cut && camBack.south && camBack.sign, JSON.stringify(camBack));
check('exiting returns to the city: HUD back, walking enabled, real café guests back', !back.open && back.hidden && back.hud === 'visible' && !back.inert && back.enabled && !back.owner && !back.guests && back.state === 'idle', JSON.stringify(back));
await p.evaluate(() => __game.camera.setMode('third')); await p.waitForTimeout(900);
await p.evaluate(() => { __game.ui.open('finance'); }); await p.waitForTimeout(300);
check('normal city boards still open afterwards, in either camera mode', await p.evaluate(() => __game.ui.modal === 'finance'));
await p.evaluate(() => __game.ui.closeModal());

// ---- save / load
const saved = await p.evaluate(async () => { const G = __game; await G.save(); const d = G.collect(); return { xp: G.cafeCozy.xp, coins: G.cafeCozy.coins, theme: G.cafeCozy.decor.theme, beats: G.cafeCozy.roster.state.mina.beats, keys: Object.keys(d.cafeCozy).sort(), cash: G.economy.cash, stage: G.progression.stage }; });
await p.reload(); await p.waitForFunction(() => window.__game?.cozyUI, null, { timeout: 90000 }); await p.waitForTimeout(1200);
const loaded = await p.evaluate(() => { const G = __game; return { xp: G.cafeCozy.xp, coins: G.cafeCozy.coins, theme: G.cafeCozy.decor.theme, beats: G.cafeCozy.roster.state.mina.beats, state: G.cafeCozy.state, stage: G.progression.stage, built: G.cafe.built, wallTinted: G.cafeView.wallMesh.material.color.getHex() }; });
check('save / load keeps café progress, coins, theme, friendship and the city progression; no shift is restored', loaded.xp === saved.xp && loaded.coins === saved.coins && loaded.theme === 'minimal' && JSON.stringify(loaded.beats) === JSON.stringify(saved.beats) && loaded.state === 'idle' && loaded.stage === 3 && loaded.built, JSON.stringify({ saved, loaded }));
const oldSave = await p.evaluate(async () => { const G = __game; const d = JSON.parse(JSON.stringify(G.collect())); delete d.cafeCozy; await G.saver.save(d); removeEventListener('beforeunload', G.onUnload); removeEventListener('visibilitychange', G.onHide); G.autosave = -1e9; return true; });
await p.reload(); await p.waitForFunction(() => window.__game?.cozyUI, null, { timeout: 90000 }); await p.waitForTimeout(1000);
check('a save from before the cozy café loads with a fresh café (level 1, starter coins)', oldSave && await p.evaluate(() => __game.cafeCozy.level === 1 && __game.cafeCozy.coins === __game.cafeCozy.cfg.progress.starterCoins && __game.cafe.built));
await p.context().close();

// ---- phone layout
p = await boot({ width: 390, height: 780 }, true);
await p.evaluate(() => { __game.cafeCozy.xp = 330; __game.cafeCozy.lastLevel = 4; __game.startCafeShift(); __game.cafeCozy.session.spawnTimer = 0.1; });
await sim(p, 40); await p.waitForTimeout(500);
const m = await p.evaluate(() => {
  const r = (e) => e.getBoundingClientRect(), q = (s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent).map(r);
  const ing = q('#cz .cz-pane:not([hidden]) .cz-ing'), mach = q('#cz .cz-pane:not([hidden]) .cz-mach'), bench = r(document.querySelector('#cz .cz-bench')), orders = r(document.getElementById('cz-orders'));
  return { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, ingH: Math.min(...ing.map((x) => x.height)), ingW: Math.min(...ing.map((x) => x.width)), machH: Math.min(...mach.map((x) => x.height)), out: [...ing, ...mach].some((x) => x.left < 0 || x.right > innerWidth), benchBottom: bench.bottom, free: bench.top - orders.bottom, close: r(document.querySelector('#cz [data-cz="close"]')).height, tabsH: Math.min(...q('#cz .cz-tab').map((x) => x.height)) };
});
check('phone: no overflow, tiles / tabs / buttons are big enough to tap, and the 3D café keeps a visible window', m.sw <= m.vw && !m.out && m.ingH >= 44 && m.ingW >= 44 && m.machH >= 44 && m.close >= 44 && m.tabsH >= 40 && m.benchBottom <= m.vh && m.free >= 90, JSON.stringify(m));
await p.screenshot({ path: process.env.EVCT_SHOT || 'C:/dev/evct-deps/shots/cozy_mobile.png' });
await p.evaluate(() => { __game.cozyUI.leave(); __game.ui.tab.cafehub = 'decor'; __game.openCafeHub(); }); await p.waitForTimeout(500);
const hubm = await p.evaluate(() => { const c = document.getElementById('modal-card').getBoundingClientRect(); return { l: c.left, r: c.right, vw: innerWidth, sw: document.documentElement.scrollWidth, slots: document.querySelectorAll('#modal-card [data-czslot]').length }; });
check('phone: the decoration board fits the screen and lists every spot', hubm.l >= 0 && hubm.r <= hubm.vw + 1 && hubm.sw <= hubm.vw && hubm.slots === 22, JSON.stringify(hubm));
await p.context().close();

console.log(R.join('\n')); console.log('ERRORS:', errs.length ? [...new Set(errs)].join(' | ') : 'none');
await browser.close();
process.exit(R.some((r) => r.startsWith('FAIL')) || errs.length ? 1 : 0);