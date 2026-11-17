const DB = 'ev-city-tycoon';
const STORE = 'saves';
export const SAVE_VERSION = 1;

/** Versioned IndexedDB persistence (falls back to localStorage if IndexedDB is unavailable). */
export class SaveManager {
  open() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'));
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async save(data, slot = 'main') {
    const payload = { version: SAVE_VERSION, savedAt: Date.now(), data };
    try {
      const db = await this.open();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(payload, slot);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch (_) {
      try { localStorage.setItem(`evct.save.${slot}`, JSON.stringify(payload)); } catch (__) { /* give up */ }
    }
  }

  async load(slot = 'main') {
    let payload = null;
    try {
      const db = await this.open();
      payload = await new Promise((res, rej) => {
        const r = db.transaction(STORE).objectStore(STORE).get(slot);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
      });
      db.close();
    } catch (_) {
      try { payload = JSON.parse(localStorage.getItem(`evct.save.${slot}`) || 'null'); } catch (__) { payload = null; }
    }
    return this.migrate(payload);
  }

  /** Validate + migrate older versions. Returns data or null. */
  migrate(p) {
    if (!p || typeof p !== 'object' || typeof p.version !== 'number' || !p.data) return null;
    if (p.version > SAVE_VERSION) return null; // from a newer build: ignore safely
    return { ...p.data, savedAt: p.savedAt };
  }

  async clear(slot = 'main') {
    try {
      const db = await this.open();
      await new Promise((res) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(slot);
        tx.oncomplete = res;
      });
      db.close();
    } catch (_) { /* ignore */ }
    try { localStorage.removeItem(`evct.save.${slot}`); } catch (_) { /* ignore */ }
  }
}
