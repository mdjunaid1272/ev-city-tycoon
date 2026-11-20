/**
 * Minimal DOM patcher: make `target`'s children equal to the children of `source` (parsed from fresh HTML) while keeping every
 * node that did not change. Unchanged nodes keep their identity, so keyboard focus, scroll position, text selection, open <select>s,
 * running CSS transitions and a pointer press in progress all survive a refresh. Only text, attributes and the nodes that
 * really differ are touched.
 */
const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

function syncAttributes(a, b) {
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
}

function syncControl(a, b) {
  // a control the player is using keeps its live value; any other control follows the fresh HTML
  if (a === document.activeElement) return;
  if (a.nodeName === 'INPUT' && (a.type === 'checkbox' || a.type === 'radio')) { if (a.checked !== b.checked) a.checked = b.checked; }
  else if (a.value !== b.value) a.value = b.value;
}

export function patchChildren(target, source) {
  const have = [...target.childNodes], want = [...source.childNodes];
  const n = Math.max(have.length, want.length);
  for (let i = 0; i < n; i++) {
    const x = have[i], y = want[i];
    if (!y) { x.remove(); continue; }
    if (!x) { target.appendChild(y.cloneNode(true)); continue; }
    if (!sameKind(x, y)) { target.replaceChild(y.cloneNode(true), x); continue; }
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; } // text / comment
    syncAttributes(x, y);
    if (x.nodeName === 'INPUT' || x.nodeName === 'SELECT' || x.nodeName === 'TEXTAREA') syncControl(x, y);
    patchChildren(x, y);
    if (x.nodeName === 'SELECT') syncControl(x, y); // options are patched first, then the chosen value
  }
}

/** Replace the content of `el` with `html`, patching in place. Returns true when something had to change. */
export function patchHtml(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(el, tpl.content);
}
