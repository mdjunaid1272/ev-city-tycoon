/**
 * Small walkable grid for the station lot with A* pathfinding + line-of-sight smoothing.
 * Blocked cells come from the static colliders (buildings, pillars, charger pedestals), inflated by the
 * walker radius. Used by employees; cars use waypoint paths / the road graph instead.
 */
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n, k) {
    const a = this.a; a.push([k, n]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top[1];
  }
}

export class NavGrid {
  constructor({ minX = -23, maxX = 23, minZ = -23, maxZ = 23, cell = 0.5, radius = 0.5 } = {}) {
    Object.assign(this, { minX, minZ, cell, radius });
    this.w = Math.ceil((maxX - minX) / cell);
    this.h = Math.ceil((maxZ - minZ) / cell);
    this.blocked = new Uint8Array(this.w * this.h);
  }

  /** (Re)build blocked cells from collider boxes. */
  rebuild(colliders) {
    this.blocked.fill(0);
    const r = this.radius;
    for (const b of colliders.boxes) {
      if (b.h < 1) continue;
      const x0 = Math.floor((b.minX - r - this.minX) / this.cell), x1 = Math.ceil((b.maxX + r - this.minX) / this.cell);
      const z0 = Math.floor((b.minZ - r - this.minZ) / this.cell), z1 = Math.ceil((b.maxZ + r - this.minZ) / this.cell);
      for (let z = Math.max(0, z0); z < Math.min(this.h, z1); z++) for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) this.blocked[z * this.w + x] = 1;
    }
  }

  toCell(x, z) {
    return [Math.min(this.w - 1, Math.max(0, Math.floor((x - this.minX) / this.cell))), Math.min(this.h - 1, Math.max(0, Math.floor((z - this.minZ) / this.cell)))];
  }
  center(cx, cz) {
    return { x: this.minX + (cx + 0.5) * this.cell, z: this.minZ + (cz + 0.5) * this.cell };
  }
  isBlocked(cx, cz) {
    return cx < 0 || cz < 0 || cx >= this.w || cz >= this.h || this.blocked[cz * this.w + cx] === 1;
  }

  /** Nearest free cell to (cx,cz) by ring search. */
  nearestFree(cx, cz) {
    if (!this.isBlocked(cx, cz)) return [cx, cz];
    for (let r = 1; r < 12; r++) {
      let best = null, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || this.isBlocked(cx + dx, cz + dz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = [cx + dx, cz + dz]; }
      }
      if (best) return best;
    }
    return null;
  }

  lineClear(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, n = Math.ceil(Math.hypot(dx, dz) / (this.cell * 0.5));
    for (let i = 0; i <= n; i++) {
      const [cx, cz] = this.toCell(a.x + (dx * i) / n, a.z + (dz * i) / n);
      if (this.isBlocked(cx, cz)) return false;
    }
    return true;
  }

  /** Returns an array of {x,z} waypoints from start to goal (excluding start), or null if unreachable. */
  findPath(start, goal) {
    const s = this.nearestFree(...this.toCell(start.x, start.z)), g = this.nearestFree(...this.toCell(goal.x, goal.z));
    if (!s || !g) return null;
    const W = this.w, idx = (x, z) => z * W + x;
    const gScore = new Map([[idx(...s), 0]]), came = new Map();
    const open = new MinHeap();
    const hf = (x, z) => Math.hypot(x - g[0], z - g[1]);
    open.push(s, hf(...s));
    const closed = new Set();
    const N = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]];
    let found = false, guard = 0;
    while (open.size && guard++ < 20000) {
      const c = open.pop(), ci = idx(...c);
      if (closed.has(ci)) continue;
      closed.add(ci);
      if (c[0] === g[0] && c[1] === g[1]) { found = true; break; }
      for (const [dx, dz, cost] of N) {
        const nx = c[0] + dx, nz = c[1] + dz;
        if (this.isBlocked(nx, nz)) continue;
        if (dx && dz && (this.isBlocked(c[0] + dx, c[1]) || this.isBlocked(c[0], c[1] + dz))) continue; // no corner cutting
        const ni = idx(nx, nz), ng = gScore.get(ci) + cost;
        if (ng < (gScore.get(ni) ?? Infinity)) { gScore.set(ni, ng); came.set(ni, c); open.push([nx, nz], ng + hf(nx, nz)); }
      }
    }
    if (!found) return null;
    const cells = [g];
    let cur = g;
    while (came.has(idx(...cur))) { cur = came.get(idx(...cur)); cells.push(cur); }
    cells.reverse();
    let pts = cells.map(([x, z]) => this.center(x, z));
    pts[0] = { x: start.x, z: start.z };
    pts[pts.length - 1] = { x: goal.x, z: goal.z };
    if (this.isBlocked(...this.toCell(goal.x, goal.z))) pts[pts.length - 1] = this.center(...g);
    // string-pulling: skip waypoints that are directly visible
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineClear(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}
