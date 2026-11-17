/**
 * Central task board (pure logic).
 * Businesses publish tasks; employees request the best open one. Reservation guarantees a task is
 * worked by one employee at a time (no duplicate work). Invalid tasks (the situation changed) are
 * cancelled automatically so employees recover instead of working on stale jobs.
 *
 * task = { id, key, type, dept, priority, pos:{x,z}, face:{x,z}, base (seconds), valid(): bool, run(): void, meta }
 * states: open -> reserved -> active -> done | cancelled
 */
let seq = 0;

export class TaskManager {
  constructor(bus) {
    this.bus = bus;
    this.tasks = new Map(); // id -> task
    this.byKey = new Map();
    this.stats = { published: 0, completed: 0, cancelled: 0, released: 0 };
  }

  /** Publish or refresh a task. Same key = same job: its priority/valid are updated, never duplicated. */
  publish(t) {
    const existing = this.byKey.get(t.key);
    if (existing && existing.state !== 'done' && existing.state !== 'cancelled') {
      existing.priority = t.priority;
      existing.valid = t.valid;
      return existing;
    }
    const task = { ...t, id: `t${++seq}`, state: 'open', reservedBy: null, createdAt: performance.now() };
    this.tasks.set(task.id, task);
    this.byKey.set(task.key, task);
    this.stats.published++;
    this.bus.emit('task:published', task);
    return task;
  }

  open(dept = null) {
    return [...this.tasks.values()].filter((t) => t.state === 'open' && (!dept || t.dept === dept));
  }

  /** Best open task for this requester: highest priority, nearest as tie-break. Reserves it. */
  request({ id, dept, pos, canDo = () => true }) {
    let best = null, bestScore = -Infinity;
    for (const t of this.tasks.values()) {
      if (t.state !== 'open' || t.dept !== dept || !canDo(t)) continue;
      if (!t.valid()) { this.cancel(t, 'invalid'); continue; }
      const dist = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z);
      const score = t.priority * 100 - dist;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (!best) return null;
    best.state = 'reserved';
    best.reservedBy = id;
    return best;
  }

  start(t) {
    if (t.state === 'reserved') t.state = 'active';
  }

  /** Give a task back (employee fired, blocked, stopped working...). */
  release(t, reason = '') {
    if (!t || t.state === 'done' || t.state === 'cancelled') return;
    t.state = 'open';
    t.reservedBy = null;
    this.stats.released++;
    this.bus.emit('task:released', { task: t, reason });
  }

  complete(t) {
    if (t.state === 'done' || t.state === 'cancelled') return;
    t.state = 'done';
    this.stats.completed++;
    this.bus.emit('task:completed', t);
    this.drop(t);
  }

  cancel(t, reason = '') {
    if (t.state === 'done' || t.state === 'cancelled') return;
    t.state = 'cancelled';
    this.stats.cancelled++;
    this.bus.emit('task:cancelled', { task: t, reason });
    this.drop(t);
  }

  drop(t) {
    this.tasks.delete(t.id);
    if (this.byKey.get(t.key) === t) this.byKey.delete(t.key);
  }

  /** Cancel tasks whose preconditions no longer hold (works on open and reserved tasks). */
  validate() {
    for (const t of [...this.tasks.values()]) if (!t.valid()) this.cancel(t, 'invalid');
  }
}
