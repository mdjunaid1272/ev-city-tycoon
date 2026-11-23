import { esc, money } from './uiShared.js';

/**
 * Live order board for the café: shown while the player is INSIDE the café (street view, no board open).
 * Lists every open order with its product, customer, patience / progress and who is on it; tapping a waiting order tells
 * the owner to take it next (OwnerWork.prefer). Footer: served today, revenue today and low ingredients.
 * One DOM element, re-rendered at ~4 Hz and only when the content changed.
 */
const REFRESH = 0.25;
const MAX_ROWS = 6;

export class CafeOrderBoard {
  constructor({ game, doc = document }) {
    this.g = game;
    this.doc = doc;
    this.t = 0;
    this.key = '';
    this.collapsed = false;
    const el = this.el = doc.createElement('section');
    el.id = 'cafe-board'; el.className = 'hidden'; el.setAttribute('aria-label', 'Café orders');
    // taps on the board never walk the character or rotate the camera
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) el.addEventListener(ev, (e) => e.stopPropagation());
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-cb-order]')) { e.preventDefault(); this.onClick(e); } });
    doc.body.appendChild(el);
  }

  dispose() { this.el?.remove(); this.el = null; }

  get open() {
    const g = this.g;
    return !!(g.cafe?.built && g.cafeView?.inside && !g.ui?.modal && !g.paused && !g.camera?.inManagement && !g.cozyUI?.isOpen);
  }

  onClick(e) {
    const t = e.target.closest?.('[data-cb]'), row = e.target.closest?.('[data-cb-order]');
    if (t?.dataset.cb === 'manage') { this.g.ui.open('cafe'); return; }
    if (t?.dataset.cb === 'fold') { this.collapsed = !this.collapsed; this.key = ''; this.render(); return; }
    if (row) {
      const key = row.dataset.cbOrder;
      this.g.ownerWork?.prefer(key);
      this.g.bus.emit('toast', { text: 'You will take this order next.', kind: 'info' });
    }
  }

  update(dt) {
    if (!this.el) return;
    const show = this.open;
    if (this.el.classList.contains('hidden') === show) this.el.classList.toggle('hidden', !show);
    if (!show) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = REFRESH;
    this.render();
  }

  rows() {
    const c = this.g.cafe, ow = this.g.ownerWork, mine = ow?.task?.key;
    return c.orders.slice(0, MAX_ROWS).map((o) => {
      const p = c.cfg.products[o.pid], cu = o.customer, key = `cafe:${o.id}`;
      const preparing = o.state === 'preparing';
      const you = preparing && (mine === key || o.by === 'owner');
      const left = Math.max(0, Math.round(cu.patience));
      return {
        key, icon: p.icon, name: p.label, who: cu.def?.label || 'Customer', preparing, you, prog: o.progress || 0,
        frac: Math.max(0, Math.min(1, cu.patience / Math.max(1, cu.maxPatience))), left, next: ow?.preferKey === key,
      };
    });
  }

  render() {
    const c = this.g.cafe, rows = this.rows(), total = c.orders.length, t = c.today;
    const low = Object.entries(c.cfg.ingredients).filter(([id, ing]) => (c.stock[id] ?? 0) <= ing.cap * 0.2).map(([, ing]) => `${ing.icon} ${esc(ing.label)}`);
    const key = JSON.stringify([this.collapsed, total, rows.map((r) => [r.key, r.preparing, r.you, Math.round(r.prog * 20), Math.round(r.frac * 20), r.next]), t.served, Math.round(t.revenue), low.join()]);
    if (key === this.key) return;
    this.key = key;
    const list = rows.length ? rows.map((r) => {
      const bar = r.preparing ? `<i class="go" style="width:${Math.round(r.prog * 100)}%"></i>` : `<i class="${r.frac < 0.34 ? 'hot' : r.frac < 0.67 ? 'mid' : 'ok'}" style="width:${Math.round(r.frac * 100)}%"></i>`;
      const tag = r.preparing ? `<em class="${r.you ? 'me' : ''}">${r.you ? 'You' : 'Barista'} ${Math.round(r.prog * 100)}%</em>` : `<em class="${r.next ? 'me' : ''}">${r.next ? 'Next' : 'Tap: take'}</em>`;
      const sub = r.preparing ? esc(r.who) : `${esc(r.who)} · ${r.left}s left`;
      return `<li><div class="cb-o${r.preparing ? ' busy' : ''}" ${r.preparing ? '' : `role="button" tabindex="0" data-cb-order="${r.key}"`} aria-label="${esc(r.name)} for ${esc(r.who)}">
        <span class="cb-i" aria-hidden="true">${r.icon}</span><div class="cb-m"><b>${esc(r.name)}</b><small>${sub}</small><div class="cb-b">${bar}</div></div>${tag}</div></li>`;
    }).join('') : '<li class="cb-empty">No orders right now.<br>Customers queue at the counter.</li>';
    const more = total > rows.length ? `<li class="cb-more">+${total - rows.length} more waiting</li>` : '';
    this.el.innerHTML = `<div class="cb-h"><b>☕ Orders</b><span class="cb-n">${total}</span>
        <button type="button" data-cb="fold" aria-expanded="${!this.collapsed}" aria-label="${this.collapsed ? 'Show' : 'Hide'} orders">${this.collapsed ? '▾' : '▴'}</button>
        <button type="button" data-cb="manage" aria-label="Open the café manager">⚙</button></div>`
      + (this.collapsed ? '' : `<ul class="cb-list">${list}${more}</ul>
        <div class="cb-f">Served today <b>${t.served}</b> · <b>${money(t.revenue, 2)}</b>${low.length ? `<div class="cb-low">Low: ${low.join(' · ')}</div>` : ''}</div>`);
  }
}
