import { CafeKitchen } from '../businesses/CafeKitchen.js';
import { esc, money } from './uiShared.js';

/**
 * Full-screen "cooking game" kitchen for the café. Static DOM (created once): customer tickets on top, the recipe of the
 * selected ticket, six big station buttons on the counter, a message line and the stock footer. Elements are updated in
 * place (never rebuilt while a finger is down), so taps are never lost. All rules live in CafeKitchen (pure logic).
 */
const REFRESH = 0.1;

export class CafeKitchenUI {
  constructor({ game, doc = document }) {
    this.g = game;
    this.doc = doc;
    this.logic = new CafeKitchen({ cafe: game.cafe, bus: game.bus });
    this.isOpen = false;
    this.t = 0;
    this.cards = new Map();   // order id -> element
    this.noteSeen = 0;
    this.noteTimer = 0;
    this.build();
  }

  build() {
    const d = this.doc, st = this.logic.stations;
    const el = this.el = d.createElement('section');
    el.id = 'kitchen'; el.className = 'hidden'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Café kitchen');
    el.innerHTML = `
      <header class="k-top">
        <b class="k-title">☕ Café kitchen</b>
        <span class="k-stat k-combo" id="k-combo" title="Good orders in a row raise your tips">Combo x0</span>
        <span class="k-stat">Tips <b id="k-tips">$0.00</b></span>
        <span class="k-stat">Served <b id="k-served">0</b></span>
        <button type="button" class="k-x" data-k="manage" aria-label="Open the café manager">⚙</button>
        <button type="button" class="k-x" data-k="close" aria-label="Close the kitchen">✕</button>
      </header>
      <div class="k-cust" id="k-cust" role="list" aria-label="Customers waiting"><p class="k-empty" id="k-empty">Waiting for customers…</p></div>
      <div class="k-recipe" id="k-recipe" aria-live="polite"></div>
      <div class="k-counter"><div class="k-stations" id="k-stations">${Object.entries(st).map(([id, s]) => `
        <button type="button" class="k-st" data-st="${id}" aria-label="${esc(s.label)}"><i class="k-ring"></i><span class="k-ic" aria-hidden="true">${s.icon}</span><b>${esc(s.label)}</b><kbd aria-hidden="true">${s.key}</kbd></button>`).join('')}
      </div></div>
      <div class="k-note" id="k-note" role="status" aria-live="polite"></div>
      <footer class="k-foot" id="k-foot"></footer>`;
    this.$ = (q) => el.querySelector(q);
    el.addEventListener('click', (e) => this.onClick(e));
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    this.onKey = (e) => this.key(e);
    d.body.appendChild(el);
    this.stationEls = Object.fromEntries([...el.querySelectorAll('.k-st')].map((b) => [b.dataset.st, b]));
  }

  dispose() {
    if (this.isOpen) this.close();
    removeEventListener('keydown', this.onKey, true);
    this.el?.remove();
    this.el = null;
  }

  // ---------- open / close ----------
  open() {
    const g = this.g;
    if (this.isOpen || !g.cafe.built) return false;
    if (g.ui?.confirmOpen) return false;
    if (g.ui?.modal) g.ui.closeModal();
    this.isOpen = true;
    this.logic.reset();
    this.noteSeen = 0;
    this.restoreFocus = this.doc.activeElement;
    this.el.classList.remove('hidden');
    this.doc.body.classList.add('kitchen-on');
    for (const id of ['hud']) { const e = this.doc.getElementById(id); if (e) e.inert = true; } // keyboard and screen readers stay inside the kitchen
    g.player.enabled = false; g.player.target = null;
    if (g.ownerWork) { g.ownerWork.drop('kitchen'); g.ownerWork.suspended = true; }
    addEventListener('keydown', this.onKey, true);
    this.refresh(true);
    (this.el.querySelector('.k-c') || this.$('[data-k="close"]')).focus?.();
    return true;
  }

  close() {
    if (!this.isOpen) return;
    const g = this.g;
    this.isOpen = false;
    this.logic.close();
    this.el.classList.add('hidden');
    this.doc.body.classList.remove('kitchen-on');
    const hud = this.doc.getElementById('hud'); if (hud) hud.inert = false;
    g.player.enabled = true;
    if (g.ownerWork) g.ownerWork.suspended = false;
    removeEventListener('keydown', this.onKey, true);
    for (const c of this.cards.values()) c.remove();
    this.cards.clear();
    try { this.restoreFocus?.focus?.(); } catch (e) { /* element gone */ }
  }

  // ---------- input ----------
  onClick(e) {
    const t = e.target;
    const k = t.closest?.('[data-k]'), st = t.closest?.('[data-st]'), c = t.closest?.('[data-oid]');
    if (k?.dataset.k === 'close') return this.close();
    if (k?.dataset.k === 'manage') { this.close(); this.g.ui.open('cafe'); return; }
    if (st) { this.logic.tapStation(st.dataset.st); this.refresh(true); return; }
    if (c) { this.logic.select(c.dataset.oid); this.refresh(true); }
  }

  key(e) {
    if (!this.isOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (e.key === 'Tab') return; // normal focus movement
    const up = e.key.length === 1 ? e.key.toUpperCase() : '';
    const sid = Object.entries(this.logic.stations).find(([, s]) => s.key === up)?.[0];
    if (sid) { e.preventDefault(); e.stopPropagation(); this.logic.tapStation(sid); this.refresh(true); return; }
    if (/^[1-9]$/.test(e.key)) {
      const card = [...this.el.querySelectorAll('.k-c')][Number(e.key) - 1];
      if (card) { e.preventDefault(); e.stopPropagation(); this.logic.select(card.dataset.oid); this.refresh(true); }
    }
  }

  // ---------- per frame ----------
  update(dt) {
    if (!this.isOpen) return;
    if (!this.g.cafe.built) { this.close(); return; }
    this.logic.update(dt);
    this.t -= dt;
    if (this.noteTimer > 0) this.noteTimer -= dt;
    if (this.t <= 0) { this.t = REFRESH; this.refresh(); }
  }

  refresh() {
    const L = this.logic, c = this.g.cafe, products = c.cfg.products;
    // ---- tickets (keyed: existing cards are updated, never recreated)
    const ids = new Set();
    c.orders.forEach((o, i) => {
      ids.add(o.id);
      let el = this.cards.get(o.id);
      if (!el) {
        el = this.doc.createElement('button');
        el.type = 'button'; el.className = 'k-c'; el.dataset.oid = o.id; el.setAttribute('role', 'listitem');
        el.innerHTML = '<span class="k-face"></span><span class="k-want"></span><b></b><small></small><i class="k-pat"><u></u></i>';
        this.$('#k-cust').appendChild(el);
        this.cards.set(o.id, el);
      }
      const p = products[o.pid], cu = o.customer, frac = Math.max(0, Math.min(1, cu.patience / Math.max(1, cu.maxPatience)));
      const mine = !!L.tickets.get(o.id), staff = !mine && (o.by === 'staff' || o.manual);
      const cls = `k-c${L.selected === o.id ? ' sel' : ''}${mine ? ' mine' : ''}${staff ? ' staff' : ''}${frac < 0.34 ? ' hot' : ''}`;
      if (el.className !== cls) el.className = cls;
      const q = (s, v, prop = 'textContent') => { const n = el.querySelector(s); if (n[prop] !== v) n[prop] = v; };
      q('.k-face', cu.def?.icon || '🙂'); q('.k-want', p.icon); q('b', p.label);
      q('small', staff ? 'A barista is on it' : mine ? 'In your kitchen' : `${Math.max(0, Math.round(cu.patience))}s left`);
      el.querySelector('u').style.width = `${Math.round(frac * 100)}%`;
      el.setAttribute('aria-label', `${p.label} for ${cu.def?.label || 'customer'}, ${Math.round(cu.patience)} seconds of patience left${mine ? ', in your kitchen' : ''}${staff ? ', a barista is on it' : ''}`);
      el.setAttribute('aria-pressed', String(L.selected === o.id));
      el.disabled = staff;
      el.style.order = String(i);
    });
    for (const [id, el] of this.cards) if (!ids.has(id)) { el.remove(); this.cards.delete(id); }
    this.$('#k-empty').hidden = ids.size > 0;

    // ---- recipe of the selected ticket
    const t = L.ticket, o = L.selected ? L.orderById(L.selected) : null;
    const recipe = this.$('#k-recipe');
    const rhtml = t && o ? `<span class="k-rl">${esc(products[o.pid].label)}:</span>${Object.entries(t.steps).map(([s, v]) => `<span class="k-step ${v}"><i>${L.stations[s].icon}</i>${v === 'done' ? '✓' : ''}</span>`).join('')}`
      : '<span class="k-hint">Tap a customer to take their order, then tap the stations it needs.</span>';
    if (recipe._h !== rhtml) { recipe.innerHTML = rhtml; recipe._h = rhtml; }

    // ---- stations
    const need = new Set(L.nextStations());
    for (const [sid, btn] of Object.entries(this.stationEls)) {
      const j = L.jobs[sid];
      let cls = 'k-st', p = 0;
      if (j?.state === 'working') { cls += ' working'; p = j.t / j.dur; }
      else if (j?.state === 'ready') { cls += j.age > L.k.okSeconds ? ' late' : j.age > L.k.sweetSeconds ? ' ok' : ' ready'; p = 1; }
      else if (j?.state === 'burnt') { cls += ' burnt'; p = 1; }
      else if (need.has(sid)) cls += ' need';
      if (btn.className !== cls) btn.className = cls;
      btn.style.setProperty('--p', p.toFixed(3));
    }

    // ---- header, message, footer
    const mult = L.comboMult;
    this.setText('#k-combo', `Combo x${L.combo}${L.combo ? ` · tips x${mult.toFixed(2)}` : ''}`);
    this.setText('#k-tips', money(L.session.tips, 2)); this.setText('#k-served', String(L.session.served));
    this.$('#k-combo').classList.toggle('on', L.combo > 0);
    const note = L.note;
    if (note && note.id !== this.noteSeen) { this.noteSeen = note.id; this.noteTimer = 2.6; const n = this.$('#k-note'); n.textContent = note.text; n.className = `k-note ${note.kind}`; }
    if (this.noteTimer <= 0 && this.$('#k-note').textContent) { const n = this.$('#k-note'); n.textContent = ''; n.className = 'k-note'; }
    const low = Object.entries(c.cfg.ingredients).filter(([id, ing]) => (c.stock[id] ?? 0) <= ing.cap * 0.2).map(([, ing]) => `${ing.icon} ${esc(ing.label)}`);
    const foot = `Served today <b>${c.today.served}</b> · <b>${money(c.today.revenue, 2)}</b>${low.length ? ` · <span class="k-low">Low: ${low.join(' · ')}</span>` : ''}`;
    const f = this.$('#k-foot'); if (f._h !== foot) { f.innerHTML = foot; f._h = foot; }
  }

  setText(sel, v) { const n = this.$(sel); if (n.textContent !== v) n.textContent = v; }
}
