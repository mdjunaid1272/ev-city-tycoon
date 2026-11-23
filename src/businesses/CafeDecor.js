/**
 * Café decoration (pure logic): themes, floors, and furniture placed on fixed SLOTS.
 *
 * Slots are chosen at design time (public/data/cafe-cozy.json) so they never touch the walking aisle between the door and the
 * counter, and each slot only accepts its own kind of object (a table slot takes tables, a wall slot takes pictures...). That
 * keeps placement flexible (buy, place, rotate, replace, remove, theme) without any chance of blocking navigation or colliders.
 * Items cost café coins (the café's own soft currency), unlock with the café level, and some are gifts from customer stories.
 */
export class CafeDecor {
  constructor({ cfg, saved = null }) {
    this.cfg = cfg;
    const d = cfg.decor;
    this.items = d.items; this.slots = d.slots; this.themes = d.themes; this.floors = d.floors;
    const s = saved && typeof saved === 'object' ? saved : {};
    this.theme = d.themes[s.theme] ? s.theme : d.defaultTheme;
    this.floor = d.floors[s.floor] ? s.floor : 'default';
    this.ownedThemes = new Set([d.defaultTheme, ...(Array.isArray(s.themes) ? s.themes.filter((t) => d.themes[t]) : [])]);
    this.ownedFloors = new Set(['default', ...(Array.isArray(s.floors) ? s.floors.filter((f) => d.floors[f]) : [])]);
    this.owned = new Set();
    for (const [id, it] of Object.entries(this.items)) if (it.price === 0) this.owned.add(id);
    if (Array.isArray(s.owned)) for (const id of s.owned) if (this.items[id]) this.owned.add(id);
    this.placed = {};
    for (const [slot, sl] of Object.entries(this.slots)) this.placed[slot] = sl.default ? { item: sl.default, rot: 0 } : null;
    if (s.placed && typeof s.placed === 'object') {
      for (const [slot, p] of Object.entries(s.placed)) {
        if (!this.slots[slot]) continue;
        if (p === null) { this.placed[slot] = null; continue; }
        if (p && this.items[p.item] && this.items[p.item].kind === this.slots[slot].kind && this.owned.has(p.item)) this.placed[slot] = { item: p.item, rot: this.slots[slot].rot.includes(p.rot) ? p.rot : this.slots[slot].rot[0] };
      }
    }
    this.version = 0; // bumped on every change so the 3D view knows when to rebuild
  }

  isGift(id) { return !!this.items[id]?.gift; }
  /** Add a gift (or any item) to the collection. */
  grant(id) { if (!this.items[id] || this.owned.has(id)) return false; this.owned.add(id); this.version++; return true; }

  /** What can be bought now: not owned, not a gift, level reached. */
  shop(level) { return Object.entries(this.items).filter(([id, it]) => !this.owned.has(id) && !it.gift && it.level <= level).map(([id, it]) => ({ id, ...it })); }
  themeShop(level) { return Object.entries(this.themes).filter(([id, t]) => !this.ownedThemes.has(id) && t.level <= level).map(([id, t]) => ({ id, ...t })); }

  buy(id, coins, level) {
    const it = this.items[id];
    if (!it) return { ok: false, reason: 'Unknown item' };
    if (this.owned.has(id)) return { ok: false, reason: 'You already own this' };
    if (it.gift) return { ok: false, reason: 'A gift from a customer story' };
    if (it.level > level) return { ok: false, reason: `Unlocks at café level ${it.level}` };
    if (coins < it.price) return { ok: false, reason: 'Not enough café coins' };
    this.owned.add(id); this.version++;
    return { ok: true, cost: it.price };
  }
  buyTheme(id, coins, level) {
    const t = this.themes[id];
    if (!t) return { ok: false, reason: 'Unknown theme' };
    if (this.ownedThemes.has(id)) return { ok: false, reason: 'You already own this theme' };
    if (t.level > level) return { ok: false, reason: `Unlocks at café level ${t.level}` };
    if (coins < t.price) return { ok: false, reason: 'Not enough café coins' };
    this.ownedThemes.add(id); this.version++;
    return { ok: true, cost: t.price };
  }
  buyFloor(id, coins, level) {
    const f = this.floors[id];
    if (!f) return { ok: false, reason: 'Unknown floor' };
    if (this.ownedFloors.has(id)) return { ok: false, reason: 'You already own this floor' };
    if (f.level > level) return { ok: false, reason: `Unlocks at café level ${f.level}` };
    if (coins < f.price) return { ok: false, reason: 'Not enough café coins' };
    this.ownedFloors.add(id); this.version++;
    return { ok: true, cost: f.price };
  }

  setTheme(id) { if (!this.ownedThemes.has(id)) return false; this.theme = id; this.version++; return true; }
  setFloor(id) { if (!this.ownedFloors.has(id)) return false; this.floor = id; this.version++; return true; }

  /** Items of the slot's kind that the player owns (and that are not already in another slot, tables aside). */
  options(slot) {
    const sl = this.slots[slot];
    if (!sl) return [];
    const inUse = new Set(Object.entries(this.placed).filter(([s, p]) => p && s !== slot && !['table', 'rug', 'window'].includes(this.items[p.item].kind)).map(([, p]) => p.item));
    return Object.entries(this.items).filter(([id, it]) => it.kind === sl.kind && this.owned.has(id) && !inUse.has(id)).map(([id, it]) => ({ id, ...it }));
  }

  place(slot, id, rot = 0) {
    const sl = this.slots[slot], it = this.items[id];
    if (!sl || !it) return { ok: false, reason: 'Unknown slot or item' };
    if (it.kind !== sl.kind) return { ok: false, reason: `That does not fit a ${sl.kind} spot` };
    if (!this.owned.has(id)) return { ok: false, reason: 'Buy it first' };
    if (!this.options(slot).some((o) => o.id === id)) return { ok: false, reason: 'It is already placed somewhere else' };
    this.placed[slot] = { item: id, rot: sl.rot.includes(rot) ? rot : sl.rot[0] };
    this.version++;
    return { ok: true };
  }
  rotate(slot) {
    const sl = this.slots[slot], p = this.placed[slot];
    if (!sl || !p) return { ok: false, reason: 'Nothing here' };
    if (sl.rot.length < 2) return { ok: false, reason: 'This cannot be turned here' };
    p.rot = sl.rot[(sl.rot.indexOf(p.rot) + 1) % sl.rot.length];
    this.version++;
    return { ok: true, rot: p.rot };
  }
  remove(slot) {
    if (!this.slots[slot] || !this.placed[slot]) return { ok: false, reason: 'Nothing here' };
    if (this.slots[slot].kind === 'table') return { ok: false, reason: 'Replace the table instead of removing it' }; // tables carry the seats
    this.placed[slot] = null; this.version++;
    return { ok: true };
  }

  /** How inviting the café looks: item appeal + theme appeal. Tables count only once for their set. */
  appeal() {
    let a = this.themes[this.theme].appeal;
    for (const p of Object.values(this.placed)) if (p) a += this.items[p.item].appeal;
    return a;
  }
  /** Satisfaction bonus for customers (0 .. 0.12). */
  satisfactionBonus() { return Math.min(0.12, this.appeal() * 0.004); }

  /** Floor colours: an explicit floor wins over the theme. */
  floorColors() { return this.floor !== 'default' ? this.floors[this.floor].colors : this.themes[this.theme].floor; }

  serialize() {
    const placed = {};
    for (const [slot, p] of Object.entries(this.placed)) placed[slot] = p ? { item: p.item, rot: p.rot } : null;
    return { v: 1, theme: this.theme, floor: this.floor, themes: [...this.ownedThemes], floors: [...this.ownedFloors], owned: [...this.owned], placed };
  }
}
