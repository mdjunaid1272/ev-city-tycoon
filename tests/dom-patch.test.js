// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { patchHtml } from '../src/ui/domPatch.js';

let root;
beforeEach(() => { document.body.innerHTML = '<div id="r"></div>'; root = document.getElementById('r'); });

describe('domPatch', () => {
  it('updates text and attributes without replacing unchanged nodes', () => {
    root.innerHTML = '<h2>T</h2><div class="kv"><span>a</span><b>1</b></div><button class="btn">x</button>';
    const [h2, kv, btn] = root.children;
    patchHtml(root, '<h2>T</h2><div class="kv"><span>a</span><b>2</b></div><button class="btn" disabled>x</button>');
    expect(root.children[0]).toBe(h2); expect(root.children[1]).toBe(kv); expect(root.children[2]).toBe(btn);
    expect(kv.querySelector('b').textContent).toBe('2');
    expect(btn.disabled).toBe(true);
  });

  it('adds, removes and replaces nodes when the structure changes', () => {
    root.innerHTML = '<p>a</p><p>b</p><p>c</p>';
    patchHtml(root, '<p>a</p><div>b</div>');
    expect([...root.children].map((e) => e.tagName)).toEqual(['P', 'DIV']);
    patchHtml(root, '<p>a</p><div>b</div><span>new</span>');
    expect(root.children).toHaveLength(3);
  });

  it('removes attributes that disappeared', () => {
    root.innerHTML = '<button class="btn" disabled data-x="1">x</button>';
    const b = root.firstElementChild;
    patchHtml(root, '<button class="btn">x</button>');
    expect(root.firstElementChild).toBe(b);
    expect(b.hasAttribute('disabled')).toBe(false);
    expect(b.hasAttribute('data-x')).toBe(false);
  });

  it('keeps what the player typed in a focused input, but updates inputs they are not using', () => {
    root.innerHTML = '<input id="a" value="1"><input id="b" value="1">';
    const [a, b] = root.querySelectorAll('input');
    a.focus(); a.value = 'typed';
    patchHtml(root, '<input id="a" value="9"><input id="b" value="9">');
    expect(a.value).toBe('typed');
    expect(b.value).toBe('9');
  });

  it('keeps keyboard focus on a button that survives the patch', () => {
    root.innerHTML = '<button id="k">Buy $10</button>';
    const k = root.firstElementChild; k.focus();
    patchHtml(root, '<button id="k">Buy $20</button>');
    expect(document.activeElement).toBe(k);
    expect(k.textContent).toBe('Buy $20');
  });

  it('handles empty content and identical content', () => {
    root.innerHTML = '<p>x</p>';
    patchHtml(root, '<p>x</p>'); expect(root.innerHTML).toBe('<p>x</p>');
    patchHtml(root, ''); expect(root.innerHTML).toBe('');
  });
});
