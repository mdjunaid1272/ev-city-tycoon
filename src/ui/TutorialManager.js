import * as THREE from 'three';

/**
 * First-time tutorial: ONE reusable panel (#tutorial) that is re-filled for every step,
 * plus a small world arrow / ground marker and an optional HUD-button highlight.
 *
 * A step is { id, title, text, goal, ok, hint, hintTouch, target(g) -> {x,z,y}|null, glow: selector|null,
 *             button: label|null (primary action; step completes when it is pressed), done(g, n) -> bool }.
 * `n` holds counters of game events seen since the step started (charge, paid, hired ...).
 * Progress is saved ({done, step}); old saves without it are treated as finished.
 */
const STEPS = [
  {
    id: 'move', title: 'Get moving', text: 'Walk around your new charging station.', goal: 'Walk 10 metres', ok: 'Nice walking!',
    hint: 'WASD / arrow keys · hold Shift to sprint · or hold the mouse button and drag', hintTouch: 'Use the joystick: press and drag in the bottom-left corner to walk',
    done: (g, n) => n.walked >= 10,
  },
  {
    id: 'connect', title: 'First customer', text: 'A car is pulling in. Stand beside its glowing charger.', goal: 'Connect a car', ok: 'Charging started!',
    hint: 'Stand still at the bay: the car connects by itself', hintTouch: 'Walk to the bay with the joystick and stand still: the car connects by itself',
    target: (g, t) => t.bay(['waiting', 'charging']), done: (g, n, t) => n.charge > 0 || t.anyBay(['charging', 'done']),
  },
  {
    id: 'paid', title: 'Get paid', text: 'Stay close while it charges. Billing happens when the car is full.', goal: 'Collect your first payment', ok: 'Cash earned!',
    hint: 'Tip: click a charging charger to stop and bill early', hintTouch: 'Tip: tap a charging charger to stop and bill early',
    target: (g, t) => t.bay(['charging', 'done', 'waiting']), done: (g, n) => n.paid > 0,
  },
  {
    id: 'terminal', title: 'Station terminal', text: 'Prices, bays and upgrades are managed at the terminal.', goal: 'Open the Station Manager', ok: 'Manager opened',
    hint: 'Walk to the terminal and click the floating Open button', hintTouch: 'Walk to the terminal and tap the floating Open button',
    target: (g, t) => t.terminal(), done: (g) => g.ui.modal === 'station',
  },
  {
    id: 'hire', title: 'Hire help', text: 'Attendants connect and bill cars for you, even while you are away.', goal: 'Open Staff and hire an attendant', ok: 'Welcome aboard!',
    hint: 'Close this window, then tap Staff 👥', hintTouch: 'Tap Staff 👥, then hire',
    glow: '.sc[data-open="staff"]', done: (g, n) => n.hired > 0 || g.employees.employees.length > 0,
  },
  {
    id: 'manage', title: 'See the big picture', text: 'Switch to the management view to see your whole business.', goal: 'Open the management view', ok: 'Great view!',
    hint: 'Press M (M again returns to the street)', hintTouch: 'Tap Manage 🏗️ (tap again to return)',
    glow: '#btn-mgmt', done: (g) => g.camera.inManagement,
  },
  {
    id: 'missions', title: 'Follow the missions', text: 'Missions pay cash and gems, and lead you to the next stage.', goal: 'Open Missions', ok: 'Good luck!',
    hint: 'Click Missions 🏁 in the bottom bar', hintTouch: 'Tap Missions 🏁',
    glow: '.sc[data-open="missions"]', done: (g) => g.ui.modal === 'missions',
  },
  {
    id: 'finish', title: "You're all set!", text: 'Keep customers happy, upgrade your station and grow into a city-wide EV business.', goal: 'Tutorial complete', ok: '',
    hint: '', hintTouch: '', button: 'Start playing', done: () => false,
  },
];

const SKY = 0x5cc8ff;

export class TutorialManager {
  constructor({ game, bus, scene, saved = null, isNew = false }) {
    this.g = game;
    this.bus = bus;
    this.scene = scene;
    this.$ = (id) => document.getElementById(id);
    this.el = this.$('tutorial');
    this.hintEl = this.$('tut-hint');
    this.done = saved ? !!saved.done : !isNew || !!window.__NO_TUTORIAL; // old saves never see it unless replayed
    this.step = saved && !saved.done ? Math.min(saved.step || 0, STEPS.length - 1) : 0;
    this.n = {};
    this.state = 'idle'; // idle | active | ok
    this.okTimer = 0;
    this.glowEl = null;
    this.lastPos = null;
    this.time = 0;

    this.buildMarker();
    this.buildHand();
    this.bindEvents();
    this.layout();
    this.onResize = () => this.layout();
    addEventListener('resize', this.onResize);
    if (!this.done) this.begin(this.step, false);
    else this.render();
  }

  /** Remove every listener, DOM node and world object this tutorial created. */
  dispose() {
    removeEventListener('resize', this.onResize);
    removeEventListener('pointerdown', this.onTouch);
    this.clearGuides();
    this.scene.remove(this.marker);
    this.marker.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.hand?.remove();
    document.body.classList.remove('tut-on', 'tut-tap', 'tut-bottom');
  }

  // ---------- world marker (arrow + ground ring); only one exists ----------
  buildMarker() {
    const mk = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.marker = new THREE.Group();
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 16), mk(SKY, 0.95));
    arrow.rotation.x = Math.PI; // point down
    arrow.renderOrder = 999;
    this.arrow = arrow;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.8, 40), mk(SKY, 0.85));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 998;
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40), mk(SKY, 0.16));
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.renderOrder = 997;
    this.marker.add(arrow, this.ring, this.glow);
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  // ---------- the pointing hand (shows exactly where to tap / click) ----------
  buildHand() {
    const h = document.createElement('div');
    h.id = 'tut-hand';
    h.setAttribute('aria-hidden', 'true');
    // the supplied artwork (public/Hand-Pointer.png, 220x243): fingertip at about (10%, 3%), finger pointing up-left
    h.innerHTML = '<div class="hw"><i class="rp"></i><div class="hi"><img src="./Hand-Pointer.png" alt="" draggable="false" width="76"></div></div>';
    document.body.appendChild(h);
    this.hand = h;
  }

  /** What the hand should point at for the current step: {x, y, mode} in screen pixels, or null. */
  handTarget(s, g) {
    const rectOf = (el, atBottom) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return null;
      const below = r.top + r.height / 2 < innerHeight * 0.55; // upper half: hand sits below pointing up; lower half: above pointing down
      return { x: r.left + r.width / 2, y: below ? r.bottom - 6 : r.top + 6, rot: below ? 0 : 180, mode: 'tap' };
    };
    const ui = g.ui;
    if (s.id === 'hire' && ui.modal === 'staff') {
      const b = [...document.querySelectorAll('#modal-card [data-emp-act^="hire"]')].find((x) => !x.disabled);
      return b ? rectOf(b) : null;
    }
    if (ui.modal || ui.confirmOpen) return null; // boards cover the world; the hint panel explains the rest
    if (s.button) return rectOf(this.$('tut-next'));
    if (s.glow) { const el = document.querySelector(s.glow); return el ? rectOf(el) : null; }
    if (s.target) {
      const t = s.target(g, this.targets);
      if (!t) return null;
      const v = new THREE.Vector3(t.x, 1.0, t.z).project(g.sm.camera);
      if (v.z > 1) return null;
      const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
      const off = x < 40 || x > innerWidth - 40 || y < 70 || y > innerHeight - 40;
      // target off screen: park the hand at the screen edge and turn it towards the target
      // (the artwork's finger points 54 degrees left of up, hence the + 54 when aiming)
      const rot = off ? (Math.atan2(x - innerWidth / 2, -(y - innerHeight / 2)) * 180) / Math.PI + 54 : y > innerHeight - 160 ? 180 : 0;
      return { x: THREE.MathUtils.clamp(x, 40, innerWidth - 40), y: THREE.MathUtils.clamp(y, 90, innerHeight - 120), rot, mode: 'tap' };
    }
    if (s.id === 'move') {
      if (document.body.classList.contains('touch')) { const jb = this.$('joy-base').getBoundingClientRect(); return { x: jb.left + jb.width / 2, y: jb.top + jb.height / 2 + 6, rot: 0, mode: 'drag' }; }
      const v = new THREE.Vector3(g.player.pos.x, 0.3, g.player.pos.z).project(g.sm.camera); // hold and drag from the character
      return { x: THREE.MathUtils.clamp((v.x * 0.5 + 0.5) * innerWidth + 26, 40, innerWidth - 40), y: THREE.MathUtils.clamp((-v.y * 0.5 + 0.5) * innerHeight + 30, 70, innerHeight - 50), rot: 0, mode: 'drag' };
    }
    return null;
  }

  updateHand(s, g) {
    const t = this.state === 'active' && !g.paused ? this.handTarget(s, g) : null;
    const h = this.hand;
    h.classList.toggle('on', !!t);
    document.body.classList.toggle('tut-tap', !!t && t.mode === 'tap'); // the hand already says it: hide the text hint
    if (!t) return;
    h.style.left = `${t.x}px`; h.style.top = `${t.y}px`;
    h.style.setProperty('--rot', Math.round(t.rot) + 'deg');
    h.classList.toggle('drag', t.mode === 'drag');
  }

  // ---------- events -> counters ----------
  bindEvents() {
    const b = this.bus, inc = (k) => () => { this.n[k] = (this.n[k] || 0) + 1; };
    b.on('charging:start', inc('charge'));
    b.on('customer:paid', inc('paid'));
    b.on('employee:hired', inc('hired'));
    // hybrid devices: the first real touch switches the hints to the joystick wording
    this.onTouch = (e) => { if (e.pointerType === 'touch' && !this.touch) { this.touch = true; this.render(); } };
    addEventListener('pointerdown', this.onTouch, { passive: true });
    const stop = (e) => e.stopPropagation();
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'mousedown', 'click']) this.el.addEventListener(ev, stop);
    this.$('tut-next').onclick = (e) => { e.currentTarget.blur(); this.finish(); };
    this.$('tut-skip').onclick = (e) => { e.currentTarget.blur(); this.skip(); };
  }

  // ---------- helpers for step targets ----------
  get targets() {
    const sv = this.g.stationView, st = this.g.station;
    const at = (id, y) => { const t = sv.interactables.find((i) => i.id === id); return t ? { x: t.pos.x, z: t.pos.z, y } : null; };
    return {
      bay: (states) => {
        const open = st.bays.filter((b) => b.unlocked);
        const b = states.map((s) => open.find((x) => x.state === s)).find(Boolean); // no bay in a wanted state -> no marker (never an arbitrary bay)
        return b ? at(`bay${st.bays.indexOf(b)}`, 5.4) : null;
      },
      anyBay: (states) => st.bays.some((b) => b.unlocked && states.includes(b.state)),
      terminal: () => { const p = this.g.stationView.terminalPos; return p ? { x: p.x, z: p.z, y: 3.4 } : null; },
    };
  }

  // ---------- flow ----------
  begin(i, persist = true) {
    this.step = i;
    this.n = { walked: 0 };
    this.lastPos = null;
    this.state = 'active';
    this.done = false;
    this.render();
    if (persist) this.save();
  }

  advance() {
    if (this.step >= STEPS.length - 1) return this.finish();
    this.begin(this.step + 1);
  }

  finish() {
    this.done = true;
    this.state = 'idle';
    this.clearGuides();
    this.render();
    this.save();
  }

  skip() { this.finish(); }

  /** Pause-menu "Replay tutorial". */
  restart() { this.begin(0); }

  save() { this.g.save?.(); }
  serialize() { return { done: this.done, step: this.step }; }

  clearGuides() {
    this.marker.visible = false;
    this.hand?.classList.remove('on');
    document.body.classList.remove('tut-tap');
    if (this.glowEl) { this.glowEl.classList.remove('tut-glow'); this.glowEl = null; }
  }

  // ---------- rendering of the single panel ----------
  layout() {
    const bottom = document.body.classList.contains('touch') || innerWidth <= 480;
    document.body.classList.toggle('tut-bottom', bottom);
    this.touch = !!this.touch || document.body.classList.contains('touch') || !!this.g.touch;
    if (this.el) this.render();
  }

  render() {
    const on = !this.done;
    document.body.classList.toggle('tut-on', on);
    this.el.classList.toggle('hidden', !on);
    if (!on) { this.hintEl.classList.add('hidden'); return; }
    const s = STEPS[this.step], ok = this.state === 'ok';
    this.el.classList.toggle('is-ok', ok);
    this.$('tut-title').textContent = s.title;
    this.$('tut-prog').textContent = `${this.step + 1}/${STEPS.length}`;
    this.$('tut-fill').style.width = `${((this.step + (ok ? 1 : 0)) / STEPS.length) * 100}%`;
    this.$('tut-text').textContent = s.text;
    this.$('tut-check').textContent = ok || s.button ? '✓' : '';
    this.$('tut-goal').classList.toggle('ok', ok || !!s.button);
    this.$('tut-obj').textContent = ok ? s.ok : s.goal;
    const btn = this.$('tut-next');
    btn.classList.toggle('hidden', !s.button);
    if (s.button) btn.textContent = s.button;
    this.$('tut-skip').classList.toggle('hidden', !!s.button);
    const hint = this.touch ? s.hintTouch : s.hint;
    this.hintEl.textContent = hint || '';
    this.hintEl.classList.toggle('hidden', !hint || ok);
  }

  // ---------- per-frame ----------
  update(dt) {
    if (this.done) return;
    const g = this.g, s = STEPS[this.step];
    // paused (menu, pause screen, confirm dialog): nothing advances, no timer runs, walking progress is not measured
    if (g.paused || g.ui?.confirmOpen) { this.lastPos = null; this.hand?.classList.remove('on'); return; }
    this.time += dt;
    if (this.state === 'ok') {
      this.okTimer -= dt;
      if (this.okTimer <= 0) this.advance();
      return;
    }
    // distance walked since the step began
    const p = g.player.pos;
    if (this.lastPos) { const d = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z); if (d < 3) this.n.walked += d; } // a jump (fast travel) is not walking
    this.lastPos = { x: p.x, z: p.z };

    if (s.done(g, this.n, this.targets)) {
      this.clearGuides(); // highlight disappears the moment the objective is met
      if (s.button) return;
      this.state = 'ok';
      this.okTimer = 1.1;
      this.render();
      return;
    }
    this.updateGuides(s, g);
    this.updateHand(s, g);
  }

  updateGuides(s, g) {
    const t = s.target ? s.target(g, this.targets) : null;
    if (t) {
      const k = g.camera.inManagement ? Math.max(1, g.camera.mg.dist / 70) : 1;
      this.marker.visible = true;
      this.marker.position.set(t.x, 0, t.z);
      this.arrow.position.y = (t.y || 4) * Math.min(k, 1.6) + Math.sin(this.time * 3.2) * 0.3 * k;
      this.arrow.scale.setScalar(k);
      const pulse = 1 + Math.sin(this.time * 3) * 0.06;
      this.ring.position.y = this.glow.position.y = 0.46;
      this.ring.scale.setScalar(k * pulse);
      this.glow.scale.setScalar(k * pulse);
    } else this.marker.visible = false;
    // HUD highlight
    const el = s.glow ? document.querySelector(s.glow) : null;
    if (el !== this.glowEl) {
      this.glowEl?.classList.remove('tut-glow');
      el?.classList.add('tut-glow');
      this.glowEl = el;
    }
  }
}
