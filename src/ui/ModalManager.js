import { $, esc, money, CONFIRM_COST } from './uiShared.js';

/**
 * Blocking dialogs, keyboard focus handling, the confirmation dialog and purchase guard.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const ModalManager = {
  // ---------- keyboard focus + blocking dialogs ----------
  /** Boards that must be answered before anything behind them can be used. */
  get blocking() { return !!this.confirmOpen || ['pause', 'offline', 'login', 'stageup', 'report'].includes(this.modal) || (!!this.modal && !!this.game.paused); },

  /** While a blocking dialog is open the world UI behind it can be neither clicked nor tabbed to. */
  syncBlocking() {
    const hud = $('hud'), modal = $('modal');
    const hudOff = this.blocking, modalOff = !!this.confirmOpen;
    if (hud.inert !== hudOff) hud.inert = hudOff;
    if (modal.inert !== modalOff) modal.inert = modalOff;
  },

  focusables(root) {
    return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null && el.getAttribute('tabindex') !== '-1');
  },

  focusInto(root) {
    if (!root) return;
    root.focus({ preventScroll: true }); // the dialog itself: the next Tab lands on its first control
  },

  restoreFocus() {
    const el = this._returnFocus; this._returnFocus = null;
    if (el && el.isConnected && typeof el.focus === 'function' && el !== document.body) { try { el.focus({ preventScroll: true }); } catch (e) { /* element is gone */ } }
  },

  /** Tab / Shift+Tab never leave the open dialog. */
  trapTab(e) {
    if (e.key !== 'Tab') return;
    const root = this.confirmOpen ? $('confirm-card') : this.modal ? $('modal-card') : null;
    if (!root) return;
    const list = this.focusables(root);
    if (!list.length) { e.preventDefault(); root.focus(); return; }
    const first = list[0], last = list[list.length - 1], at = document.activeElement;
    if (!root.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (at === first || at === root)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  },

  // ---------- confirmation dialog (expensive purchases, destructive actions) ----------
  /** Resolves true/false. `danger` styles the confirm button as destructive. */
  askConfirm({ title, text, yes = 'Confirm', no = 'Cancel', danger = false }) {
    if (this.confirmOpen) this.resolveConfirm(false);
    return new Promise((resolve) => {
      this._confirmReturn = document.activeElement;
      this.confirmOpen = resolve;
      $('confirm-card').innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p>
        <div class="row"><button class="btn ghost" data-cf="no">${esc(no)}</button><button class="btn ${danger ? 'danger solid' : ''}" data-cf="yes">${esc(yes)}</button></div>`;
      $('confirm').classList.remove('hidden');
      $('confirm-card').querySelector('[data-cf="no"]').onclick = () => this.resolveConfirm(false);
      $('confirm-card').querySelector('[data-cf="yes"]').onclick = () => this.resolveConfirm(true);
      $('confirm').onpointerdown = (e) => { if (e.target === $('confirm')) this.resolveConfirm(false); };
      this.syncBlocking();
      $('confirm-card').querySelector('[data-cf="no"]').focus({ preventScroll: true }); // the safe answer is focused first
    });
  },

  resolveConfirm(v) {
    const r = this.confirmOpen;
    if (!r) return;
    this.confirmOpen = null;
    $('confirm').classList.add('hidden');
    this.syncBlocking();
    const back = this._confirmReturn; this._confirmReturn = null;
    if (back && back.isConnected && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
    r(v);
  },

  /** Run `fn` straight away for cheap actions; ask first when the price reaches CONFIRM_COST. */
  guard(cost, what, fn) {
    if (cost < CONFIRM_COST) return fn();
    this.askConfirm({ title: 'Confirm purchase', text: `${what} for ${money(cost)}?`, yes: `Buy · ${money(cost)}` }).then((ok) => { if (ok) { fn(); if (this.modal) this.renderModal(); } });
  },
};
