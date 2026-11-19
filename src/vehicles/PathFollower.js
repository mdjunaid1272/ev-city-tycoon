import * as THREE from 'three';
import { speedLimitForPlayer } from './PlayerYield.js';

/**
 * Drives a vehicle object along waypoints with limited turn rate, speed easing and
 * smooth arrival at the last point (used for customer vehicles entering/leaving the lot).
 * Vehicle forward is -Z; yaw = object.rotation.y.
 */
export class PathFollower {
  constructor(obj, { maxSpeed = 7, accel = 6, turnRate = 2.4 } = {}) {
    this.obj = obj;
    this.maxSpeed = maxSpeed;
    this.accel = accel;
    this.turnRate = turnRate;
    this.speed = 0;
    this.path = [];
    this.idx = 0;
    this.done = true;
    this.onDone = null;
    this._d = new THREE.Vector3();
  }

  setPath(points, { startYawFromPath = false } = {}) {
    this.path = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], 0.3, p[1])));
    this.idx = 0;
    this.done = false;
    if (startYawFromPath && this.path.length > 1) {
      const a = this.path[0], b = this.path[1];
      this.obj.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    }
  }

  update(dt) {
    if (this.done) { this.speed = 0; return; }
    const o = this.obj;
    const last = this.idx >= this.path.length - 1;
    const tgt = this.path[this.idx];
    const d = this._d.set(tgt.x - o.position.x, 0, tgt.z - o.position.z);
    const dist = d.length();
    const capture = last ? 0.12 : 1.6;
    if (dist < capture) {
      if (last) {
        this.done = true;
        this.speed = 0;
        this.onDone?.();
        return;
      }
      this.idx++;
      return;
    }
    const want = Math.atan2(-d.x, -d.z);
    let dy = want - o.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const maxTurn = this.turnRate * dt * (0.4 + Math.min(1, this.speed / 3));
    o.rotation.y += Math.max(-maxTurn, Math.min(maxTurn, dy));
    let vMax = this.maxSpeed * (1 - Math.min(0.7, Math.abs(dy) * 0.5));
    if (last) vMax = Math.min(vMax, Math.sqrt(2 * 5 * dist) + 0.4);
    if (this.hold) vMax = 0; // blocked by another vehicle ahead
    if (this.limit !== undefined) vMax = Math.min(vMax, this.limit); // gap-based braking set by the lot's avoidance
    vMax = Math.min(vMax, speedLimitForPlayer(o, 5)); // the player stands on its way: stop, then go on when they step aside
    this.speed += Math.max(-this.accel * 2 * dt, Math.min(this.accel * dt, vMax - this.speed));
    const step = this.speed * dt;
    o.position.x += -Math.sin(o.rotation.y) * step;
    o.position.z += -Math.cos(o.rotation.y) * step;
    const wheels = o.userData.wheels;
    if (wheels) for (const w of wheels) w.rotation.x += step * 2.5;
  }
}

