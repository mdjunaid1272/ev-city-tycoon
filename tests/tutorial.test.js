// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../src/core/EventBus.js';
import { TutorialManager } from '../src/ui/TutorialManager.js';

const DOM = `
  <div id="tutorial" class="hidden"><span id="tut-title"></span><span id="tut-prog"></span><i id="tut-fill"></i><p id="tut-text"></p>
    <div id="tut-goal"><span id="tut-check"></span><span id="tut-obj"></span></div><button id="tut-next"></button><button id="tut-skip"></button></div>
  <div id="tut-hint" class="hidden"></div><div id="joy-base"></div>`;

function setup({ saved = null, isNew = true, touch = false, bays = null } = {}) {
  document.body.innerHTML = DOM;
  document.body.className = '';
  delete window.__NO_TUTORIAL;
  const bus = new EventBus(), scene = new THREE.Scene();
  const game = {
    paused: false, touch, save: vi.fn(), stats: { total: { served: 0 } },
    stationView: { interactables: [{ id: 'bay0', pos: { x: -5, z: 0 } }, { id: 'bay1', pos: { x: 5, z: 0 } }, { id: 'bay2', pos: { x: -15, z: 0 } }], terminalPos: { x: -14, z: -11 } },
    station: { bays: bays || [{ unlocked: true, state: 'empty' }, { unlocked: true, state: 'empty' }, { unlocked: false, state: 'empty' }] },
    player: { pos: { x: 0, z: 0 } }, ui: { modal: null, confirmOpen: null }, employees: { employees: [] },
    camera: { inManagement: false, mg: { dist: 70 } }, sm: { camera: new THREE.PerspectiveCamera() },
  };
  const t = new TutorialManager({ game, bus, scene, saved, isNew });
  return { t, game, bus, scene };
}
const walk = (t, game, metres, step = 0.3) => { for (let d = 0; d < metres; d += step) { game.player.pos.x += step; t.update(0.05); } };

describe('tutorial: movement instructions', () => {
  it('shows keyboard / mouse instructions on desktop and joystick instructions on touch devices', () => {
    const d = setup();
    expect(document.getElementById('tut-hint').textContent).toMatch(/WASD|mouse/i);
    expect(document.getElementById('tut-hint').textContent).not.toMatch(/joystick/i);
    const m = setup({ touch: true });
    expect(document.getElementById('tut-hint').textContent).toMatch(/joystick/i);
    expect(document.getElementById('tut-hint').textContent).toMatch(/bottom-left/i);
    d.t.dispose(); m.t.dispose();
  });

  it('a real touch event switches a desktop-detected session to the joystick wording', () => {
    const { t } = setup();
    expect(document.getElementById('tut-hint').textContent).not.toMatch(/joystick/i);
    window.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType: 'touch' }));
    expect(document.getElementById('tut-hint').textContent).toMatch(/joystick/i);
    t.dispose();
  });

  it('no tutorial hints mention the E key any more (charging stops by clicking, the manager opens from its button)', () => {
    const { t } = setup();
    const seen = [];
    for (let i = 0; i < 8; i++) { t.begin(i, false); seen.push(document.getElementById('tut-hint').textContent); }
    expect(seen.filter((s) => /\bE\b|press E|tap E/.test(s))).toEqual([]);
    t.dispose();
  });
});

describe('tutorial: target selection', () => {
  it('targets the bay in the requested state and never falls back to an arbitrary bay', () => {
    const { t, game } = setup();
    expect(t.targets.bay(['waiting', 'charging'])).toBeNull(); // every bay empty: nothing to point at
    game.station.bays[1].state = 'charging';
    expect(t.targets.bay(['waiting', 'charging'])).toMatchObject({ x: 5, z: 0 });
    game.station.bays[0].state = 'waiting';
    expect(t.targets.bay(['waiting', 'charging'])).toMatchObject({ x: -5 }); // 'waiting' is preferred over 'charging'
    t.dispose();
  });

  it('ignores locked bays even when their state matches', () => {
    const { t, game } = setup();
    game.station.bays[2].state = 'waiting'; // locked
    expect(t.targets.bay(['waiting'])).toBeNull();
    expect(t.targets.anyBay(['waiting'])).toBe(false);
    t.dispose();
  });

  it('the marker is hidden while there is no valid target and appears when one exists', () => {
    const { t, game } = setup();
    t.begin(1, false);
    t.update(0.05);
    expect(t.marker.visible).toBe(false);
    game.station.bays[0].state = 'waiting';
    t.update(0.05);
    expect(t.marker.visible).toBe(true);
    expect(t.marker.position.x).toBe(-5);
    t.dispose();
  });

  it('the terminal step points at the terminal position', () => {
    const { t } = setup();
    expect(t.targets.terminal()).toMatchObject({ x: -14, z: -11 });
    t.dispose();
  });
});

describe('tutorial: pause and resume', () => {
  it('walking progress is measured in small steps; teleports and paused time do not count', () => {
    const { t, game } = setup();
    walk(t, game, 4);
    expect(t.n.walked).toBeGreaterThan(3.5);
    game.player.pos.x += 80; t.update(0.05); // fast travel
    expect(t.n.walked).toBeLessThan(5);
    game.paused = true; walk(t, game, 20); // moving while paused
    expect(t.n.walked).toBeLessThan(5);
    t.dispose();
  });

  it('the success countdown does not run while paused and continues afterwards', () => {
    const { t, game } = setup();
    t.begin(1, false);
    t.state = 'ok'; t.okTimer = 1;
    game.paused = true;
    for (let i = 0; i < 100; i++) t.update(0.1);
    expect(t.state).toBe('ok'); expect(t.step).toBe(1); expect(t.okTimer).toBe(1);
    game.paused = false;
    for (let i = 0; i < 9; i++) t.update(0.1); expect(t.step).toBe(1);
    for (let i = 0; i < 3; i++) t.update(0.1);
    expect(t.step).toBe(2);
    t.dispose();
  });

  it('a goal reached while paused only counts once the game resumes; an open confirm dialog also freezes it', () => {
    const { t, game } = setup();
    t.begin(5, false); // "see the big picture": done when the management camera is on
    game.camera.inManagement = true;
    game.paused = true; t.update(0.1);
    expect(t.state).toBe('active');
    game.paused = false; game.ui.confirmOpen = () => {}; t.update(0.1);
    expect(t.state).toBe('active');
    game.ui.confirmOpen = null; t.update(0.1);
    expect(t.state).toBe('ok');
    t.dispose();
  });
});

describe('tutorial: saving, skipping, replaying', () => {
  it('resumes at the saved step; old saves without tutorial data never see it', () => {
    const resumed = setup({ saved: { done: false, step: 3 }, isNew: false });
    expect(resumed.t.step).toBe(3); expect(resumed.t.done).toBe(false);
    expect(document.getElementById('tutorial').classList.contains('hidden')).toBe(false);
    resumed.t.dispose();
    const old = setup({ saved: null, isNew: false });
    expect(old.t.done).toBe(true);
    expect(document.getElementById('tutorial').classList.contains('hidden')).toBe(true);
    old.t.dispose();
  });

  it('serialize() round-trips and clamps a corrupt step', () => {
    const a = setup();
    a.t.begin(4, false);
    const s = a.t.serialize();
    expect(s).toMatchObject({ done: false, step: 4, v: 2 });
    a.t.dispose();
    const b = setup({ saved: { done: false, step: 999 }, isNew: false });
    expect(b.t.step).toBe(7);
    b.t.dispose();
  });

  it('skip finishes immediately and cleans every guide; finishing twice is harmless and saves state', () => {
    const { t, game } = setup();
    game.station.bays[0].state = 'waiting'; t.begin(1); t.update(0.05);
    expect(t.marker.visible).toBe(true);
    t.skip(); t.skip();
    expect(t.done).toBe(true);
    expect(t.marker.visible).toBe(false);
    expect(document.body.classList.contains('tut-on')).toBe(false);
    expect(game.save).toHaveBeenCalled();
    t.update(1); expect(t.done).toBe(true);
    t.dispose();
  });

  it('replay restarts from step 1 and does not duplicate the hand or the marker', () => {
    const { t, scene } = setup();
    t.skip(); t.restart(); t.skip(); t.restart();
    expect(t.step).toBe(0); expect(t.done).toBe(false);
    expect(document.querySelectorAll('#tut-hand')).toHaveLength(1);
    expect(scene.children.filter((o) => o === t.marker)).toHaveLength(1);
    t.dispose();
  });

  it('the tutorial never grants rewards by itself (nothing to duplicate)', () => {
    const { t, game } = setup();
    game.economy = { grant: vi.fn(), earn: vi.fn() };
    for (let i = 0; i < 8; i++) t.begin(i, false);
    t.finish(); t.finish();
    expect(game.economy.grant).not.toHaveBeenCalled();
    expect(game.economy.earn).not.toHaveBeenCalled();
    t.dispose();
  });
});

describe('tutorial: listeners and cleanup', () => {
  it('counts each game event once, and a disposed tutorial stops listening (no duplicate listeners after a restart of the UI)', () => {
    const first = setup();
    first.bus.emit('employee:hired', {}); first.bus.emit('customer:paid', {}); first.bus.emit('charging:start', {});
    expect(first.t.n).toMatchObject({ hired: 1, paid: 1, charge: 1 });
    first.t.dispose();
    first.bus.emit('employee:hired', {});
    expect(first.t.n.hired).toBe(1); // unchanged after dispose
    const second = setup();
    second.bus.emit('employee:hired', {});
    expect(second.t.n.hired).toBe(1);
    second.t.dispose();
  });

  it('dispose removes the hand, the marker, body classes and global listeners', () => {
    const rm = vi.spyOn(window, 'removeEventListener');
    const { t, scene } = setup();
    t.dispose();
    expect(document.getElementById('tut-hand')).toBeNull();
    expect(scene.children).not.toContain(t.marker);
    expect(document.body.classList.contains('tut-on')).toBe(false);
    expect(rm.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['resize', 'pointerdown']));
  });
});

describe('tutorial: persistence across save and load', () => {
  const reload = (saved, extra = {}) => setup({ saved: JSON.parse(JSON.stringify(saved)), isNew: false, ...extra });

  it('saves the step, the event counters and the pending success state, and restores them', () => {
    const a = setup();
    a.t.begin(2, false);
    a.bus.emit('charging:start', {}); a.bus.emit('customer:paid', {});
    const saved = a.t.serialize();
    expect(saved).toMatchObject({ v: 2, done: false, step: 2, state: 'active' });
    expect(saved.n).toMatchObject({ charge: 1, paid: 1 });
    a.t.dispose();
    const b = reload(saved);
    expect(b.t.step).toBe(2);
    expect(b.t.n).toMatchObject({ charge: 1, paid: 1 });
    b.t.dispose();
  });

  it('a save made during the success moment resumes it and still advances (no lost transition)', () => {
    const a = setup();
    a.t.begin(1, false); a.t.state = 'ok'; a.t.okTimer = 0.6;
    const saved = a.t.serialize();
    expect(saved).toMatchObject({ step: 1, state: 'ok', okTimer: 0.6 });
    a.t.dispose();
    const b = reload(saved);
    expect(b.t.state).toBe('ok');
    expect(document.getElementById('tut-obj').textContent).toBe('Charging started!'); // the success text is shown again
    for (let i = 0; i < 4; i++) b.t.update(0.1); expect(b.t.step).toBe(1);
    for (let i = 0; i < 4; i++) b.t.update(0.1); expect(b.t.step).toBe(2);
    b.t.dispose();
  });

  it('a "get paid" step cannot be missed: a customer served before the save / after the load still completes it', () => {
    const a = setup();
    a.t.begin(2, false);
    const saved = a.t.serialize(); // saved with no payment yet
    a.t.dispose();
    const b = reload(saved);
    b.t.update(0.1); expect(b.t.state).toBe('active');
    b.game.stats.total.served += 1; // the payment happens through some other path (no customer:paid event reaches the tutorial)
    b.t.update(0.1);
    expect(b.t.state).toBe('ok');
    b.t.dispose();
  });

  it('a payment that already happened is in the saved counters, so the step completes right after loading', () => {
    const a = setup();
    a.t.begin(2, false); a.bus.emit('customer:paid', {});
    const saved = a.t.serialize();
    a.t.dispose();
    const b = reload(saved);
    b.t.update(0.1);
    expect(b.t.state).toBe('ok');
    b.t.dispose();
  });

  it('the connect step also completes from game state alone (a car is already charging after the load)', () => {
    const a = setup();
    a.t.begin(1, false);
    const saved = a.t.serialize(); a.t.dispose();
    const b = reload(saved);
    b.game.station.bays[0].state = 'charging';
    b.t.update(0.1);
    expect(b.t.state).toBe('ok');
    b.t.dispose();
  });

  it('older saves ({done, step} only) load with safe defaults', () => {
    const b = reload({ done: false, step: 3 });
    expect(b.t.step).toBe(3);
    expect(b.t.state).toBe('active');
    expect(b.t.n.walked).toBe(0);
    expect(() => { b.t.update(0.1); b.t.serialize(); }).not.toThrow();
    b.t.dispose();
    const done = reload({ done: true, step: 7 });
    expect(done.t.done).toBe(true);
    done.t.dispose();
  });

  it('corrupt counters are ignored instead of poisoning the tutorial', () => {
    const b = reload({ v: 2, done: false, step: 1, state: 'weird', okTimer: 'x', n: { walked: 'lots', charge: -4, paid: null, hired: NaN, ok: 2 } });
    expect(b.t.state).toBe('active');
    expect(b.t.n.walked).toBe(0);
    expect(b.t.n.charge).toBeUndefined();
    expect(b.t.n.hired).toBeUndefined();
    expect(b.t.n.ok).toBe(2);
    b.t.dispose();
  });

  it('progress survives pause: the saved state while paused is the same as before pausing', () => {
    const a = setup();
    a.t.begin(2, false); a.bus.emit('charging:start', {});
    const before = JSON.stringify(a.t.serialize());
    a.game.paused = true; for (let i = 0; i < 50; i++) a.t.update(0.1);
    expect(JSON.stringify(a.t.serialize())).toBe(before);
    a.t.dispose();
  });

  it('every step can be reached and saved/restored without throwing', () => {
    for (let i = 0; i < 8; i++) {
      const a = setup(); a.t.begin(i, false);
      const b = reload(a.t.serialize());
      expect(b.t.step).toBe(i);
      a.t.dispose(); b.t.dispose();
    }
  });
});

describe('tutorial: polish (live progress, stuck nudge, safe skip)', () => {
  it('shows live walking progress in the objective', () => {
    const { t, game } = setup();
    expect(document.getElementById('tut-obj').textContent).toBe('Walk 10 metres · 0/10 m');
    walk(t, game, 4.5);
    expect(document.getElementById('tut-obj').textContent).toMatch(/Walk 10 metres · [3-5]\/10 m/);
    t.dispose();
  });

  it('says a customer is on the way while no bay is waiting', () => {
    const { t, game } = setup();
    t.begin(1, false);
    expect(document.getElementById('tut-obj').textContent).toMatch(/customer is on the way/);
    game.station.bays[0].state = 'waiting';
    t.update(0.05);
    expect(document.getElementById('tut-obj').textContent).toBe('Connect a car');
    t.dispose();
  });

  it('the Staff step adapts its hint to whether a board is open', () => {
    const { t, game } = setup();
    t.begin(4, false);
    expect(document.getElementById('tut-hint').textContent).toMatch(/bottom bar, then hire/);
    game.ui.modal = 'station';
    t.update(0.05);
    expect(document.getElementById('tut-hint').textContent).toMatch(/Close this board/);
    t.dispose();
  });

  it('after 30 s on one step the panel nudges and the hint says "Stuck?"; paused time does not count', () => {
    const { t, game } = setup();
    for (let i = 0; i < 20; i++) t.update(1);
    expect(t.el.classList.contains('nudge')).toBe(false);
    game.paused = true; for (let i = 0; i < 60; i++) t.update(1); game.paused = false;
    expect(t.el.classList.contains('nudge')).toBe(false);
    for (let i = 0; i < 12; i++) t.update(1);
    expect(t.el.classList.contains('nudge')).toBe(true);
    expect(document.getElementById('tut-hint').textContent).toMatch(/^Stuck\?/);
    t.begin(0, false);
    expect(t.el.classList.contains('nudge')).toBe(false);
    t.dispose();
  });

  it('the Skip button needs a second tap within 3 s; programmatic skip() stays immediate', () => {
    const { t } = setup();
    const btn = document.getElementById('tut-skip');
    btn.click();
    expect(t.done).toBe(false);
    expect(btn.textContent).toBe('Tap again to skip');
    for (let i = 0; i < 4; i++) t.update(1); // the arming expires
    expect(btn.textContent).toBe('Skip');
    btn.click(); expect(t.done).toBe(false);
    btn.click(); expect(t.done).toBe(true);
    t.dispose();
  });
});