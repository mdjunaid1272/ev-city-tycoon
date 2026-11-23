/**
 * The owner can do the hands-on jobs themselves: stand beside a car-wash or garage bay and the open job on it is
 * worked by the player, exactly like an employee would (same task board, same business callbacks, same payment).
 * Without this a freshly unlocked Car Wash did nothing at all until a washer was hired.
 *
 * - Only wash and garage jobs, only open ones (an employee that already took a job keeps it).
 * - Garage jobs that need more skill than the owner has (skill 2) stay for the staff.
 * - Leaving the bay hands the job back with its progress kept; an employee may pick it up.
 * - A throttled toast explains the situation when cars wait and nobody works there.
 */
const DEPTS = ['wash', 'garage'];
const REACH = 2.6;        // metres from the bay's stand point
const SKILL = 2;          // the owner's skill for quality / minSkill checks
const SPEED = 0.9;        // slightly slower than a trained employee
const NUDGE_EVERY = 90;   // seconds between "cars are waiting" reminders
const WAIT_BEFORE_NUDGE = 8;
const LABELS = { wash: 'Washing the car', 'wash-start': 'Starting the tunnel', diagnose: 'Diagnosing', repair: 'Repairing' };
const FACILITY = { wash: ['Car Wash', 'washer'], garage: ['Garage', 'mechanic'] };

export class OwnerWork {
  constructor({ bus, tasks, employees, getPos, doc = typeof document !== 'undefined' ? document : null }) {
    Object.assign(this, { bus, tasks, employees, getPos });
    this.task = null;
    this.timer = 0;
    this.duration = 1;
    this.nudge = NUDGE_EVERY - WAIT_BEFORE_NUDGE; // first reminder soon after a car starts waiting
    this.waitFor = {};
    this.me = { id: 'player', skill: SKILL, name: 'You', role: 'owner' };
    this.el = null;
    if (doc) {
      const el = doc.createElement('div');
      el.id = 'work-bar'; el.className = 'hidden'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      el.innerHTML = '<span class="wb-t"></span><div class="wb-b"><i></i></div>';
      doc.body.appendChild(el);
      this.el = el;
    }
  }

  get working() { return !!this.task; }
  get progress() { return this.task ? Math.min(1, this.timer / this.duration) : 0; }

  dispose() {
    this.drop('disposed');
    this.el?.remove();
    this.el = null;
  }

  /** Hand the current job back (progress is kept by the business). */
  drop(reason = 'left') {
    const t = this.task;
    this.task = null;
    if (t && t.reservedBy === 'player' && (t.state === 'reserved' || t.state === 'active')) this.tasks.release(t, reason);
    this.show(null);
  }

  update(dt) {
    const pos = this.getPos();
    if (this.task) {
      const t = this.task;
      const near = Math.hypot(pos.x - t.pos.x, pos.z - t.pos.z) <= REACH + 0.6;
      if (!near || !t.valid() || t.state !== 'active' || t.reservedBy !== 'player') { this.drop(near ? 'invalid' : 'left'); return; }
      this.timer += dt * SPEED;
      t.onProgress?.(Math.min(1, this.timer / this.duration));
      this.show(`${LABELS[t.type] || 'Working'} · ${Math.round(this.progress * 100)}%`, this.progress);
      if (this.timer >= this.duration) {
        this.task = null;
        t.run();
        this.tasks.complete(t);
        this.bus.emit('owner:task-complete', { type: t.type });
        this.show(null);
      }
      return;
    }
    // look for an open job within reach
    let best = null, bestD = Infinity;
    for (const t of this.tasks.tasks.values()) {
      if (t.state !== 'open' || !DEPTS.includes(t.dept) || (t.minSkill || 1) > SKILL) continue;
      const d = Math.hypot(pos.x - t.pos.x, pos.z - t.pos.z);
      if (d <= REACH && d < bestD) { best = t; bestD = d; }
    }
    if (best && best.valid()) {
      best.state = 'reserved'; best.reservedBy = 'player';
      this.tasks.start(best);
      best.onStart?.(this.me);
      this.task = best; this.timer = 0; this.duration = Math.max(0.5, best.base || 1);
      this.show(`${LABELS[best.type] || 'Working'} · 0%`, 0);
    }
    this.remind(dt, pos);
  }

  /** Cars are waiting, nobody is on duty there and the owner is elsewhere: say what to do (rarely). */
  remind(dt) {
    let hint = null;
    for (const dept of DEPTS) {
      const open = this.tasks.open(dept);
      this.waitFor[dept] = open.length ? (this.waitFor[dept] || 0) + dt : 0;
      if (!hint && this.waitFor[dept] > WAIT_BEFORE_NUDGE && this.employees.workload(dept).staff === 0) hint = dept;
    }
    if (!hint) { this.nudge = Math.min(this.nudge, NUDGE_EVERY - WAIT_BEFORE_NUDGE); return; }
    this.nudge += dt;
    if (this.nudge < NUDGE_EVERY) return;
    this.nudge = 0;
    const [name, role] = FACILITY[hint];
    this.bus.emit('toast', { text: `A car is waiting at the ${name}. Stand beside its bay to work on it yourself, or hire a ${role} in Staff.`, kind: 'info' });
  }

  show(text, frac = 0) {
    if (!this.el) return;
    this.el.classList.toggle('hidden', !text);
    if (!text) return;
    this.el.firstChild.textContent = text;
    this.el.querySelector('i').style.width = `${Math.round(frac * 100)}%`;
  }
}
