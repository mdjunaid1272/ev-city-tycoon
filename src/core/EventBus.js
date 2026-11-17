/** Tiny pub/sub used for all cross-system communication. */
export class EventBus {
  constructor() {
    this.map = new Map();
  }
  on(evt, fn) {
    let set = this.map.get(evt);
    if (!set) this.map.set(evt, (set = new Set()));
    set.add(fn);
    return () => this.off(evt, fn);
  }
  once(evt, fn) {
    const off = this.on(evt, (...a) => {
      off();
      fn(...a);
    });
    return off;
  }
  off(evt, fn) {
    const set = this.map.get(evt);
    if (set) set.delete(fn);
  }
  emit(evt, payload) {
    const set = this.map.get(evt);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[EventBus] handler for "${evt}" threw`, e);
      }
    }
  }
}
