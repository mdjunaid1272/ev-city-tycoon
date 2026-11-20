import { chromium } from 'playwright-core';
// Player profile: opens from the top bar / More menu / Pause, edits persist, the outfit reaches the 3D character,
// typing in the name box never walks the player, old saves without a profile load, phones do not overflow.
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const URL = process.env.EVCT_URL || 'http://localhost:5173/';
const boot = async (viewport, touch = false) => {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
  await p.waitForFunction(() => window.__game?.profile, null, { timeout: 90000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { __game.customers.enabled = false; });
  return p;
};

let p = await boot({ width: 1000, height: 640 });
const d0 = await p.evaluate(() => ({ name: __game.profile.name, chip: document.getElementById('v-avatar').textContent, btn: !!document.getElementById('btn-profile') }));
check('default profile and the top-bar avatar button exist', d0.name === 'Player' && d0.btn && d0.chip.length > 0, JSON.stringify(d0));

await p.click('#btn-profile'); await p.waitForTimeout(300);
const open1 = await p.evaluate(() => ({ modal: __game.ui.modal, h2: document.querySelector('#modal-card h2')?.textContent, name: document.getElementById('prof-name')?.value, badges: document.querySelectorAll('.bd').length, avatars: document.querySelectorAll('[data-profile^="avatar:"]').length, outfits: document.querySelectorAll('[data-profile^="outfit:"]').length, paused: __game.paused }));
check('the avatar button opens the Profile board (game keeps running)', open1.modal === 'profile' && open1.h2 === 'Profile' && open1.name === 'Player' && open1.badges === 9 && open1.avatars === 8 && open1.outfits === 6 && !open1.paused, JSON.stringify(open1));

// typing must not move the player and must not close the board
const before = await p.evaluate(() => ({ x: __game.player.pos.x, z: __game.player.pos.z }));
await p.focus('#prof-name'); await p.fill('#prof-name', ''); await p.keyboard.type('wasd Ada <i>', { delay: 20 }); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
const after = await p.evaluate(() => ({ x: __game.player.pos.x, z: __game.player.pos.z, name: __game.profile.name, shown: document.getElementById('prof-name').value, modal: __game.ui.modal, title: document.getElementById('btn-profile').title }));
check('typing a name does not walk the player; the name is cleaned and saved', Math.hypot(after.x - before.x, after.z - before.z) < 0.05 && after.name === 'wasd Ada i' && after.shown === 'wasd Ada i' && after.modal === 'profile' && /wasd Ada i/.test(after.title), JSON.stringify(after));

// an empty name is refused
await p.fill('#prof-name', '   '); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
check('an empty name is refused and the old one is restored', await p.evaluate(() => __game.profile.name === 'wasd Ada i' && document.getElementById('prof-name').value === 'wasd Ada i'));

// avatar + outfit
await p.click('[data-profile="avatar:🦊"]'); await p.waitForTimeout(250);
await p.click('[data-profile="outfit:green"]'); await p.waitForTimeout(250);
const ch = await p.evaluate(() => {
  const G = __game, m = G.player.shirtMeshes[0].material.color.getHex();
  return { avatar: G.profile.avatar, chip: document.getElementById('v-avatar').textContent, on: document.querySelector('.prof-opt.on')?.textContent, outfit: G.profile.outfit, shirt: m, arm: G.player.shirtMeshes[1].material.color.getHex(), hat: G.player.hatMeshes.map((x) => x.material.color.getHex()), sharedUntouched: G.assets.create('character', { shirt: 0x2f8cff, hat: 0xe8483f }).userData.torso.material.color.getHex() };
});
check('avatar and outfit apply to the chip, the board and the 3D character', ch.avatar === '🦊' && ch.chip === '🦊' && ch.on === '🦊' && ch.outfit === 'green' && ch.shirt === 0x35c28a && ch.arm === 0x35c28a && ch.hat.length >= 1 && ch.hat.every((h) => h === 0xffc43d), JSON.stringify(ch));
check('other characters keep their own colours (shared materials untouched)', ch.sharedUntouched === 0x2f8cff, JSON.stringify(ch));

// persistence across a real reload
await p.evaluate(async () => { await __game.save(); });
await p.reload(); await p.waitForFunction(() => window.__game?.profile, null, { timeout: 90000 }); await p.waitForTimeout(1000);
const re = await p.evaluate(() => ({ name: __game.profile.name, avatar: __game.profile.avatar, outfit: __game.profile.outfit, shirt: __game.player.shirtMeshes[0].material.color.getHex(), chip: document.getElementById('v-avatar').textContent, t: __game.profile.playSeconds }));
check('name, avatar and outfit survive a reload (and the outfit is re-applied)', re.name === 'wasd Ada i' && re.avatar === '🦊' && re.outfit === 'green' && re.shirt === 0x35c28a && re.chip === '🦊', JSON.stringify(re));
check('playtime is counted', re.t > 0, JSON.stringify(re));

// More menu + Pause menu entries, and Pause -> Profile -> back
await p.evaluate(() => __game.ui.closeModal());
await p.click('#btn-more'); await p.click('[data-more="profile"]'); await p.waitForTimeout(250);
check('the More menu opens the Profile board', await p.evaluate(() => __game.ui.modal === 'profile'));
await p.evaluate(() => { __game.ui.closeModal(); __game.ui.open('pause'); });
await p.click('[data-pause="profile"]'); await p.waitForTimeout(250);
const viaPause = await p.evaluate(() => ({ modal: __game.ui.modal, paused: __game.paused }));
await p.click('#modal-card [data-close]'); await p.waitForTimeout(250);
const back = await p.evaluate(() => ({ modal: __game.ui.modal, paused: __game.paused }));
check('Pause -> Profile stays paused and closing returns to Pause', viaPause.modal === 'profile' && viaPause.paused && back.modal === 'pause' && back.paused, JSON.stringify({ viaPause, back }));
await p.evaluate(() => __game.ui.closeModal());

// an old save with no profile loads with defaults
const old = await p.evaluate(async () => { const data = JSON.parse(JSON.stringify(__game.collect())); delete data.profile; await __game.saver.save(data); removeEventListener('beforeunload', __game.onUnload); removeEventListener('visibilitychange', __game.onHide); __game.autosave = -1e9; return true; });
await p.reload(); await p.waitForFunction(() => window.__game?.profile, null, { timeout: 90000 }); await p.waitForTimeout(800);
const o = await p.evaluate(() => ({ name: __game.profile.name, avatar: __game.profile.avatar, shirt: __game.player.shirtMeshes[0].material.color.getHex() }));
check('a save from before profiles loads with the default profile', old && o.name === 'Player' && o.shirt === 0x2f8cff, JSON.stringify(o));
await p.context().close();

// phone: the top bar must not overflow and the board must fit
p = await boot({ width: 360, height: 700 }, true);
const mob = await p.evaluate(() => {
  const r = document.getElementById('btn-profile').getBoundingClientRect(), tb = document.getElementById('topbar').getBoundingClientRect();
  return { w: r.width, h: r.height, right: r.right, vw: innerWidth, tbRight: tb.right, sw: document.documentElement.scrollWidth };
});
check('phone: the profile button is a 44px target and the top bar does not overflow', mob.w >= 40 && mob.h >= 40 && mob.right <= mob.vw && mob.sw <= mob.vw, JSON.stringify(mob));
await p.evaluate(() => __game.ui.open('profile')); await p.waitForTimeout(1500);
const card = await p.evaluate(() => { const c = document.getElementById('modal-card').getBoundingClientRect(); return { l: c.left, r: c.right, vw: innerWidth, sw: document.documentElement.scrollWidth }; });
check('phone: the Profile board fits the screen width', card.l >= 0 && card.r <= card.vw + 1 && card.sw <= card.vw, JSON.stringify(card));
await p.screenshot({ path: process.env.EVCT_SHOT || 'C:/dev/evct-deps/shots/profile_mobile.png' });

console.log(R.join('\n')); console.log('ERRORS:', errs.length ? [...new Set(errs)].join(' | ') : 'none');
await browser.close();
process.exit(R.some((r) => r.startsWith('FAIL')) || errs.length ? 1 : 0);
