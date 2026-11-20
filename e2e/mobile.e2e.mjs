import { chromium } from 'playwright-core';
// Phone-sized touch device: every board must fit the screen (no sideways scrolling) and every control must be a comfortable touch target.
const browser = await chromium.launch({ executablePath: process.env.EVCT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = [], errs = [];
const check = (n, ok, e = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n} ${e}`);
const VIEWPORTS = [{ w: 360, h: 640 }, { w: 412, h: 915 }];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { window.__NO_TUTORIAL = true; try { localStorage.setItem('evct.settings.v1', JSON.stringify({ quality: 'low' })); } catch (e) {} });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(process.env.EVCT_URL || 'http://localhost:5173/'); await p.evaluate(() => indexedDB.deleteDatabase('ev-city-tycoon')); await p.reload();
  await p.waitForFunction(() => window.__game?.cafe, null, { timeout: 90000 }); await p.waitForTimeout(1000);
  await p.evaluate(() => {
    const G = __game; G.economy.cash = 500000; G.economy.reputation = 60; G.progression.stage = 4; G.customers.enabled = false; G.player.pos.set(60, 0.34, 60);
    for (const d of ['residential', 'commercial', 'industrial', 'highway']) G.districts.unlock(d);
    G.wash.build(); G.garage.build(); G.properties.buy('hub_small'); G.hub.build('coffee', G.progression);
    const c = G.employees.makeCandidate(); c.role = 'barista'; c.skill = 3; c.cost = 100; G.employees.candidates.push(c); G.employees.hire(c.id);
    for (let i = 0; i < 600; i++) { G.cafe.update(0.1); G.employees.update(0.1); } // some orders / stats so the boards have content
  });
  const boards = [['business', 'overview'], ['business', 'upgrades'], ['business', 'contracts'], ['staff'], ['finance'], ['missions', 'main'], ['missions', 'daily'], ['stats'], ['map'], ['station'], ['wash'], ['garage'], ['hub_small'], ['cafe', 'overview'], ['cafe', 'menu'], ['cafe', 'stock'], ['cafe', 'upgrades'], ['cafe', 'stats'], ['settings'], ['help'], ['save']];
  const bad = [];
  for (const [name, tab] of boards) {
    const r = await p.evaluate(async ([name, tab]) => {
      const ui = __game.ui; ui.closeModal();
      if (tab) ui.tab[name] = tab;
      ui.open(name); await new Promise((r) => setTimeout(r, 450));
      const card = document.getElementById('modal-card');
      const vw = innerWidth, out = [];
      const overflow = card.scrollWidth - card.clientWidth;
      for (const el of card.querySelectorAll('*')) {
        if (el.closest('.tabs')) continue; // tab strips scroll sideways on purpose
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if (r.right > vw + 1 || r.left < -1) out.push(`${el.tagName}.${(el.className || '').toString().slice(0, 18)} right=${Math.round(r.right)}`);
      }
      const small = [];
      for (const b of card.querySelectorAll('button')) {
        if (b.disabled) continue; const r = b.getBoundingClientRect(); if (!r.width) continue;
        if (r.height < 36 || r.width < 36) small.push(`${(b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 14)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return { overflow, out: out.slice(0, 3), small: [...new Set(small)].slice(0, 4) };
    }, [name, tab]);
    if (r.overflow > 1 || r.out.length || r.small.length) bad.push(`${name}${tab ? ':' + tab : ''} ${JSON.stringify(r)}`);
  }
  check(`${vp.w}x${vp.h}: every board fits the screen and every button is at least 36px (touch)`, bad.length === 0, bad.join(' | '));
  // floating buttons and HUD
  await p.evaluate(() => { __game.ui.closeModal(); __game.player.pos.set(17.5, 0.34, -9.5); __game.camera.tp.smooth.set(17.5, 1.6, -9.5); });
  await p.waitForTimeout(1200);
  const fb = await p.evaluate(() => { const b = document.getElementById('cafe-open'); if (!b || b.style.display === 'none') return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), inScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
  check(`${vp.w}x${vp.h}: the floating Café button is on screen and at least 44px tall`, fb && fb.inScreen && fb.h >= 44, JSON.stringify(fb));
  const page = await p.evaluate(() => ({ sx: document.documentElement.scrollWidth - innerWidth, sy: document.documentElement.scrollHeight - innerHeight }));
  check(`${vp.w}x${vp.h}: the page itself never scrolls`, page.sx <= 1 && page.sy <= 1, JSON.stringify(page));
  await ctx.close();
}
console.log(R.join('\n')); console.log('ERRORS:', [...new Set(errs)].join('|') || 'none');
await browser.close();
