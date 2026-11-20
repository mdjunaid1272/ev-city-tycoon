import { esc } from '../uiShared.js';

/**
 * One place that builds button markup, so every panel uses the same classes.
 * kind: 'primary' (default, blue) | 'secondary' (outlined) | 'danger' (red) ; attrs: extra attributes as an object.
 */
export function buttonHtml(label, { kind = 'primary', disabled = false, attrs = {}, raw = false } = {}) {
  const cls = ['btn', kind === 'secondary' ? 'ghost' : kind === 'danger' ? 'danger' : ''].filter(Boolean).join(' ');
  const extra = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return `<button class="${cls}"${extra}${disabled ? ' disabled' : ''}>${raw ? label : esc(label)}</button>`;
}
