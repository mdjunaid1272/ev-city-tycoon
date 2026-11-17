/**
 * Unified keyboard / mouse / touch input.
 * Publishes high-level events on the EventBus so camera, player and UI stay decoupled:
 *   input:drag {dx,dy,button,touch}  input:zoom delta  input:twist rad
 *   input:click {x,y}                input:key code
 * Polled state: move (x,y in -1..1), sprint.
 */
export class Input {
  constructor(bus, canvas) {
    this.bus = bus;
    this.canvas = canvas;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.joy = { x: 0, y: 0 };
    this.sprintToggle = false;
    this.enabled = true;
    this.pointers = new Map();
    this.pinch = null;

    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      bus.emit('input:zoom', Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) / 120);
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    this.setupJoystick();
  }

  onKey(e, down) {
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (down) {
      if (!this.keys.has(e.code)) this.bus.emit('input:key', e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    } else this.keys.delete(e.code);
  }

  get sprint() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.sprintToggle;
  }

  /** Called each frame. */
  update() {
    let x = 0, y = 0;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    x += this.joy.x;
    y += this.joy.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.move.x = this.enabled ? x : 0;
    this.move.y = this.enabled ? y : 0;
  }

  onDown(e) {
    if (!this.enabled) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(),
      button: e.button, touch: e.pointerType === 'touch', moved: 0,
    });
    if (this.pointers.size === 2) this.pinch = this.pinchState();
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse') this.bus.emit('input:hover', { x: e.clientX, y: e.clientY }); return; } // mouse hover (placement ghost)
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    p.moved += Math.abs(dx) + Math.abs(dy);
    if (this.pointers.size >= 2 && this.pinch) {
      const s = this.pinchState();
      this.bus.emit('input:zoom', (this.pinch.d - s.d) / 60);
      let da = s.a - this.pinch.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.bus.emit('input:twist', da);
      this.pinch = s;
      return;
    }
    if (p.moved > 4) this.bus.emit('input:drag', { dx, dy, button: p.button, touch: p.touch });
  }

  onUp(e, cancelled) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    if (!cancelled && p.moved < 8 && performance.now() - p.t < 350) {
      this.bus.emit('input:click', { x: e.clientX, y: e.clientY, button: p.button });
    }
  }

  setupJoystick() {
    const zone = document.getElementById('joy-zone');
    const base = document.getElementById('joy-base');
    const knob = document.getElementById('joy-knob');
    if (!zone) return;
    let id = null, cx = 0, cy = 0;
    const R = 54;
    const set = (x, y) => {
      this.joy.x = x; this.joy.y = y;
      knob.style.transform = `translate(${x * R}px, ${-y * R}px)`;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect();
      cx = Math.min(Math.max(e.clientX, r.left + R), r.right - R);
      cy = Math.min(Math.max(e.clientY, r.top + R), r.bottom - R);
      base.style.left = `${cx - r.left}px`;
      base.style.top = `${cy - r.top}px`;
      base.classList.add('active');
      zone.dispatchEvent(new PointerEvent('pointermove', e));
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = (e.clientX - cx) / R, dy = -(e.clientY - cy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      set(dx, dy);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      set(0, 0);
      base.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
}
