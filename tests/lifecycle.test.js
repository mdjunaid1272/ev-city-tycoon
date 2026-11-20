// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Disposables } from '../src/core/Disposables.js';
import { EventBus } from '../src/core/EventBus.js';
import { Input } from '../src/core/Input.js';
import { AdService } from '../src/core/AdService.js';
import { TutorialManager } from '../src/ui/TutorialManager.js';
import { makeUI } from './ui-helpers.js';

/** Records every addEventListener / removeEventListener on the given targets so leaks show up as a non-empty list. */
function trackListeners(...targets) {
  const live = new Map(); // key -> {target, type, fn}
  const spies = [];
  const keyOf = (t, type, fn, opts) => { const capture = typeof opts === 'boolean' ? opts : !!opts?.capture; return `${targets.indexOf(t)}|${type}|${capture}|${fn.__id || (fn.__id = Math.random())}`; };
  for (const t of targets) {
    const add = t.addEventListener.bind(t), rem = t.removeEventListener.bind(t);
    spies.push(vi.spyOn(t, 'addEventListener').mockImplementation((type, fn, opts) => { live.set(keyOf(t, type, fn, opts), type); return add(type, fn, opts); }));
    spies.push(vi.spyOn(t, 'removeEventListener').mockImplementation((type, fn, opts) => { live.delete(keyOf(t, type, fn, opts)); return rem(type, fn, opts); }));
  }
  return { live, left: () => [...live.values()] };
}

describe('Disposables', () => {
  it('removes listeners, bus subscriptions and timers, and can be disposed repeatedly', () => {
    vi.useFakeTimers();
    const d = new Disposables(), bus = new EventBus(), target = new EventTarget();
    const onEvt = vi.fn(), onBus = vi.fn(), onTimer = vi.fn(), onInterval = vi.fn();
    d.listen(target, 'ping', onEvt);
    d.subscribe(bus, 'x', onBus);
    d.timeout(onTimer, 100);
    d.interval(onInterval, 50);
    expect(d.size).toBe(4);
    d.dispose(); d.dispose();
    target.dispatchEvent(new Event('ping')); bus.emit('x'); vi.advanceTimersByTime(1000);
    expect([onEvt, onBus, onTimer, onInterval].map((f) => f.mock.calls.length)).toEqual([0, 0, 0, 0]);
    expect(bus.count()).toBe(0);
    vi.useRealTimers();
  });

  it('a failing cleanup does not stop the others', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = new Disposables(), ok = vi.fn();
    d.add(ok); d.add(() => { throw new Error('boom'); });
    expect(() => d.dispose()).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
  });

  it('something registered after disposal is cleaned up immediately instead of leaking', () => {
    const d = new Disposables(); d.dispose();
    const f = vi.fn(); d.add(f);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('EventBus teardown', () => {
  it('count() and clear() report and remove every subscription; unsubscribing twice is harmless', () => {
    const bus = new EventBus();
    const off = bus.on('a', () => {}); bus.on('a', () => {}); bus.on('b', () => {});
    expect(bus.count('a')).toBe(2); expect(bus.count()).toBe(3);
    off(); off();
    expect(bus.count('a')).toBe(1);
    bus.clear();
    expect(bus.count()).toBe(0);
    expect(() => bus.emit('a')).not.toThrow();
  });
});

describe('Input.dispose', () => {
  let canvas;
  beforeEach(() => {
    document.body.innerHTML = '<canvas id="c"></canvas><div id="joy-zone"><div id="joy-base"><div id="joy-knob"></div></div></div>';
    canvas = document.getElementById('c');
  });
  afterEach(() => vi.restoreAllMocks());

  it('removes every window / canvas / joystick listener it added', () => {
    const rec = trackListeners(window, canvas, document.getElementById('joy-zone'));
    const input = new Input(new EventBus(), canvas);
    expect(rec.left().length).toBeGreaterThan(8);
    input.dispose();
    expect(rec.left()).toEqual([]);
  });

  it('is safe to dispose twice and stops publishing events', () => {
    const bus = new EventBus(), seen = vi.fn();
    bus.on('input:key', seen);
    const input = new Input(bus, canvas);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(seen).toHaveBeenCalledTimes(1);
    input.dispose(); input.dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(input.keys.size).toBe(0);
  });

  it('recreating the input after disposal gives exactly one handler (no duplicate events)', () => {
    const bus = new EventBus(), seen = vi.fn();
    bus.on('input:key', seen);
    new Input(bus, canvas).dispose();
    const second = new Input(bus, canvas);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    expect(seen).toHaveBeenCalledTimes(1);
    second.dispose();
  });
});

describe('UIManager.dispose', () => {
  it('unsubscribes every bus handler it registered and removes its global listeners', () => {
    const { ui, w } = makeUI();
    const afterBind = w.bus.count();
    expect(afterBind).toBeGreaterThan(40); // the UI really subscribes to many events
    ui.dispose();
    // what is left belongs to other systems (stats tracker, customers, ...): no UI handler remains
    const left = w.bus.count();
    expect(left).toBeLessThan(afterBind - 40);
    expect(ui._listeners).toHaveLength(0);
    expect(ui._offs).toHaveLength(0);
  });

  it('is safe to call twice and a disposed UI no longer reacts to events', () => {
    const { ui, w } = makeUI();
    const toast = vi.spyOn(ui, 'toast');
    ui.dispose(); ui.dispose();
    w.bus.emit('toast', { text: 'hello', kind: 'good' });
    w.bus.emit('mission:complete', { mission: { title: 'x', reward: {} } });
    expect(toast).not.toHaveBeenCalled();
  });

  it('a second UI created after disposal handles an event exactly once', () => {
    const first = makeUI();
    first.ui.dispose();
    const { ui, w } = makeUI();
    const toast = vi.spyOn(ui, 'toast').mockImplementation(() => {});
    w.bus.emit('toast', { text: 'once', kind: '' });
    expect(toast).toHaveBeenCalledTimes(1);
    ui.dispose();
  });

  it('removes the floating terminal button and clears blocking state', () => {
    const { ui } = makeUI();
    ui.game.stationView = { terminalPos: new THREE.Vector3(0, 0, 0) };
    ui.game.player = { pos: new THREE.Vector3(0, 0, 0) };
    ui.game.sm = { camera: new THREE.PerspectiveCamera() };
    ui.game.camera = { inManagement: false, transitioning: false };
    ui.updateTerminalButton();
    expect(document.getElementById('term-open')).toBeTruthy();
    ui.dispose();
    expect(document.getElementById('term-open')).toBeNull();
    expect(document.getElementById('hud').inert).toBe(false);
  });
});

describe('TutorialManager.dispose', () => {
  it('can be called repeatedly and removes all of its global listeners', () => {
    makeUI(); // the real index.html markup (tutorial panel, hint, buttons, joystick)
    const tutorialEl = document.getElementById('tutorial');
    const rec = trackListeners(window, tutorialEl);
    const game = { paused: false, touch: false, save() {}, stats: { total: { served: 0 } }, stationView: { interactables: [], terminalPos: { x: 0, z: 0 } }, station: { bays: [] }, player: { pos: { x: 0, z: 0 } }, ui: {}, employees: { employees: [] }, camera: {}, sm: { camera: new THREE.PerspectiveCamera() } };
    const bus = new EventBus();
    const t = new TutorialManager({ game, bus, scene: new THREE.Scene(), saved: null, isNew: true });
    expect(rec.left().length).toBeGreaterThan(0);
    expect(bus.count()).toBeGreaterThan(0);
    t.dispose(); t.dispose();
    expect(rec.left()).toEqual([]);
    expect(bus.count()).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('AdService.dispose', () => {
  it('closes a running demo ad and stops its timer', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const ads = new AdService();
    const p = ads.showRewarded('offline-2x');
    expect(document.getElementById('ad-overlay')).toBeTruthy();
    expect(ads.timers.size).toBe(1);
    ads.dispose(); ads.dispose();
    expect(document.getElementById('ad-overlay')).toBeNull();
    expect(ads.timers.size).toBe(0);
    vi.advanceTimersByTime(5000); // the countdown must not touch the removed overlay
    void p;
    vi.useRealTimers();
  });
});
