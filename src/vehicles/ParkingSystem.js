/**
 * Parking reservation system (pure data).
 * A space has at most one owner at a time; only the owner can release it, so two vehicles can
 * never be assigned the same space. Lots: "station-bays" (charging bays) and "station-row" (visitor parking).
 */
export class ParkingSystem {
  constructor() {
    this.lots = new Map();
  }

  addLot(id, spaces) {
    this.lots.set(id, spaces.map((s, i) => ({
      id: `${id}:${i}`, lot: id, index: i, x: s.x, z: s.z, yaw: s.yaw || 0, enabled: true, owner: null, occupied: false,
    })));
  }

  spaces(lotId) {
    return this.lots.get(lotId) || [];
  }

  /** Reserve a free, enabled space for `owner`. Returns the space or null. */
  reserve(lotId, owner, prefer = null) {
    const free = this.spaces(lotId).filter((s) => s.enabled && !s.owner);
    if (!free.length) return null;
    const s = (prefer && free.find(prefer)) || free[Math.floor(Math.random() * free.length)];
    s.owner = owner;
    return s;
  }

  setOccupied(space, v) {
    space.occupied = v;
  }

  /** Release; ignored unless `owner` currently holds the space. */
  release(space, owner) {
    if (!space || space.owner !== owner) return false;
    space.owner = null;
    space.occupied = false;
    return true;
  }

  stats(lotId) {
    const sp = this.spaces(lotId);
    return { total: sp.length, enabled: sp.filter((s) => s.enabled).length, reserved: sp.filter((s) => s.owner).length };
  }
}
