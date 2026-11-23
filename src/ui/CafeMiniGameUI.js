import { CafeMiniGameView } from '../businesses/CafeMiniGameView.js';
import { CAFE_LAYOUT } from '../businesses/Cafe.js';
import { esc, money } from './uiShared.js';

/**
 * Controls and HUD of the optional café mini-game. The 3D café (customers in the queue, order bubbles, finished products on the
 * pickup counter) shows through the middle of the screen; the panels around it hold the timer / score, the customers' tickets
 * and the workbench: ingredients, machines, tray and pickup counter. Static DOM, updated in place (taps are never lost).
 * All rules are in CafeMiniGame; this file only draws them and forwards taps.
 */
const REFRESH = 0.1;
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export class CafeMiniGameUI {
  constructor({ game, doc = document }) {
    this.g = game; this.doc = doc;
    this.logic = game.cafeMiniGame;
    this.view = new CafeMiniGameView({ cafeView: game.cafeView, mg: this.logic, settings: game.settings });
    this.isOpen = false;
    this.t = 0; this.noteSeen = 0; this.noteTimer = 0;
    this.cards = new Map();
    this.build();
  }

  build() {
    const d = this.doc, k = this.logic.k, el = this.el = d.createElement('section');
    el.id = 'mg'; el.className = 'hidden'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Café mini-game');
    const tile = (cls, id, o, extra = '') => `<button type="button" class="${cls}" data-${cls === 'mg-ing-b' ? 'ing' : 'mach'}="${id}" aria-label="${esc(o.label)}"><i class="mg-ring"></i><span class="mg-ic" aria-hidden="true">${o.icon}</span><b>${esc(o.label)}</b><kbd aria-hidden="true">${o.key}</kbd>${extra}</button>`;
    el.innerHTML = `
      <header class="mg-top">
        <b class="mg-title" id="mg-title">☕ Café mini-game</b>
        <span class="mg-chip mg-time" id="mg-time" role="timer" aria-label="Time left">0:00</span>
        <span class="mg-chip">Score <b id="mg-score">0</b></span>
        <span class="mg-chip" id="mg-combo">Combo x0</span>
        <span class="mg-chip mg-lives" id="mg-lives" aria-label="Walk-outs left"></span>
        <button type="button" class="mg-x" data-mg="quit" aria-label="Leave the mini-game">✕</button>
      </header>
      <div class="mg-cust" id="mg-cust" role="list" aria-label="Customers"><p class="mg-empty" id="mg-empty">Customers are on their way…</p></div>
      <div class="mg-mid" aria-hidden="true"></div>
      <div class="mg-bench">
        <div class="mg-note" id="mg-note" role="status" aria-live="polite"></div>
        <div class="mg-row mg-work">
          <div class="mg-tray" id="mg-tray" aria-label="Tray"><span class="mg-hint" id="mg-hint">Tap a customer, then add ingredients.</span></div>
          <div class="mg-pick" id="mg-pick" aria-label="Pickup counter"></div>
          <button type="button" class="mg-bin" data-mg="bin" aria-label="Throw away the order you are making">🗑</button>
        </div>
        <div class="mg-row mg-ing" id="mg-ing">${Object.entries(k.ingredients).map(([id, o]) => tile('mg-ing-b', id, o)).join('')}</div>
        <div class="mg-row mg-mach" id="mg-mach">${Object.entries(k.machines).map(([id, o]) => tile('mg-mach-b', id, o)).join('')}</div>
      </div>
      <div class="mg-result hidden" id="mg-result" role="alertdialog" aria-labelledby="mg-rt"></div>`;
    this.$ = (q) => el.querySelector(q);
    el.addEventListener('click', (e) => this.onClick(e));
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) el.addEventListener(ev, (e) => { if (e.target.closest('button')) e.stopPropagation(); }, { passive: true });
    this.onKey = (e) => this.key(e);
    d.body.appendChild(el);
    this.ingEls = Object.fromEntries([...el.querySelectorAll('[data-ing]')].map((b) => [b.dataset.ing, b]));
    this.machEls = Object.fromEntries([...el.querySelectorAll('[data-mach]')].map((b) => [b.dataset.mach, b]));
  }

  dispose() {
    if (this.isOpen) this.leave();
    removeEventListener('keydown', this.onKey, true);
    this.view.dispose();
    this.el?.remove(); this.el = null;
  }

  // ---------- open / close ----------
  /** Start a session and show the screen. */
  open(mode = 'quick') {
    const g = this.g;
    if (this.isOpen || !g.cafe.built) return false;
    if (g.ui?.modal) g.ui.closeModal();
    const r = this.logic.start(mode);
    if (!r.ok) { g.bus.emit('toast', { text: r.reason, kind: 'warn' }); return false; }
    this.isOpen = true;
    this.noteSeen = 0; this.noteTimer = 0;
    this.restoreFocus = this.doc.activeElement;
    this.prevCamera = g.camera.inManagement ? 'management' : 'third';
    g.camera.setMode('management');
    g.camera.mg.focus.set(CAFE_LAYOUT.building.x, 0, CAFE_LAYOUT.building.z - 4.5); g.camera.mg.dist = 64; // the whole café fits between the ticket row and the workbench
    this.el.classList.remove('hidden'); this.$('#mg-result').classList.add('hidden');
    this.doc.body.classList.add('mg-on');
    const hud = this.doc.getElementById('hud'); if (hud) hud.inert = true;
    g.player.enabled = false; g.player.target = null;
    if (g.ownerWork) { g.ownerWork.drop('minigame'); g.ownerWork.suspended = true; }
    this.view.setShown(true);
    addEventListener('keydown', this.onKey, true);
    this.refresh();
    return true;
  }

  /** Close the screen and give the city back to the player. */
  leave() {
    if (!this.isOpen) return;
    const g = this.g;
    this.isOpen = false;
    if (this.logic.running) this.logic.quit();
    this.logic.dismiss();
    this.view.setShown(false);
    this.el.classList.add('hidden'); this.doc.body.classList.remove('mg-on');
    const hud = this.doc.getElementById('hud'); if (hud) hud.inert = false;
    g.player.enabled = true;
    if (g.ownerWork) g.ownerWork.suspended = false;
    if (this.prevCamera === 'third' && g.camera.inManagement) g.camera.setMode('third');
    removeEventListener('keydown', this.onKey, true);
    for (const c of this.cards.values()) c.remove();
    this.cards.clear();
    try { this.restoreFocus?.focus?.(); } catch (e) { /* gone */ }
  }

  askLeave() {
    if (!this.logic.running) return this.leave();
    this.g.ui.askConfirm({ title: 'Leave the shift?', text: 'The coins you have earned so far are still paid (within the daily limits).', yes: 'Leave', no: 'Keep playing' }).then((ok) => { if (ok) this.leave(); });
  }

  // ---------- input ----------
  onClick(e) {
    const L = this.logic, t = e.target;
    const mg = t.closest?.('[data-mg]'), ing = t.closest?.('[data-ing]'), mach = t.closest?.('[data-mach]'), cust = t.closest?.('[data-cid]');
    if (mg) {
      const a = mg.dataset.mg;
      if (a === 'quit') return this.askLeave();
      if (a === 'bin') { L.discardBuild(); this.refresh(); return; }
      if (a === 'again') { const mode = L.result?.mode || 'quick'; L.dismiss(); this.$('#mg-result').classList.add('hidden'); L.start(mode); this.noteSeen = 0; this.refresh(); return; }
      if (a === 'menu') { this.leave(); this.g.openCafeMenu(); return; }
      if (a === 'exit') return this.leave();
    }
    if (!L.running) return;
    if (ing) { this.feedback(L.addIngredient(ing.dataset.ing), ing); this.refresh(); return; }
    if (mach) { this.feedback(L.tapMachine(mach.dataset.mach), mach); this.refresh(); return; }
    if (cust) { this.feedback(L.tapCustomer(cust.dataset.cid), cust); this.refresh(); }
  }

  /** A short shake on a refused tap (the message line explains why). */
  feedback(res, el) {
    if (res?.ok) return;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  key(e) {
    if (!this.isOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!this.g.ui?.confirmOpen) this.askLeave(); return; }
    if (e.key === 'Tab' || this.g.ui?.confirmOpen || !this.logic.running) return;
    const L = this.logic, k = L.k, up = e.key.length === 1 ? e.key.toUpperCase() : '';
    const ing = Object.entries(k.ingredients).find(([, o]) => o.key === up)?.[0], mach = Object.entries(k.machines).find(([, o]) => o.key === up)?.[0];
    if (ing) { e.preventDefault(); e.stopPropagation(); this.feedback(L.addIngredient(ing), this.ingEls[ing]); this.refresh(); return; }
    if (mach) { e.preventDefault(); e.stopPropagation(); this.feedback(L.tapMachine(mach), this.machEls[mach]); this.refresh(); return; }
    if (/^[7-9]$/.test(e.key)) { const card = [...this.el.querySelectorAll('.mg-c')][Number(e.key) - 7]; if (card) { e.preventDefault(); e.stopPropagation(); this.feedback(L.tapCustomer(card.dataset.cid), card); this.refresh(); } }
  }

  // ---------- per frame ----------
  update(dt) {
    if (!this.isOpen) return;
    if (!this.g.cafe.built) { this.leave(); return; }
    this.logic.update(dt);
    this.view.update(dt);
    if (this.noteTimer > 0) this.noteTimer -= dt;
    this.t -= dt;
    if (this.t <= 0) { this.t = REFRESH; this.refresh(); }
  }

  setText(sel, v) { const n = this.$(sel); if (n.textContent !== v) n.textContent = v; }

  refresh() {
    const L = this.logic, s = L.session, R = L.recipes, k = L.k;
    if (L.state === 'ended' && L.result) { this.showResult(); return; }
    if (!s) return;
    const b = s.build;
    // ---- top bar
    this.setText('#mg-title', `☕ ${s.cfg.label}${s.rewarded ? '' : ' · practice'}`);
    this.setText('#mg-time', fmt(s.left)); this.$('#mg-time').classList.toggle('low', s.left <= 15);
    this.setText('#mg-score', String(Math.round(s.score)));
    this.setText('#mg-combo', `Combo x${s.combo}`); this.$('#mg-combo').classList.toggle('on', s.combo > 1);
    const lives = s.cfg.strikes - s.strikes; const lv = '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, s.strikes));
    this.setText('#mg-lives', lv);
    // ---- customers
    const ids = new Set();
    s.customers.forEach((c, i) => {
      ids.add(c.id);
      let el = this.cards.get(c.id);
      if (!el) {
        el = this.doc.createElement('button'); el.type = 'button'; el.className = 'mg-c'; el.dataset.cid = c.id; el.setAttribute('role', 'listitem');
        el.innerHTML = '<span class="mg-face"></span><small class="mg-who"></small><span class="mg-items"></span><i class="mg-pat"><u></u></i>';
        this.$('#mg-cust').appendChild(el); this.cards.set(c.id, el);
        el.style.setProperty('--c', c.color);
      }
      const frac = Math.max(0, Math.min(1, c.patience / c.maxPatience)), left = L.remaining(c);
      const cls = `mg-c ${c.type}${s.activeId === c.id ? ' sel' : ''}${frac < 0.34 ? ' hot' : ''}`;
      if (el.className !== cls) el.className = cls;
      const face = el.querySelector('.mg-face'); if (face.textContent !== c.icon) face.textContent = c.icon;
      const who = el.querySelector('.mg-who'); if (who.textContent !== c.label) who.textContent = c.label;
      const doneArr = [...c.served];
      const items = c.items.map((p) => { const dn = doneArr.includes(p) && (doneArr.splice(doneArr.indexOf(p), 1), true); return `<span class="${dn ? 'done' : ''}">${L.productIcon(p)}</span>`; }).join('');
      const it = el.querySelector('.mg-items'); if (it._h !== items) { it.innerHTML = items; it._h = items; }
      el.querySelector('u').style.width = `${Math.round(frac * 100)}%`;
      el.setAttribute('aria-label', `${c.label} wants ${left.map((p) => L.productLabel(p)).join(' and ')}, ${Math.round(c.patience)} seconds of patience left`);
      el.setAttribute('aria-pressed', String(s.activeId === c.id));
      el.style.order = String(i);
    });
    for (const [id, el] of this.cards) if (!ids.has(id)) { el.remove(); this.cards.delete(id); }
    this.$('#mg-empty').hidden = ids.size > 0;
    // ---- tray, hint, pickup
    const tray = this.$('#mg-tray');
    const th = b ? `<span class="mg-for">${L.productIcon(b.pid)} ${esc(L.productLabel(b.pid))}</span>${b.tray.map((x) => `<span class="mg-tk" title="${esc(R.tokenLabel(x.t))}">${R.tokenIcon(x.t)}</span>`).join('')}<span class="mg-hint">${esc(R.hint(b.pid, b.used, b.tray))}</span>` : '<span class="mg-hint">Tap a customer, then add ingredients.</span>';
    if (tray._h !== th) { tray.innerHTML = th; tray._h = th; }
    const pk = `${s.pickup.map((p) => `<span class="mg-pk${p.mistakes === 0 && p.q >= 0.95 ? ' gold' : ''}" title="${esc(L.productLabel(p.pid))}">${L.productIcon(p.pid)}</span>`).join('') || '<span class="mg-hint">Pickup</span>'}`;
    const pick = this.$('#mg-pick'); if (pick._h !== pk) { pick.innerHTML = pk; pick._h = pk; }
    // ---- ingredients and machines
    for (const [id, btn] of Object.entries(this.ingEls)) {
      const need = b ? R.acceptsRaw(b.pid, b.used, id) : false;
      const cls = `mg-ing-b${need ? ' need' : ''}`; if (btn.className !== cls && !btn.classList.contains('shake')) btn.className = cls; else if (btn.classList.contains('shake')) btn.classList.toggle('need', need);
    }
    for (const [id, btn] of Object.entries(this.machEls)) {
      const j = s.jobs[id], mc = k.machines[id];
      let cls = 'mg-mach-b', p = 0;
      if (j?.state === 'working') { cls += ' working'; p = j.t / j.dur; }
      else if (j?.state === 'ready') { cls += j.age > k.timing.okSeconds ? ' late' : j.age > k.timing.sweetSeconds ? ' ok' : ' ready'; p = 1; }
      else if (j?.state === 'burnt') { cls += ' burnt'; p = 1; }
      else if (b && R.machinesFor(b.pid).includes(id) && R.inputsFor(id, b.tray).ok) cls += ' need';
      if (btn.classList.contains('shake')) cls += ' shake';
      if (btn.className !== cls) btn.className = cls;
      btn.style.setProperty('--p', p.toFixed(3));
      void mc;
    }
    // ---- message line
    const note = L.note;
    const n = this.$('#mg-note');
    if (note && note.id !== this.noteSeen) { this.noteSeen = note.id; this.noteTimer = 2.4; n.textContent = note.text; n.className = `mg-note ${note.kind}`; }
    if (this.noteTimer <= 0 && n.textContent) { n.textContent = ''; n.className = 'mg-note'; }
  }

  showResult() {
    const L = this.logic, r = L.result, el = this.$('#mg-result');
    if (!el.classList.contains('hidden') && el._id === r) return;
    el._id = r;
    const m = L.k.modes[r.mode], st = L.status();
    const stars = [1, 2, 3].map((i) => `<span class="${i <= r.stars ? 'on' : ''}" aria-hidden="true">★</span>`).join('');
    const why = { time: "Time's up!", walkouts: 'Too many customers walked out.', quit: 'You left the shift.' }[r.reason] || 'Shift over';
    const pay = r.rewarded
      ? (r.payout > 0 ? `<p class="mg-pay">+${money(r.payout, 2)} paid to your city cash${r.limited ? ` <small>(${r.limited} reached)</small>` : ''}</p>` : '<p class="mg-pay none">No coins this time (limit reached).</p>')
      : `<p class="mg-pay none">Practice run: ${esc(r.rewardNote || 'no reward')}.</p>`;
    el.innerHTML = `<div class="mg-card">
      <h2 id="mg-rt">${esc(why)}</h2><div class="mg-stars" aria-label="${r.stars} of 3 stars">${stars}</div>
      <p class="mg-big">${r.score} <small>points${r.newBest ? ' · new best!' : ''}</small></p>
      <ul class="mg-stats"><li>Served <b>${r.served}</b></li><li>Perfect <b>${r.perfect}</b></li><li>Best combo <b>x${r.bestCombo}</b></li><li>Wrong <b>${r.wrong}</b></li><li>Walk-outs <b>${r.lost}</b></li></ul>
      ${pay}
      <p class="mg-sub">${esc(m.label)} · today ${money(st.dayCoinCap - st.coinsLeft, 2)} / ${money(st.dayCoinCap)} coins · the café keeps earning on its own, this game is optional.</p>
      <div class="mg-btns"><button type="button" class="mg-b primary" data-mg="again">Play again</button><button type="button" class="mg-b" data-mg="menu">Café menu</button><button type="button" class="mg-b" data-mg="exit">Back to the city</button></div></div>`;
    el.classList.remove('hidden');
    el.querySelector('[data-mg="again"]').focus?.();
  }
}
