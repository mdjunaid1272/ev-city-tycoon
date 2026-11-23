import { CafeCozyView } from '../businesses/CafeCozyView.js';
import { CAFE_LAYOUT } from '../businesses/Cafe.js';
import { esc, money } from './uiShared.js';

/**
 * The play screen of the cozy café: an order panel (customer tickets), a workbench (ingredients, machines, tray, pickup counter)
 * in three tabs (Drinks / Bakery / Extras), an optional dialogue box, a recipe card and the end-of-day summary. The 3D café shows
 * through the middle of the screen (the camera moves to an isometric view of the café). Static DOM, updated in place so taps are
 * never lost. All rules live in CafeCozy; this file only draws them and forwards taps.
 */
const REFRESH = 0.1;
const TABS = [['drinks', '☕ Drinks'], ['bakery', '🥐 Bakery'], ['extras', '✨ Extras']];

export class CafeCozyUI {
  constructor({ game, doc = document }) {
    this.g = game; this.doc = doc; this.cz = game.cafeCozy;
    this.isOpen = false; this.tab = 'drinks'; 
    this.t = 0; this.noteSeen = 0; this.noteTimer = 0; this.cards = new Map(); this.dlgKey = null;
    this.build();
  }

  build() {
    const d = this.doc, cfg = this.cz.cfg, el = this.el = d.createElement('section');
    el.id = 'cz'; el.className = 'hidden'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Café');
    const tile = (kind, id, o, extra = '') => `<button type="button" class="cz-t cz-${kind}" data-${kind}="${id}" aria-label="${esc(o.label)}"><i class="cz-ring"></i><span class="cz-ic" aria-hidden="true">${o.icon}</span><b>${esc(o.label)}</b><kbd aria-hidden="true"></kbd><em class="cz-badge"></em>${extra}</button>`;
    const pane = (tab) => {
      const ing = Object.entries(cfg.ingredients).filter(([, o]) => o.tab === tab || o.also?.includes(tab)).map(([id, o]) => tile('ing', id, o)).join('');
      const mach = Object.entries(cfg.machines).filter(([, o]) => o.tab === tab).map(([id, o]) => tile('mach', id, o)).join('');
      const disp = tab === 'bakery' ? Object.entries(cfg.products).filter(([, p]) => p.display).map(([id, p]) => tile('disp', id, p)).join('') : '';
      return `<div class="cz-pane" data-pane="${tab}" hidden><div class="cz-row cz-ings">${ing}${disp}</div>${mach ? `<div class="cz-row cz-machs">${mach}</div>` : ''}</div>`;
    };
    el.innerHTML = `
      <header class="cz-top">
        <b class="cz-title">☕ Café <span id="cz-lv">Lv 1</span></b>
        <span class="cz-chip cz-xp" title="Café experience"><i id="cz-xpbar"></i><span id="cz-xptxt">0 XP</span></span>
        <span class="cz-chip">🪙 <b id="cz-coins">0</b></span>
        <span class="cz-chip">Served <b id="cz-served">0</b></span>
        <button type="button" class="cz-x" data-cz="recipe" aria-label="Recipe card">📖</button>
        <button type="button" class="cz-x" data-cz="close" aria-label="Close the café for today">✕</button>
      </header>
      <div class="cz-orders" id="cz-orders" role="list" aria-label="Customers and their orders"><p class="cz-empty" id="cz-empty">The café is open. Customers will be here soon…</p></div>
      <div class="cz-mid" aria-hidden="true"></div>
      <div class="cz-bench">
        <div class="cz-note" id="cz-note" role="status" aria-live="polite"></div>
        <div class="cz-row cz-work">
          <div class="cz-tray" id="cz-tray" aria-label="Tray"><span class="cz-hint">Tap a customer, then add ingredients.</span></div>
          <div class="cz-pick" id="cz-pick" aria-label="Pickup counter"><span class="cz-hint">Pickup</span></div>
          <button type="button" class="cz-bin" data-cz="bin" aria-label="Throw away what you are making">🗑</button>
        </div>
        <div class="cz-tabs" role="tablist">${TABS.map(([id, l]) => `<button type="button" role="tab" class="cz-tab" data-cztab="${id}" aria-selected="false">${l}</button>`).join('')}</div>
        ${TABS.map(([id]) => pane(id)).join('')}
      </div>
      <aside class="cz-recipe hidden" id="cz-recipe" role="dialog" aria-label="Recipe"></aside>
      <div class="cz-dialogue hidden" id="cz-dialogue" role="dialog" aria-modal="true" aria-labelledby="cz-dtitle"></div>
      <div class="cz-summary hidden" id="cz-summary" role="alertdialog" aria-labelledby="cz-stitle"></div>`;
    this.$ = (q) => el.querySelector(q);
    el.addEventListener('click', (e) => this.onClick(e));
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) el.addEventListener(ev, (e) => { if (e.target.closest('button')) e.stopPropagation(); }, { passive: true });
    this.onKey = (e) => this.key(e);
    d.body.appendChild(el);
    this.tiles = { ing: {}, mach: {}, disp: {} };
    for (const k of ['ing', 'mach', 'disp']) for (const b of el.querySelectorAll(`[data-${k}]`)) (this.tiles[k][b.dataset[k]] ||= []).push(b);
  }

  dispose() {
    if (this.isOpen) this.leave(true);
    removeEventListener('keydown', this.onKey, true);
    this.el?.remove(); this.el = null;
  }

  // ---------- open / close ----------
  open() {
    const g = this.g, cz = this.cz;
    if (this.isOpen || !g.cafe.built) return false;
    if (g.ui?.modal) g.ui.closeModal();
    const r = cz.openShift();
    if (!r.ok) { g.bus.emit('toast', { text: r.reason, kind: 'warn' }); return false; }
    this.isOpen = true; this.noteSeen = 0; this.noteTimer = 0; this.dlgKey = null;
    this.restoreFocus = this.doc.activeElement;
    this.prevCamera = undefined; this.applyView();
    this.el.classList.remove('hidden'); for (const id of ['#cz-summary', '#cz-dialogue', '#cz-recipe']) this.$(id).classList.add('hidden');
    this.doc.body.classList.add('cz-on');
    const hud = this.doc.getElementById('hud'); if (hud) hud.inert = true;
    g.player.enabled = false; g.player.target = null;
    this.playerWasVisible = g.player.model.visible; g.player.model.visible = false; // the player is the barista behind the camera: the figure must not stand in the picture
    if (g.ownerWork) { g.ownerWork.drop('cafe'); g.ownerWork.suspended = true; }
    addEventListener('keydown', this.onKey, true);
    this.setTab(this.tab);
    this.refresh();
    return true;
  }

  /** Close the screen and give the city back (closing a shift in progress closes the café and pays out). */
  leave() {
    if (!this.isOpen) return;
    const g = this.g;
    this.isOpen = false;
    if (this.cz.open) this.cz.closeShift();
    this.cz.dismiss();
    this.el.classList.add('hidden'); this.doc.body.classList.remove('cz-on');
    const hud = this.doc.getElementById('hud'); if (hud) hud.inert = false;
    g.player.enabled = true; g.player.model.visible = this.playerWasVisible ?? true;
    if (g.ownerWork) g.ownerWork.suspended = false;
    if (this.prevCamera === 'third' && g.camera.inManagement) g.camera.setMode('third');
    this.prevCamera = undefined;
    removeEventListener('keydown', this.onKey, true);
    for (const c of this.cards.values()) c.remove();
    this.cards.clear();
    try { this.restoreFocus?.focus?.(); } catch (e) { /* gone */ }
  }

  askClose() {
    const cz = this.cz;
    if (cz.state === 'summary') return this.leave();
    if (!cz.session?.customers.length && !cz.session?.served) return this.leave();
    this.g.ui.askConfirm({ title: 'Close the café?', text: 'Customers still inside will leave. What you earned today is kept.', yes: 'Close the café' }).then((ok) => { if (ok) this.closeShiftNow(); });
  }
  closeShiftNow() { this.cz.closeShift(); this.refresh(); }

  /** Is the workbench / orders in side columns (wide landscape)? Then the room gets the middle of the screen. */
  sideLayout() { return innerWidth >= 900 && innerWidth / innerHeight >= 1.25; }

  /** The camera: the same corner (isometric) view of the café as before. */
  applyView() {
    const g = this.g;
    if (this.prevCamera === undefined) this.prevCamera = g.camera.inManagement ? 'management' : 'third';
    g.camera.setMode('management');
    g.camera.mg.focus.set(CAFE_LAYOUT.building.x, 0, CAFE_LAYOUT.building.z - 4.5); g.camera.mg.dist = 64;
  }

  setTab(tab) {
    this.tab = tab;
    for (const b of this.el.querySelectorAll('.cz-tab')) { const on = b.dataset.cztab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    for (const p of this.el.querySelectorAll('.cz-pane')) p.hidden = p.dataset.pane !== tab;
    // keyboard hints follow the open tab
    const cfg = this.cz.cfg;
    for (const [k, list] of [['ing', cfg.ingredients], ['mach', cfg.machines]]) for (const [id, btns] of Object.entries(this.tiles[k])) for (const b of btns) { const o = list[id], kb = b.querySelector('kbd'); kb.textContent = (o.tab === tab || o.also?.includes(tab)) ? o.key : ''; }
  }

  // ---------- input ----------
  onClick(e) {
    const t = e.target, cz = this.cz;
    const act = t.closest?.('[data-cz]')?.dataset.cz, tab = t.closest?.('[data-cztab]')?.dataset.cztab;
    const ing = t.closest?.('[data-ing]'), mach = t.closest?.('[data-mach]'), disp = t.closest?.('[data-disp]'), card = t.closest?.('[data-cid]'), chat = t.closest?.('[data-chat]');
    const dlg = t.closest?.('[data-dlg]'), sum = t.closest?.('[data-sum]');
    if (tab) return this.setTab(tab);
    if (sum) return this.summaryAction(sum.dataset.sum);
    if (dlg) return this.dialogueAction(dlg.dataset.dlg);
    if (act === 'close') return this.askClose();
    if (act === 'recipe') { this.$('#cz-recipe').classList.toggle('hidden'); this.refresh(); return; }
    if (act === 'bin') { cz.discardBuild(); this.refresh(); return; }
    if (!cz.open) return;
    if (chat) { const r = cz.chat(chat.dataset.chat); if (!r.ok) this.g.bus.emit('toast', { text: 'Nothing to chat about right now.', kind: 'info' }); this.refresh(); return; }
    if (ing) return this.tap(cz.addIngredient(ing.dataset.ing), ing);
    if (mach) return this.tap(cz.tapMachine(mach.dataset.mach), mach);
    if (disp) return this.tap(cz.tapDisplay(disp.dataset.disp), disp);
    if (card) return this.tap(cz.tapCustomer(card.dataset.cid), card);
  }
  tap(res, el) { if (res && !res.ok) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); } this.refresh(); }

  key(e) {
    if (!this.isOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const cz = this.cz;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (cz.session?.dialogue) { cz.skipDialogue(); this.refresh(); } else if (!this.g.ui?.confirmOpen) this.askClose(); return; }
    if (e.key === 'Tab' || this.g.ui?.confirmOpen || !cz.open || cz.session?.dialogue) return;
    if (e.key === '[' || e.key === ']') { const ids = TABS.map(([i]) => i), i = ids.indexOf(this.tab); this.setTab(ids[(i + (e.key === ']' ? 1 : ids.length - 1)) % ids.length]); e.preventDefault(); return; }
    const up = e.key.length === 1 ? e.key.toUpperCase() : '', cfg = cz.cfg, tab = this.tab;
    const ing = Object.entries(cfg.ingredients).find(([, o]) => (o.tab === tab || o.also?.includes(tab)) && o.key === up)?.[0];
    const mach = Object.entries(cfg.machines).find(([, o]) => o.tab === tab && o.key === up)?.[0];
    if (ing) { e.preventDefault(); e.stopPropagation(); this.tap(cz.addIngredient(ing), this.tiles.ing[ing][0]); return; }
    if (mach) { e.preventDefault(); e.stopPropagation(); this.tap(cz.tapMachine(mach), this.tiles.mach[mach][0]); return; }
    if (/^[7-9]$/.test(e.key)) { const c = [...this.el.querySelectorAll('.cz-c')][Number(e.key) - 7]; if (c) { e.preventDefault(); e.stopPropagation(); this.tap(cz.tapCustomer(c.dataset.cid), c); } }
  }

  // ---------- dialogue ----------
  dialogueAction(a) {
    const cz = this.cz, d = cz.session?.dialogue;
    if (a === 'thanks') { this.dlgResult = null; this.dlgKey = null; this.refresh(); return; } // the result card of a finished chat
    if (!d) return;
    if (a === 'skip') { cz.skipDialogue(); this.dlgKey = null; this.refresh(); return; }
    if (a === 'next') { d.shown = Math.min(d.lines.length, (d.shown || 1) + 1); this.dlgKey = null; this.refresh(); return; }
    if (a.startsWith('pick:')) { d.picked = Number(a.slice(5)); d.reply = null; const r = cz.finishDialogue(d.picked); this.dlgResult = { reply: r.reply, friend: r.friend, reward: r.reward, name: d.name, icon: d.icon, done: true }; this.dlgKey = null; this.refresh(); return; }
    if (a === 'end') { if (d.choices.length) return; const r = cz.finishDialogue(null); this.dlgResult = { reply: '', friend: r.friend, reward: r.reward, name: d.name, icon: d.icon, done: true }; this.dlgKey = null; this.refresh(); return; }
    if (a === 'thanks') { this.dlgResult = null; this.dlgKey = null; this.refresh(); }
  }

  renderDialogue() {
    const cz = this.cz, d = cz.session?.dialogue, el = this.$('#cz-dialogue');
    if (!d && !this.dlgResult) { if (!el.classList.contains('hidden')) { el.classList.add('hidden'); el.innerHTML = ''; } this.dlgKey = null; return; }
    if (d && !d.shown) d.shown = 1;
    const key = d ? `${d.cid}|${d.shown}|${d.picked}` : `res|${this.dlgResult.name}`;
    if (key === this.dlgKey) return;
    this.dlgKey = key;
    let html;
    if (d) {
      const last = d.shown >= d.lines.length;
      html = `<div class="cz-dcard"><div class="cz-dhead"><span class="cz-dface">${d.icon}</span><div><b id="cz-dtitle">${esc(d.name)}</b><small>${esc(d.title)}</small></div><button type="button" class="cz-x" data-dlg="skip" aria-label="Skip the chat">✕</button></div>
        <div class="cz-dlines">${d.lines.slice(0, d.shown).map((l) => `<p class="${l.who === d.name ? 'them' : 'me'}"><b>${esc(l.who)}</b> ${esc(l.text)}</p>`).join('')}</div>
        <div class="cz-dbtns">${!last ? '<button type="button" class="cz-b primary" data-dlg="next">Next ▸</button>' : d.choices.length ? d.choices.map((c, i) => `<button type="button" class="cz-b" data-dlg="pick:${i}">${esc(c.text)}</button>`).join('') : '<button type="button" class="cz-b primary" data-dlg="end">Nice! ♥</button>'}</div><p class="cz-dsub">Chatting is optional: close it any time.</p></div>`;
    } else {
      const r = this.dlgResult;
      html = `<div class="cz-dcard"><div class="cz-dhead"><span class="cz-dface">${r.icon}</span><div><b id="cz-dtitle">${esc(r.name)}</b><small>Friendship +${r.friend}</small></div></div>
        ${r.reply ? `<div class="cz-dlines"><p class="them"><b>${esc(r.name)}</b> ${esc(r.reply)}</p></div>` : ''}
        ${r.reward ? `<p class="cz-gift">🎁 ${r.reward.coins ? `+${r.reward.coins} coins` : ''} ${r.reward.unlock?.decor ? `· new decoration: <b>${esc(cz.decor.items[r.reward.unlock.decor].name)}</b>` : ''}</p>` : ''}
        <div class="cz-dbtns"><button type="button" class="cz-b primary" data-dlg="thanks">Back to the café</button></div></div>`;
    }
    el.innerHTML = html; el.classList.remove('hidden');
    el.querySelector('.cz-b.primary, .cz-b')?.focus?.();
  }

  // ---------- summary ----------
  renderSummary() {
    const cz = this.cz, el = this.$('#cz-summary');
    if (cz.state !== 'summary' || !cz.summary) { if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
    if (el._s === cz.summary) return;
    el._s = cz.summary;
    const s = cz.summary, C = cz.cfg;
    const lv = s.levelUps.map((l) => { const u = cz.unlocksAt(l); const bits = [...u.drinks.map((p) => C.products[p].label), ...u.desserts.map((p) => C.products[p].label), ...u.machines.map((m) => C.machines[m].label), ...u.customers.map((c) => C.customers[c].name), ...u.themes.map((t) => C.decor.themes[t].name + ' theme')]; return `<li><b>Level ${l}!</b> ${bits.length ? 'Unlocked: ' + esc(bits.join(', ')) : ''}</li>`; }).join('');
    el.innerHTML = `<div class="cz-scard"><h2 id="cz-stitle">${s.served ? 'Another lovely day' : 'The café is closed'}</h2>
      <ul class="cz-stats"><li>Served <b>${s.served}</b></li><li>Perfect <b>${s.perfect}</b></li><li>Happy <b>${s.happy}</b></li><li>Best combo <b>x${s.bestCombo}</b></li><li>Café coins <b>+${s.coins.toFixed(1)}</b></li><li>XP <b>+${s.xp}</b></li></ul>
      ${lv ? `<ul class="cz-up">${lv}</ul>` : ''}${s.gifts.length ? `<p class="cz-gift">🎁 Gifts: ${s.gifts.map((g) => esc(C.decor.items[g].name)).join(', ')}</p>` : ''}
      <p class="cz-city">${s.rewarded ? (s.cash > 0 || s.rep > 0 ? `City: <b>${s.cash > 0 ? '+' + money(s.cash, 2) : ''}</b> ${s.rep > 0 ? ' · +' + s.rep + ' reputation' : ''}` : 'No city reward this time.') : esc(s.why || 'No city reward this shift.')}</p>
      <p class="cz-sub">Your café keeps earning on its own. This game is optional.</p>
      <div class="cz-btns"><button type="button" class="cz-b primary" data-sum="again">Open again</button><button type="button" class="cz-b" data-sum="menu">Café menu</button><button type="button" class="cz-b" data-sum="exit">Back to the city</button></div></div>`;
    el.classList.remove('hidden');
    el.querySelector('[data-sum="again"]')?.focus?.();
  }
  summaryAction(a) {
    const cz = this.cz;
    if (a === 'again') { cz.dismiss(); this.$('#cz-summary').classList.add('hidden'); const r = cz.openShift(); if (!r.ok) this.g.bus.emit('toast', { text: r.reason, kind: 'warn' }); this.noteSeen = 0; this.refresh(); return; }
    if (a === 'menu') { this.leave(); this.g.openCafeHub(); return; }
    this.leave();
  }

  // ---------- per frame ----------
  update(dt) {
    if (!this.isOpen) return;
    if (!this.g.cafe.built) { this.leave(); return; }
    this.cz.update(dt);
    if (this.noteTimer > 0) this.noteTimer -= dt;
    this.t -= dt;
    if (this.t <= 0) { this.t = REFRESH; this.refresh(); }
  }

  setText(sel, v) { const n = this.$(sel); if (n.textContent !== v) n.textContent = v; }

  refresh() {
    const cz = this.cz, s = cz.session, B = cz.book, C = cz.cfg;
    if (!s) return;
    // ---- header
    const pr = cz.levelProgress();
    this.setText('#cz-lv', `Lv ${cz.level}`); this.setText('#cz-coins', cz.coins.toFixed(0)); this.setText('#cz-served', String(s.served));
    this.$('#cz-xpbar').style.width = `${Math.round(pr.frac * 100)}%`; this.setText('#cz-xptxt', pr.next ? `${pr.into}/${pr.need} XP` : 'MAX');
    // ---- customers
    const ids = new Set();
    s.customers.forEach((c, i) => {
      ids.add(c.id);
      let el = this.cards.get(c.id);
      if (!el) {
        el = this.doc.createElement('div'); el.className = 'cz-cw'; el.setAttribute('role', 'listitem');
        el.innerHTML = '<button type="button" class="cz-c"><span class="cz-face"></span><b class="cz-name"></b><small class="cz-cat"></small><span class="cz-lines"></span><i class="cz-pat"><u></u></i></button><button type="button" class="cz-chat" hidden>💬 Chat</button>';
        el.querySelector('.cz-c').dataset.cid = c.id; el.querySelector('.cz-chat').dataset.chat = c.id;
        this.$('#cz-orders').appendChild(el); this.cards.set(c.id, el);
      }
      const card = el.querySelector('.cz-c'), frac = Math.max(0, Math.min(1, c.patience / c.maxPatience));
      const cls = `cz-c ${c.category}${c.vip ? ' vip' : ''}${s.activeId === c.id ? ' sel' : ''}${c.state !== 'waiting' ? ' eating' : ''}${frac < 0.3 && c.state === 'waiting' ? ' hot' : ''}`;
      if (card.className !== cls) card.className = cls;
      card.querySelector('.cz-face').textContent = c.icon; card.querySelector('.cz-name').textContent = c.name; card.querySelector('.cz-cat').textContent = c.state === 'waiting' ? c.category : 'enjoying it ♥';
      const lines = c.lines.map((l) => `<span class="${l.done ? 'done' : ''}" title="${esc(cz.productLabel(l.pid))}">${cz.productIcon(l.pid)} ${esc(cz.productLabel(l.pid))}${l.requests.length ? ` <em>${esc(l.requests.map((r) => C.requests[r].text).join(', '))}</em>` : ''}</span>`).join('');
      const ln = card.querySelector('.cz-lines'); if (ln._h !== lines) { ln.innerHTML = lines; ln._h = lines; }
      card.querySelector('u').style.width = `${c.state === 'waiting' ? Math.round(frac * 100) : 100}%`;
      card.setAttribute('aria-label', `${c.name} orders ${c.lines.filter((l) => !l.done).map((l) => cz.productLabel(l.pid)).join(' and ') || 'nothing more'}`);
      const chat = el.querySelector('.cz-chat'); chat.hidden = !(c.state === 'eating' && c.chatReady);
      el.style.order = String(i);
    });
    for (const [id, el] of this.cards) if (!ids.has(id)) { el.remove(); this.cards.delete(id); }
    this.$('#cz-empty').hidden = ids.size > 0;
    // ---- tray + pickup
    const b = s.build, tray = this.$('#cz-tray');
    const th = b ? `<span class="cz-for">${cz.productIcon(b.pid)} ${esc(cz.productLabel(b.pid))}</span>${b.tray.map((x) => `<span class="cz-tk" title="${esc(B.tokenLabel(x.t))}">${B.tokenIcon(x.t)}</span>`).join('')}${b.addons.map((a) => `<span class="cz-tk add" title="${esc(C.ingredients[a].label)}">${C.ingredients[a].icon}</span>`).join('')}<span class="cz-hint">${esc(B.hint(b.pid, b.used, b.tray))}</span>` : '<span class="cz-hint">Tap a customer, then add ingredients.</span>';
    if (tray._h !== th) { tray.innerHTML = th; tray._h = th; }
    const pk = s.pickup.map((p) => `<span class="cz-pk${p.mistakes === 0 && p.q >= C.quality.perfect ? ' gold' : ''}" title="${esc(cz.productLabel(p.pid))}">${cz.productIcon(p.pid)}</span>`).join('') || '<span class="cz-hint">Pickup</span>';
    const pick = this.$('#cz-pick'); if (pick._h !== pk) { pick.innerHTML = pk; pick._h = pk; }
    // ---- tiles
    const forbid = b?.forbid || [];
    for (const [id, btns] of Object.entries(this.tiles.ing)) for (const t of btns) {
      const left = cz.pantry[id], need = b ? B.acceptsRaw(b.pid, b.used, id, forbid) && !B.isDisplay(b.pid) : false;
      const cls = `cz-t cz-ing${need ? ' need' : ''}${left <= 0 ? ' out' : ''}${t.classList.contains('shake') ? ' shake' : ''}`; if (t.className !== cls) t.className = cls;
      const bd = t.querySelector('.cz-badge'); const txt = String(left); if (bd.textContent !== txt) bd.textContent = txt;
    }
    for (const [id, btns] of Object.entries(this.tiles.disp)) for (const t of btns) {
      const need = b && b.pid === id, left = cz.display[id];
      const cls = `cz-t cz-disp${need ? ' need' : ''}${left <= 0 ? ' out' : ''}${t.classList.contains('shake') ? ' shake' : ''}`; if (t.className !== cls) t.className = cls;
      const bd = t.querySelector('.cz-badge'); if (bd.textContent !== String(left)) bd.textContent = String(left);
    }
    for (const [id, btns] of Object.entries(this.tiles.mach)) for (const t of btns) {
      const m = C.machines[id], j = s.jobs[id], locked = m.level > cz.level;
      let cls = 'cz-t cz-mach', p = 0;
      if (locked) cls += ' locked';
      else if (j?.state === 'working') { cls += ' working'; p = j.t / j.dur; }
      else if (j?.state === 'ready') { cls += j.age > C.quality.okSeconds ? ' late' : j.age > C.quality.sweetSeconds ? ' ok' : ' ready'; p = 1; }
      else if (j?.state === 'burnt') { cls += ' burnt'; p = 1; }
      else if (b && B.machinesFor(b.pid).includes(id) && B.inputsFor(id, b.tray, b.pid).ok) cls += ' need';
      if (t.classList.contains('shake')) cls += ' shake';
      if (t.className !== cls) t.className = cls;
      t.style.setProperty('--p', p.toFixed(3));
      const bd = t.querySelector('.cz-badge'); const txt = locked ? `🔒 Lv ${m.level}` : ''; if (bd.textContent !== txt) bd.textContent = txt;
    }
    // ---- message line
    const note = cz.note, n = this.$('#cz-note');
    if (note && note.id !== this.noteSeen) { this.noteSeen = note.id; this.noteTimer = 2.6; n.textContent = note.text; n.className = `cz-note ${note.kind}`; }
    if (this.noteTimer <= 0 && n.textContent) { n.textContent = ''; n.className = 'cz-note'; }
    // ---- recipe card
    const rc = this.$('#cz-recipe');
    if (!rc.classList.contains('hidden')) {
      const pid = b?.pid || (s.activeId ? cz.remaining(cz.customer(s.activeId) || { lines: [] })[0]?.pid : null);
      const html = pid ? `<h3>${cz.productIcon(pid)} ${esc(cz.productLabel(pid))}</h3><ol>${B.steps(pid).map((st) => `<li><span>${st.icon}</span> ${esc(st.text)}</li>`).join('')}</ol>` : '<p>Pick a customer to see the recipe for their order.</p>';
      if (rc._h !== html) { rc.innerHTML = html; rc._h = html; }
    }
    this.renderDialogue();
    this.renderSummary();
  }
}
