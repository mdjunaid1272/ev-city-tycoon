import * as THREE from 'three';
import { sampleEdge, YELLOW } from './RoadManager.js';
import { setCarDirt } from './Models.js';

const STYLES = ['compact', 'suv', 'sports', 'van', 'compact', 'suv', 'taxi', 'sedan', 'compact'];
const COLORS = [0x2f8cff, 0xff7a59, 0x35c28a, 0xffc43d, 0xb06cff, 0xf4f7fa, 0x4cc9f0, 0xe8483f, 0xff8fb1];
const ACCEL = 3.2, BRAKE = 9, COMFORT = 4.5;
const _p = { x: 0, z: 0, yaw: 0 };

/** Two connectors conflict if vehicles using both at once could collide. */
function conflict(a, b) {
  if (a === b) return false;
  if (a.next === b.next) return true; // merging into the same exit lane
  if (a.inDir % 2 !== b.inDir % 2) return true; // crossing axes
  if (a.turn === 'L' && b.inDir === (a.inDir + 2) % 4 && b.turn !== 'L') return true; // left vs oncoming
  if (b.turn === 'L' && a.inDir === (b.inDir + 2) % 4 && a.turn !== 'L') return true;
  return false;
}

/**
 * Lane-graph traffic: every vehicle is an agent on a road/connector edge.
 *  - car following (gap + leader speed based braking)
 *  - obeys signals (stops at the stop line on red / unsafe yellow)
 *  - intersection reservation: only enters if no conflicting vehicle is inside and the exit lane has room
 *  - customer vehicles use the same network and are handed to the station's PathFollower at the driveway
 * Simulation is independent of rendering; far cars are just hidden.
 */
export class TrafficManager {
  constructor({ scene, assets, settings, road }) {
    this.assets = assets;
    this.settings = settings;
    this.road = road;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.agents = [];
    this.pool = new Map();
    this.queue = [];
    this.target = settings.quality.traffic;
    this.spawnTimer = 0;
    this.stats = { redRuns: 0, close: 0, minGap: Infinity, spawned: 0, removed: 0 };
    this.populate();
  }

  // ---------- creation ----------
  acquire(style, color) {
    const key = `${style}:${color}`;
    const c = this.pool.get(key)?.pop() || this.assets.create('car', { style, color });
    c.userData.poolKey = key;
    c.visible = true;
    setCarDirt(c, Math.random() * 0.7); // callers that care (customers) override this
    this.root.add(c);
    return c;
  }
  release(obj) {
    obj.visible = false;
    const key = obj.userData.poolKey;
    if (!this.pool.has(key)) this.pool.set(key, []);
    this.pool.get(key).push(obj);
  }

  makeAgent(obj, edge, s, o = {}) {
    const a = {
      obj, edge, s, v: o.v ?? 0, vmax: o.vmax ?? 8.5 + Math.random() * 3, len: obj.userData.length || 4.2,
      kind: o.kind || 'ambient', forceStraight: !!o.forceStraight, handoff: o.handoff || null, nextConn: null, stuck: 0,
    };
    a.nextConn = this.chooseConn(a, edge);
    edge.agents.push(a);
    if (edge.kind === 'conn') edge.inter.inside.add(a);
    this.agents.push(a);
    this.stats.spawned++;
    return a;
  }

  chooseConn(a, edge) {
    if (!edge.conns.length) return null;
    if (a.forceStraight) return edge.conns.find((c) => c.turn === 'S');
    let total = 0;
    const w = edge.conns.map((c) => {
      let x = c.turn === 'S' ? 0.6 : 0.2;
      if (c.edge.next.despawn) x *= 0.4; // fewer cars leave the city
      total += x;
      return x;
    });
    let r = Math.random() * total;
    for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return edge.conns[i];
    return edge.conns[0];
  }

  edgeFree(edge, s, len, behind = 6, ahead = 6) {
    for (const o of edge.agents) {
      if (o.s > s - behind - o.len / 2 && o.s < s + ahead + len / 2 + o.len / 2) return false;
    }
    return true;
  }

  randomCar() {
    const i = Math.floor(Math.random() * 1000);
    return this.acquire(STYLES[i % STYLES.length], COLORS[(i * 7) % COLORS.length]);
  }

  populate() {
    const roads = this.road.edges.filter((e) => e.kind === 'road' && !e.despawn && e.len > 25);
    let tries = 0;
    while (this.ambientCount() < this.target && tries++ < 400) {
      const e = roads[Math.floor(Math.random() * roads.length)];
      const s = 6 + Math.random() * (e.len - 12);
      if (!this.edgeFree(e, s, 4.4, 9, 9)) continue;
      this.makeAgent(this.randomCar(), e, s, { v: 6 });
    }
  }

  ambientCount() {
    let n = 0;
    for (const a of this.agents) if (a.kind === 'ambient') n++;
    return n;
  }

  /**
   * Ask for a vehicle to drive in from the east on the south road (westbound lane).
   * cb(obj, x, z, yaw) is called when it reaches the driveway at handoff.s; the caller takes over.
   */
  requestCustomer(obj, { kind = 'customer', handoffS, cb, spawnZ = 27, handoffEdge = null, spawnEdge = null, fast = false }) {
    // fast: appear on the final stretch (about 3 s from the driveway) instead of at the map edge: used for the very first customer
    const drive = handoffEdge || this.road.driveIn;
    const edge = fast ? drive : spawnEdge || this.road.spawnEdges.find((e) => e.dir === 3 && Math.abs(e.pts[0].z - spawnZ) < 0.5);
    this.queue.push({ obj, kind, edge, s: fast ? Math.max(2, handoffS - 24) : 25, handoff: { edge: drive, s: handoffS, cb } });
  }

  /** Put a vehicle back on the road (station exit). Returns false if the lane has no room yet. */
  merge(obj, edge, s) {
    const len = obj.userData.length || 4.2;
    // the merge point is close to the stop line: only join while the signal is fresh green and the box is clear
    const it = edge.to;
    if (it && edge.len - s < 15) {
      const L = this.road.light(it, edge.dir % 2);
      if (L.state !== 'green' || L.t > 5 || it.inside.size) return false;
    }
    for (const o of edge.agents) {
      if (o.s < s && s - o.s < 14 + o.len / 2) return false;
      if (o.s >= s && o.s - s < 7 + len / 2) return false;
    }
    this.root.add(obj);
    obj.visible = true;
    const a = this.makeAgent(obj, edge, s, { v: 4, kind: 'leaving', vmax: 9 });
    this.positionAgent(a);
    return true;
  }

  // ---------- simulation ----------
  canEnter(a, e, conn, dist) {
    const it = e.to, road = this.road;
    const L = road.light(it, e.dir % 2);
    if (L.state === 'red') return false;
    if (L.state === 'yellow') {
      // go only if the line can be cleared before the red; otherwise stop if physically possible
      const d = dist - a.len / 2 - 0.3;
      const clears = d / Math.max(a.v, 0.5) < YELLOW - L.t - 0.15;
      const canStop = d > (a.v * a.v) / (2 * BRAKE);
      if (!clears && canStop) return false;
    }
    const out = conn.edge.next;
    for (const o of out.agents) if (o.s - o.len / 2 < a.len + 2.5) return false; // exit lane full
    for (const o of it.inside) {
      if (o === a) continue;
      const oc = o.edge.kind === 'conn' ? o.edge : o.nextConn?.edge; // reserved cars count with their planned path
      if (oc && conflict(conn.edge, oc)) return false;
    }
    if (conn.turn === 'L') {
      const opp = it.entry[(e.dir + 2) % 4];
      for (const o of opp.agents) if (opp.len - o.s < 18 && o.v > 1 && o.nextConn?.turn !== 'L') return false;
    }
    return true;
  }

  leaderInfo(a) {
    const e = a.edge;
    let gap = Infinity, lv = 0;
    for (const o of e.agents) {
      if (o === a || o.s <= a.s) continue;
      const g = o.s - a.s - (o.len + a.len) / 2;
      if (g < gap) { gap = g; lv = o.v; }
    }
    if (gap === Infinity) {
      const n = e.kind === 'road' ? a.nextConn?.edge : e.next;
      if (n) {
        for (const o of n.agents) {
          const g = e.len - a.s + o.s - (o.len + a.len) / 2;
          if (g < gap) { gap = g; lv = o.v; }
        }
        if (gap === Infinity && n.kind === 'conn') {
          for (const o of n.next.agents) {
            const g = e.len - a.s + n.len + o.s - (o.len + a.len) / 2;
            if (g < gap) { gap = g; lv = o.v; }
          }
        }
      }
    }
    return { gap, lv };
  }

  step(a, dt) {
    const e = a.edge;
    let target = a.vmax;
    const { gap, lv } = this.leaderInfo(a);
    if (gap < Infinity) {
      if (gap < 0.3) {
        this.stats.close++;
        this.stats.firstClose ||= { kind: a.kind, edge: e.kind, turn: e.turn, s: +a.s.toFixed(1), len: +e.len.toFixed(1), gap: +gap.toFixed(2), v: +a.v.toFixed(1), lv: +lv.toFixed(1), resv: !!a.resv };
      }
      if (gap < this.stats.minGap) this.stats.minGap = gap;
      target = Math.min(target, Math.sqrt(lv * lv + 2 * 6 * Math.max(0, gap - 2)));
    }
    if (e.kind === 'road' && e.to && a.nextConn) {
      const dist = e.len - a.s;
      if (a.resv) {
        // a reservation is only valid while the car can't stop: drop it if the light is red and braking is possible
        const L = this.road.light(e.to, e.dir % 2);
        const d = dist - a.len / 2 - 0.3;
        if (L.state === 'red' && d > (a.v * a.v) / (2 * BRAKE)) { a.resv = false; e.to.inside.delete(a); }
      }
      if (!a.resv) {
        if (this.canEnter(a, e, a.nextConn, dist)) {
          // once the car can no longer stop comfortably it reserves the intersection and is committed
          if (dist - a.len / 2 < (a.v * a.v) / (2 * BRAKE) + 1.5 + a.len / 2) { a.resv = true; e.to.inside.add(a); a.resvInfo = { st: this.road.light(e.to, e.dir % 2), d: +dist.toFixed(1), v: +a.v.toFixed(1), at: +this.road.time.toFixed(1) }; }
        } else {
          const stopDist = dist - a.len / 2 - 0.3;
          target = Math.min(target, stopDist <= 0.05 ? 0 : Math.sqrt(2 * COMFORT * stopDist));
        }
      }
    }
    if (target > a.v) a.v = Math.min(target, a.v + ACCEL * dt);
    else a.v = Math.max(target, a.v - BRAKE * dt);
    a.s += a.v * dt;
    a.stuck = a.v < 0.2 ? a.stuck + dt : 0;

    while (!a.dead && a.s >= a.edge.len) this.advance(a);
    if (a.dead) return;

    const h = a.handoff;
    if (h && !a.dead && a.edge === h.edge && a.s >= h.s) {
      sampleEdge(a.edge, a.s, _p);
      // the callback may decline (e.g. the station turns the customer away): then the car just drives on
      if (h.cb(a.obj, _p.x, _p.z, _p.yaw) === false) {
        a.handoff = null;
        a.kind = 'passing';
        a.forceStraight = false;
      } else this.detach(a);
    }
  }

  advance(a) {
    const e = a.edge;
    if (e.despawn || (e.kind === 'road' && !a.nextConn)) { this.kill(a); return; }
    e.agents.splice(e.agents.indexOf(a), 1);
    a.s -= e.len;
    if (e.kind === 'road') {
      const conn = a.nextConn;
      const L = this.road.light(e.to, e.dir % 2);
      // a car committed on yellow may still clear the box during the 1.5 s all-red interval; later is a violation
      if (L.state === 'red' && L.t > 1.5) {
        this.stats.redRuns++;
        this.stats.firstRed ||= { kind: a.kind, v: +a.v.toFixed(1), t: +L.t.toFixed(2), resv: !!a.resv, turn: conn.turn, vmax: +a.vmax.toFixed(1), info: a.resvInfo, now: +this.road.time.toFixed(1) };
      }
      a.edge = conn.edge;
      a.resv = false;
      conn.edge.inter.inside.add(a);
      conn.edge.agents.push(a);
    } else {
      e.inter.inside.delete(a);
      a.edge = e.next;
      a.nextConn = this.chooseConn(a, a.edge);
      a.edge.agents.push(a);
    }
  }

  detach(a) {
    a.dead = true;
    a.edge.agents.splice(a.edge.agents.indexOf(a), 1);
    this.agents.splice(this.agents.indexOf(a), 1);
  }

  kill(a) {
    if (a.dead) return;
    a.dead = true;
    a.edge.agents.splice(a.edge.agents.indexOf(a), 1);
    if (a.edge.kind === 'conn') a.edge.inter.inside.delete(a);
    else if (a.edge.to) a.edge.to.inside.delete(a);
    this.agents.splice(this.agents.indexOf(a), 1);
    this.release(a.obj);
    this.stats.removed++;
  }

  positionAgent(a) {
    sampleEdge(a.edge, a.s, _p);
    a.obj.position.set(_p.x, 0.04, _p.z);
    a.obj.rotation.y = _p.yaw;
  }

  update(dt, focus) {
    this.road.update(dt);
    // spawn queued customers when the lane has room
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (this.edgeFree(q.edge, q.s, 4.4, 10, 14)) {
        this.root.add(q.obj);
        q.obj.visible = true;
        this.makeAgent(q.obj, q.edge, q.s, { v: 8, kind: q.kind, forceStraight: true, handoff: q.handoff, vmax: 9 });
        this.queue.splice(i, 1);
      }
    }
    // keep ambient density
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.ambientCount() < this.target) {
      this.spawnTimer = 0.7;
      const e = this.road.spawnEdges[Math.floor(Math.random() * this.road.spawnEdges.length)];
      if (this.edgeFree(e, 0, 4.4, 0, 14)) this.makeAgent(this.randomCar(), e, 0, { v: 8 });
    }
    const list = this.agents.slice();
    for (const a of list) {
      if (a.dead) continue;
      this.step(a, dt);
      if (a.dead) continue;
      // stuck safety net (deadlock): remove ambient cars that have not moved for a long time
      if (a.stuck > 45 && a.kind === 'ambient') { this.kill(a); continue; }
      this.positionAgent(a);
      const near = Math.abs(a.obj.position.x - focus.x) < 170 && Math.abs(a.obj.position.z - focus.z) < 170;
      if (a.obj.visible !== near) a.obj.visible = near;
      if (near && a.v > 0.1) for (const w of a.obj.userData.wheels) w.rotation.x += a.v * dt * 2.5;
    }
  }
}
