import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const ctx = await browser.newContext({ viewport: { width: 1200, height: 750 } });
await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
await p.goto((process.env.EVCT_URL || 'http://localhost:5173/')); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
await p.waitForFunction(() => window.__game?.ui, null, { timeout: 90000 }); await p.waitForTimeout(800);
await p.evaluate(() => { const G = __game; G.economy.cash = 900000; G.economy.reputation = 90; G.progression.stage = 4; for (const d of ['residential', 'commercial', 'industrial', 'highway']) G.districts.unlock(d); G.wash.build(); G.garage.build(); G.properties.buy('hub_small'); G.customers.enabled = false; G.player.pos.set(60, 0.34, 60);
  for (const role of ['attendant', 'washer']) { const c = G.employees.makeCandidate(); c.role = role; c.skill = 2; c.cost = 100; G.employees.candidates.push(c); G.employees.hire(c.id); }
  G.camera.setMode('management'); });
await p.waitForFunction(() => __game.camera.inManagement && !__game.camera.transitioning, null, { timeout: 60000 });
const pick = async (getPoint) => { await p.evaluate((src) => { const G = __game; const w = new Function('G', 'return (' + src + ')(G)')(G); G.camera.mg.focus.set(w.x, 0, w.z); }, getPoint); await p.waitForTimeout(700); return p.evaluate((src) => { const G = __game; const f = new Function('G', 'return (' + src + ')(G)'); let w = f(G); G.camera.mg.focus.set(w.x, 0, w.z); for (let i = 0; i < 8; i++) G.camera.update(0.1); G.sm.camera.updateMatrixWorld(true); w = f(G); const T = G.sm.camera.position.constructor; const v = new T(w.x, w.y, w.z).project(G.sm.camera); G.onClick({ x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, button: 0 }); const info = G.ui.selectionFn ? G.ui.selectionFn() : null; return { title: info?.title, rows: info?.rows?.map((r) => r[0]), actions: info?.actions?.map((a) => a.label), outline: !!G.selectionBox, panelHidden: document.getElementById('selection').classList.contains('hidden') }; }, getPoint); };
const st = await pick('(G) => ({ x: -14, y: 2.5, z: -17 })');
check('station building is selectable and shows Level/Status/Capacity/Occupancy/Revenue', /Charging Station/.test(st.title) && ['Level', 'Status', 'Capacity', 'Occupancy', 'Revenue today'].every((k) => st.rows.includes(k)), JSON.stringify(st));
const btns = await p.evaluate(() => [...document.querySelectorAll('#selection [data-a]')].map((b) => b.textContent));
check('station actions are real ones: Manage / Upgrade / Statistics (+ Focus camera)', ['Manage', 'Upgrade', 'Statistics', 'Focus camera'].every((a) => btns.includes(a)), JSON.stringify(btns));
check('selection shows an outline and the panel', st.outline && !st.panelHidden);
// panel clicks never reach the scene
const keep = await p.evaluate(() => { const el = document.getElementById('selection'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return { still: !!__game.ui.selectionFn, target: __game.player.target }; });
check('clicking the panel keeps the selection and does not walk the player', keep.still && !keep.target, JSON.stringify(keep));
// focus camera
const fc = await p.evaluate(() => { __game.camera.mg.focus.set(100, 0, 100); const b = [...document.querySelectorAll('#selection [data-a]')].find((x) => x.textContent === 'Focus camera'); b.click(); return { x: __game.camera.mg.focus.x, z: __game.camera.mg.focus.z }; });
check('Focus camera centres the view on the object', Math.abs(fc.x - -14) < 1 && Math.abs(fc.z - -17) < 1, JSON.stringify(fc));
// Manage opens the board
await p.evaluate(() => [...document.querySelectorAll('#selection [data-a]')].find((x) => x.textContent === 'Manage').click());
check('Manage opens the Station board', await p.evaluate(() => __game.ui.modal === 'station'));
await p.evaluate(() => __game.ui.closeModal());
// wash / garage / hub buildings
for (const [name, getter, label] of [['wash', '(G) => { const o = G.washView.origin; const p = G.washView.W(-8, -21); return { x: p.x, y: 2.5, z: p.z }; }', /Car Wash/], ['garage', '(G) => { const p = G.garageView.W(-8, -21); return { x: p.x, y: 2.5, z: p.z }; }', /Garage/]]) {
  const r = await pick(getter);
  check(`${name} building is selectable with the standard rows`, label.test(r.title || '') && ['Status', 'Capacity', 'Occupancy', 'Revenue'].every((k) => r.rows.includes(k)) && ['Manage', 'Staff', 'Upgrade'].every((a) => r.actions.includes(a)), JSON.stringify(r));
}
// employee panel and clearing
const emp = await p.evaluate(() => { const G = __game, e = G.employees.employees[0]; G.ui.showSelection(() => G.employeeView.info(e)); const info = G.employeeView.info(e); return { title: info.title, actions: info.actions.map((a) => a.label), rows: info.rows.map((r) => r[0]) }; });
check('employee panel: skill training, duty, Staff board, Fire', emp.actions.includes('Send off duty') && emp.actions.includes('Open Staff board') && emp.actions.includes('Fire') && emp.rows.includes('Status'), JSON.stringify(emp));
await p.evaluate(() => { const G = __game; G.employees.fire(G.employees.employees[0].id); });
await p.waitForFunction(() => !__game.ui.selectionFn, null, { timeout: 30000 }).catch(() => {});
check('selected employee fired -> panel clears by itself', await p.evaluate(() => !__game.ui.selectionFn && document.getElementById('selection').classList.contains('hidden') && !__game.selectionBox));
// disabled action explanation
const dz = await p.evaluate(() => { const G = __game; G.economy.cash = 0; G.ui.clearSelection(); G.ui.showSelection(() => G.stationView.bayInfo(3)); G.station.bays[3].unlocked = false; G.ui._selKey = null; G.ui.refreshSelection(); return { why: document.querySelector('#selection .sel-why')?.textContent, disabled: !!document.querySelector('#selection [data-a][disabled]') }; });
check('disabled action explains why', dz.disabled && /Not enough cash/.test(dz.why || ''), JSON.stringify(dz));
// click empty ground clears
await p.evaluate(() => { __game.onClick({ x: 5, y: 400, button: 0 }); });
check('clicking empty ground clears selection and outline', await p.evaluate(() => !__game.ui.selectionFn && !__game.selectionBox));
console.log(R.join('\n')); console.log('ERRORS:', [...new Set(errs)].join('|') || 'none');
await browser.close();






