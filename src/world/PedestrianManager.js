import * as THREE from 'three';
import { animateCharacter } from './Models.js';

/** Closed sidewalk loop (rounded rectangle) used for ambient pedestrians. */
class Loop {
  constructor(half, inset, radius = 0.8) {
    const a = half - inset;
    const corners = [[-a, -a], [a, -a], [a, a], [-a, a]];
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const p0 = corners[i], p1 = corners[(i + 1) % 4], p2 = corners[(i + 2) % 4];
      const v1 = new THREE.Vector2(p1[0] - p0[0], p1[1] - p0[1]).normalize();
      const v2 = new THREE.Vector2(p2[0] - p1[0], p2[1] - p1[1]).normalize();
      const s = new THREE.Vector2(p1[0], p1[1]).addScaledVector(v1, -radius);
      const e = new THREE.Vector2(p1[0], p1[1]).addScaledVector(v2, radius);
      for (let t = 0; t <= 1; t += 0.25) {
        const u = 1 - t;
        pts.push(new THREE.Vector2(u * u * s.x + 2 * u * t * p1[0] + t * t * e.x, u * u * s.y + 2 * u * t * p1[1] + t * t * e.y));
      }
    }
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i <= pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i % pts.length].distanceTo(pts[i - 1]));
    this.length = this.cum[pts.length];
  }

  at(s, out) {
    s = ((s % this.length) + this.length) % this.length;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= s) lo = m; else hi = m;
    }
    const a = this.pts[lo % this.pts.length], b = this.pts[(lo + 1) % this.pts.length];
    const t = (s - this.cum[lo]) / Math.max(1e-6, this.cum[lo + 1] - this.cum[lo]);
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.y + (b.y - a.y) * t;
    out.yaw = Math.atan2(-(b.x - a.x), -(b.y - a.y));
    return out;
  }
}

const COLS = [0x2f8cff, 0xff7a59, 0x35c28a, 0xffc43d, 0xb06cff, 0xf4f7fa, 0x4cc9f0, 0xe8483f];

/** Pedestrians walking the sidewalks of selected blocks. Distance-culled and animated only when near. */
export class PedestrianManager {
  constructor({ scene, assets, settings }) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.peds = [];
    this._o = { x: 0, z: 0, yaw: 0 };
    const loop = new Loop(24, 1.2);
    const blocks = [[0, 0], [-60, 0], [60, 0], [0, 60], [0, -60], [-60, 60], [60, -60], [60, 60], [-60, -60], [-120, 0], [-120, 60], [120, 0]];
    const n = settings.quality.peds;
    for (let i = 0; i < n; i++) {
      const [bx, bz] = blocks[i % blocks.length];
      const ch = assets.create('character', {
        shirt: COLS[(i * 3) % COLS.length], pants: 0x2b3a55, hat: COLS[(i * 5 + 2) % COLS.length],
        skin: [0xf2c9a0, 0xd9a273, 0x8d5a3b, 0xf7d9bd][i % 4],
      });
      ch.scale.setScalar(0.95);
      this.root.add(ch);
      this.peds.push({ obj: ch, loop, bx, bz, s: Math.random() * loop.length, speed: 1.1 + Math.random() * 0.6, dir: i % 2 ? 1 : -1, ph: Math.random() * 6 });
    }
  }

  update(dt, focus) {
    const o = this._o;
    for (const p of this.peds) {
      p.s += p.speed * dt * p.dir;
      p.loop.at(p.s, o);
      const x = p.bx + o.x, z = p.bz + o.z;
      const near = Math.abs(x - focus.x) < 90 && Math.abs(z - focus.z) < 90;
      if (p.obj.visible !== near) p.obj.visible = near;
      if (!near) continue;
      p.ph += dt * 6;
      p.obj.position.set(x, 0.3, z);
      p.obj.rotation.y = o.yaw + (p.dir > 0 ? 0 : Math.PI);
      animateCharacter(p.obj, p.ph, 0.7, p.ph);
    }
  }
}
