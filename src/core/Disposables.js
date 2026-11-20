/**
 * Collects everything a component sets up (DOM listeners, EventBus subscriptions, timers, callbacks) so that one
 * dispose() call undoes all of it. dispose() is safe to call any number of times.
 */
export class Disposables {
  constructor() {
    this.items = [];
    this.disposed = false;
  }

  /** Remember an arbitrary cleanup function. Returns it, so it can also be called early. */
  add(fn) {
    if (this.disposed) { fn(); return fn; } // too late to track: clean up straight away
    this.items.push(fn);
    return fn;
  }

  /** addEventListener that dispose() removes again (same target, type, handler and options). */
  listen(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    return this.add(() => target.removeEventListener(type, handler, opts));
  }

  /** EventBus subscription (EventBus.on returns its own unsubscribe function). */
  subscribe(bus, evt, handler) {
    return this.add(bus.on(evt, handler));
  }

  timeout(fn, ms) {
    const id = setTimeout(fn, ms);
    this.add(() => clearTimeout(id));
    return id;
  }

  interval(fn, ms) {
    const id = setInterval(fn, ms);
    this.add(() => clearInterval(id));
    return id;
  }

  get size() { return this.items.length; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const items = this.items.reverse();
    this.items = [];
    for (const fn of items) {
      try { fn(); } catch (e) { console.error('[Disposables] cleanup failed', e); }
    }
  }
}
