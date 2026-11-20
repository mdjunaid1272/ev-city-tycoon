import { $, esc, money, icon, DECOR_CATS } from './uiShared.js';

/**
 * Build (decorate) mode toolbar.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const BuildPanel = {
  // ----- decoration bar (management mode) -----
  /** Build-mode toolbar: categories, items with cost, info, placement feedback, rotate / undo / redo / remove / confirm / cancel. */
  decorBarHtml(st) {
    const pm = this.placement, all = pm.items;
    const cats = Object.entries(DECOR_CATS).map(([name, ids]) => [name, ids.filter((id) => all[id])]).filter(([, ids]) => ids.length);
    const known = new Set(cats.flatMap(([, ids]) => ids));
    const other = Object.keys(all).filter((id) => !known.has(id));
    if (other.length) cats.push(['Other', other]);
    const catName = cats.some(([n]) => n === this.decorCat) ? this.decorCat : cats[0][0];
    const shown = cats.find(([n]) => n === catName)[1];
    const sel = st.item ? all[st.item] : null;
    const placing = st.mode === 'place' && st.item;
    const msg = st.mode === 'remove' ? 'Click a decoration to remove it (50% refund).' : !st.item ? 'Pick something to build.' : !st.pos ? 'Move over one of your lots.' : st.valid?.ok ? `Valid spot${this.game.touch ? ': tap Confirm' : ': click or press Confirm to buy'}` : (st.valid?.reason || '');
    const cls = st.mode === 'place' && st.pos ? (st.valid?.ok ? 'ok' : 'bad') : '';
    const eff = st.pos ? pm.effects(st.pos.lot) : null;
    const info = sel && st.mode === 'place' ? `${sel.blurb} · ${money(sel.cost)}${sel.comfort ? ` · comfort +${sel.comfort}` : ''}${sel.appeal ? ` · appeal +${Math.round(sel.appeal * 1000) / 10}%` : ''}${sel.night ? ` · night +${Math.round(sel.night * 100)}%` : ''}` : '';
    const btn = (a, ic, label, extra = '', dis = false) => `<button class="btn ${extra}" data-decor="${a}" ${dis ? 'disabled' : ''}>${icon(ic, 18)}${label}</button>`;
    return `<div class="db-head"><div class="db-title">${icon('build', 18)}Build mode</div>
        <div class="db-cats">${cats.map(([n]) => `<button class="chip ${n === catName ? 'on' : ''}" data-decor="cat:${n}">${esc(n)}</button>`).join('')}</div>
        <button class="ibtn" data-decor="done" title="Exit build mode" aria-label="Exit build mode">${icon('close', 18)}</button></div>
      <div class="db-items">${shown.map((k) => { const it = all[k]; return `<button class="db-item ${st.item === k && st.mode === 'place' ? 'on' : ''} ${this.economy.canAfford(it.cost) ? '' : 'poor'}" data-decor="item:${k}" title="${esc(it.blurb)}"><span>${it.icon}</span>${esc(it.label)}<small>${money(it.cost)}</small></button>`; }).join('')}</div>
      <div class="db-info">${esc(info)}</div>
      <div class="db-ctl">
        ${btn('rotate', 'rotate', 'Rotate (T)', 'ghost', !placing)}
        ${pm.canUndo || pm.canRedo ? btn('undo', 'undo', 'Undo', 'ghost', !pm.canUndo) + btn('redo', 'redo', 'Redo', 'ghost', !pm.canRedo) : ''}
        ${btn('remove', 'trash', 'Remove', st.mode === 'remove' ? '' : 'ghost')}
        ${placing ? btn('confirm', 'check', 'Confirm', '', !st.pos || !st.valid?.ok) : ''}
        ${placing || st.mode === 'remove' ? btn('cancel', 'close', 'Cancel', 'ghost') : ''}
      </div>
      <div class="db-msg ${cls}">${esc(msg)}${eff ? ` · this lot: comfort +${eff.comfort.toFixed(1)}, appeal +${Math.round(eff.appeal * 100)}%` : ''}</div>`;
  },

  renderDecorBar(st = null) {
    const bar = $('decor-bar');
    const state = st || { active: this.decor.active, mode: this.decor.mode, item: this.decor.item, pos: this.decor.pos, valid: this.decor.valid };
    bar.classList.toggle('hidden', !this.decorOpen);
    document.body.classList.toggle('decor-open', !!this.decorOpen);
    if (!this.decorOpen) return;
    bar.innerHTML = this.decorBarHtml(state);
    bar.querySelectorAll('[data-decor]').forEach((b) => (b.onclick = () => {
      const [a, v] = b.dataset.decor.split(':');
      if (a === 'item') this.decor.start(v);
      else if (a === 'cat') { this.decorCat = v; this.renderDecorBar(); }
      else if (a === 'rotate') this.decor.rotate();
      else if (a === 'remove') this.decor.startRemove();
      else if (a === 'confirm') { const r = this.decor.confirm(); if (r?.ok) this.toast(`${this.placement.items[this.decor.item]?.label || 'Item'} built`, 'good'); }
      else if (a === 'cancel') { this.decor.cancel(); this.renderDecorBar(); }
      else if (a === 'undo' || a === 'redo') { const r = this.placement[a](); this.toast(r.ok ? r.what : r.reason, r.ok ? 'info' : 'warn'); this.renderDecorBar(); }
      else if (a === 'done') this.closeDecor();
    }));
  },

  openDecor() {
    if (this.camera.mode !== 'management') return;
    this.decorOpen = true;
    this.clearSelection();
    this.placement.clearHistory();
    this.renderDecorBar();
  },

  closeDecor() {
    this.decorOpen = false;
    this.decor.cancel();
    this.placement.clearHistory();
    this.renderDecorBar();
  },
};
