/**
 * Grid-based decoration placement on owned lots (pure logic, no Three.js).
 * Items snap to a 1 m grid in the lot's local frame. A placement is valid when it is inside the lot, does not
 * touch driveways / bays / queues (forbidden rectangles), static obstacles (walkable-grid collision test) or
 * another item. Buying goes through the EconomyManager; removing refunds part of the price.
 * Placed items give the lot comfort (waiting customers are happier), appeal (more arrivals) and night lighting.
 */
let seq = 0;

/** Local-frame no-build rectangles for the drive-through service layout (wash / garage / hubs). */
export const SERVICE_FORBIDDEN = [
  [-20, 5, -11, 2], [-20, 10, 7, 12.5], [-15, 2, 14.5, 20.5], [5.5, 10.5, 11, 26], [-14, 10, 20, 26], [-20, 19, -15.5, -12.5], [15.5, 19.5, -15.5, 26], [-24, 4, -25, -16],
];
/** Same for the home charging station. */
export const STATION_FORBIDDEN = [
  [-21, 21, -7, 7], [-14.5, -8.5, 7, 26], [-11.5, 3.5, 12, 23.5], [0.5, 19.5, 12, 22.5], [-21, 15, -15.5, -7], [9.5, 14.5, -26, -14],
];

export class PlacementManager {
  constructor({ bus, economy, cfg, saved = null }) {
    this.bus = bus;
    this.economy = economy;
    this.cfg = cfg;
    this.items = cfg.items;
    this.lots = new Map(); // id -> { id, label, built(), forbidden, blocked(wx,wz), toWorld(lx,lz), toLocal(wx,wz) }
    this.placed = saved?.placed || [];
    this.totalPlaced = saved?.totalPlaced || this.placed.length;
    this.undoStack = [];
    this.redoStack = [];
  }

  registerLot(spec) {
    this.lots.set(spec.id, spec);
  }

  footprint(itemId, rot) {
    const [w, d] = this.items[itemId].size;
    return rot % 2 ? [d, w] : [w, d];
  }

  /** Snap a free local position to the grid for the given item footprint. */
  snap(itemId, rot, lx, lz) {
    const [w, d] = this.footprint(itemId, rot);
    const sx = w % 2 ? Math.floor(lx) + 0.5 : Math.round(lx);
    const sz = d % 2 ? Math.floor(lz) + 0.5 : Math.round(lz);
    return { x: sx, z: sz };
  }

  cells(itemId, rot, x, z) {
    const [w, d] = this.footprint(itemId, rot);
    const out = [];
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([x - w / 2 + i + 0.5, z - d / 2 + j + 0.5]);
    return out;
  }

  validate(lotId, itemId, x, z, rot) {
    const lot = this.lots.get(lotId), it = this.items[itemId];
    if (!lot || !it) return { ok: false, reason: 'Unknown lot or item' };
    if (!lot.built()) return { ok: false, reason: 'You do not own this lot yet' };
    for (const [cx, cz] of this.cells(itemId, rot, x, z)) {
      if (Math.abs(cx) > 20.5 || Math.abs(cz) > 20.5) return { ok: false, reason: 'Outside the lot' };
      if (lot.forbidden.some(([x0, x1, z0, z1]) => cx > x0 && cx < x1 && cz > z0 && cz < z1)) return { ok: false, reason: 'Keep driveways, bays and queues clear' };
      const w = lot.toWorld(cx, cz);
      if (lot.blocked(w.x, w.z)) return { ok: false, reason: 'Something is in the way' };
      for (const p of this.placed) {
        if (p.lot !== lotId) continue;
        if (this.cells(p.item, p.rot, p.x, p.z).some(([ox, oz]) => Math.abs(ox - cx) < 0.99 && Math.abs(oz - cz) < 0.99)) return { ok: false, reason: 'Occupied' };
      }
    }
    if (!this.economy.canAfford(it.cost)) return { ok: false, reason: 'Not enough cash', afford: false };
    return { ok: true };
  }

  place(lotId, itemId, x, z, rot) {
    const v = this.validate(lotId, itemId, x, z, rot);
    if (!v.ok) return v;
    if (!this.economy.spend(this.items[itemId].cost, 'decor')) return { ok: false, reason: 'Not enough cash' };
    const p = { uid: `d${++seq}_${Date.now().toString(36)}`, lot: lotId, item: itemId, x, z, rot };
    this.placed.push(p);
    this.totalPlaced++;
    this.record({ t: 'place', p });
    this.bus.emit('decor:placed', { placement: p });
    this.bus.emit('decor:changed');
    return { ok: true, placement: p };
  }

  remove(uid, record = true) {
    const i = this.placed.findIndex((p) => p.uid === uid);
    if (i < 0) return false;
    const [p] = this.placed.splice(i, 1);
    this.economy.grant({ cash: Math.floor(this.items[p.item].cost * this.cfg.refund) });
    if (record) this.record({ t: 'remove', p });
    this.bus.emit('decor:removed', { placement: p });
    this.bus.emit('decor:changed');
    return true;
  }

  // ----- undo / redo (build-mode session history; not saved) -----
  record(a) {
    this.undoStack.push(a);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  clearHistory() { this.undoStack.length = 0; this.redoStack.length = 0; this.bus.emit('decor:changed'); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Undo the last placement (full refund) or the last removal (takes the refund back). */
  undo() {
    const a = this.undoStack.pop();
    if (!a) return { ok: false, reason: 'Nothing to undo' };
    const { p } = a, it = this.items[p.item];
    if (a.t === 'place') {
      const i = this.placed.findIndex((x) => x.uid === p.uid);
      if (i >= 0) { this.placed.splice(i, 1); this.economy.grant({ cash: it.cost }); }
    } else {
      const v = this.validate(p.lot, p.item, p.x, p.z, p.rot);
      if (!v.ok && v.reason !== 'Not enough cash') { this.undoStack.push(a); return v; }
      if (!this.economy.spend(Math.floor(it.cost * this.cfg.refund), 'decor')) { this.undoStack.push(a); return { ok: false, reason: 'Not enough cash' }; }
      this.placed.push(p);
    }
    this.redoStack.push(a);
    this.bus.emit('decor:changed');
    return { ok: true, what: a.t === 'place' ? 'Placement undone (refunded)' : 'Removal undone' };
  }

  redo() {
    const a = this.redoStack.pop();
    if (!a) return { ok: false, reason: 'Nothing to redo' };
    const { p } = a, it = this.items[p.item];
    if (a.t === 'place') {
      const v = this.validate(p.lot, p.item, p.x, p.z, p.rot);
      if (!v.ok) { this.redoStack.push(a); return v; }
      if (!this.economy.spend(it.cost, 'decor')) { this.redoStack.push(a); return { ok: false, reason: 'Not enough cash' }; }
      this.placed.push(p);
    } else {
      const i = this.placed.findIndex((x) => x.uid === p.uid);
      if (i >= 0) { this.placed.splice(i, 1); this.economy.grant({ cash: Math.floor(it.cost * this.cfg.refund) }); }
    }
    this.undoStack.push(a);
    this.bus.emit('decor:changed');
    return { ok: true, what: a.t === 'place' ? 'Placement redone' : 'Removal redone' };
  }

  find(lotId, x, z) {
    return this.placed.find((p) => p.lot === lotId && this.cells(p.item, p.rot, p.x, p.z).some(([cx, cz]) => Math.abs(cx - x) < 0.6 && Math.abs(cz - z) < 0.6));
  }

  effects(lotId) {
    let comfort = 0, appeal = 0, night = 0;
    for (const p of this.placed) {
      if (p.lot !== lotId) continue;
      const it = this.items[p.item];
      comfort += it.comfort || 0; appeal += it.appeal || 0; night += it.night || 0;
    }
    return { comfort: Math.min(comfort, this.cfg.maxComfort), appeal: Math.min(appeal, this.cfg.maxAppeal), night: Math.min(night, this.cfg.maxAppeal) };
  }

  /** Arrival-rate multiplier for a lot (>= 1): appeal always, night lighting after dark. */
  demandFactor(lotId, hour) {
    const e = this.effects(lotId);
    const dark = hour >= 19 || hour < 6;
    return 1 + e.appeal + (dark ? e.night : 0);
  }

  countFor(lotId) {
    return this.placed.filter((p) => p.lot === lotId).length;
  }

  serialize() {
    return { placed: this.placed, totalPlaced: this.totalPlaced };
  }
}
