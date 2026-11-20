// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { Input } from '../src/core/Input.js';

let input;
const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true }));
const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
beforeEach(() => { document.body.innerHTML = '<canvas id="c"></canvas><div id="joy-zone"><div id="joy-base"><div id="joy-knob"></div></div></div>'; input = new Input(new EventBus(), document.getElementById('c')); });
afterEach(() => input.dispose());

describe('movement keys: Space replaces the Down arrow', () => {
  it('Space moves down / back, like S', () => {
    down('Space'); input.update(); expect(input.move.y).toBe(-1); up('Space');
    input.update(); expect(input.move.y).toBe(0);
    down('KeyS'); input.update(); expect(input.move.y).toBe(-1);
  });

  it('the Down arrow no longer moves the character', () => {
    down('ArrowDown'); input.update();
    expect(input.move.y).toBe(0);
  });

  it('the other keys are unchanged', () => {
    down('KeyW'); input.update(); expect(input.move.y).toBe(1); up('KeyW');
    down('ArrowUp'); input.update(); expect(input.move.y).toBe(1); up('ArrowUp');
    down('ArrowLeft'); input.update(); expect(input.move.x).toBe(-1); up('ArrowLeft');
    down('ArrowRight'); input.update(); expect(input.move.x).toBe(1);
  });

  it('Space does not scroll the page', () => {
    const e = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});