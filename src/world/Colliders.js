import * as THREE from 'three';

/** Static axis-aligned box colliders (buildings, props). Cheap 2D circle push-out + 3D ray test. */
export class Colliders {
  constructor() {
    this.boxes = [];
    this.vehicles = new Set(); // moving cars (oriented boxes read from their world matrix); only the player is pushed out of them
    this._hit = new THREE.Vector3();
    this._ray = new THREE.Ray();
  }

  add(cx, cz, w, d, h = 10) {
    const b = {
      minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h,
      box: new THREE.Box3(new THREE.Vector3(cx - w / 2, 0, cz - d / 2), new THREE.Vector3(cx + w / 2, h, cz + d / 2)),
    };
    this.boxes.push(b);
    return b;
  }

  /** Push a circle (x,z,r) out of every box. Mutates and returns pos. */
  resolveCircle(pos, r) {
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.boxes) {
        if (pos.x < b.minX - r || pos.x > b.maxX + r || pos.z < b.minZ - r || pos.z > b.maxZ + r) continue;
        const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - nx, dz = pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = nx + (dx / d) * r;
          pos.z = nz + (dz / d) * r;
        } else {
          // centre inside box: push out along the shallowest axis
          const l = pos.x - b.minX, rr = b.maxX - pos.x, t = pos.z - b.minZ, bt = b.maxZ - pos.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) pos.x = b.minX - r;
          else if (m === rr) pos.x = b.maxX + r;
          else if (m === t) pos.z = b.minZ - r;
          else pos.z = b.maxZ + r;
        }
      }
    }
    return pos;
  }

  /** Push a circle out of every visible car (oriented box: length along local Z, width along local X). */
  resolveVehicles(pos, r) {
    for (const o of this.vehicles) {
      if (!o.visible || !o.parent) continue;
      const cx = o.position.x, cz = o.position.z;
      const hl = (o.userData.length || 4.2) / 2, hw = (o.userData.width || 1.9) / 2;
      let dx = pos.x - cx, dz = pos.z - cz;
      const reach = hl + hw + r;
      if (dx * dx + dz * dz > reach * reach) continue;
      const c = Math.cos(o.rotation.y), s = Math.sin(o.rotation.y); // cos / sin of the car's yaw
      let lx = c * dx - s * dz, lz = s * dx + c * dz;
      const nx = Math.max(-hw, Math.min(lx, hw)), nz = Math.max(-hl, Math.min(lz, hl));
      const ex = lx - nx, ez = lz - nz, d2 = ex * ex + ez * ez;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); lx = nx + (ex / d) * r; lz = nz + (ez / d) * r; }
      else if (hw - Math.abs(lx) < hl - Math.abs(lz)) lx = (lx >= 0 ? hw : -hw) + (lx >= 0 ? r : -r);
      else lz = (lz >= 0 ? hl : -hl) + (lz >= 0 ? r : -r);
      pos.x = cx + c * lx + s * lz;
      pos.z = cz - s * lx + c * lz;
    }
    return pos;
  }

  /** Distance along dir (normalized) to first box hit, or Infinity. */
  raycast(origin, dir, maxDist) {
    this._ray.set(origin, dir);
    let best = Infinity;
    for (const b of this.boxes) {
      // quick reject by distance to box centre
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const rad = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + maxDist;
      if (Math.hypot(cx - origin.x, cz - origin.z) > rad) continue;
      if (this._ray.intersectBox(b.box, this._hit)) {
        const d = this._hit.distanceTo(origin);
        if (d < best && d <= maxDist) best = d;
      }
    }
    return best;
  }
}
