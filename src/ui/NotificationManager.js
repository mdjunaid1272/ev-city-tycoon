import { $, icon } from './uiShared.js';

/**
 * Toasts and floating money labels.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const NotificationManager = {
  /** Toast kinds: good (success) · warn · error · info. Untyped messages are classified from their text. */
  toastKind(text) {
    if (/not enough|insufficient|no (available|free)|\bfull\b|capacity|too expensive|limit|out of parts|left|unhappy|quit|failed|reputation −/i.test(text)) return 'warn';
    if (/cannot|can't|could not|couldn't|invalid|unavailable|refused|unlocks at|permit first|already|no .* connector|not available|missing|in the way|occupied|outside|keep driveways|you do not own/i.test(text)) return 'error';
    return 'info';
  },

  toast(text, kind = '') {
    if (!kind) kind = this.toastKind(String(text));
    const ic = { good: 'check', warn: 'warn', error: 'error', info: 'info' }[kind] || 'info';
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = `<span class="ti">${icon(ic, 18)}</span><span class="tt"></span>`;
    t.querySelector('.tt').textContent = text;
    $('toasts').appendChild(t);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
    setTimeout(() => t.remove(), 3500);
  },

  floater(text) {
    const f = document.createElement('div');
    f.className = 'floater';
    f.textContent = text;
    $('floaters').appendChild(f);
    setTimeout(() => f.remove(), 1700);
  },
};
