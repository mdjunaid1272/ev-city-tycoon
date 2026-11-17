import * as THREE from 'three';

/**
 * Small pooled particle emitter (one THREE.Points, fixed particle count, no allocations per frame).
 * Used for water spray, foam, air drying, polish sparkles and repair sparks.
 * set({active, color, size, origin, spread, vel, gravity, life}) then update(dt).
 */
export class Emitter {
  constructor(count = 48) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count).fill(0);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.16, color: 0x7fd0ff, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.cfg = { active: false, origin: new THREE.Vector3(), spread: new THREE.Vector3(0.5, 0.1, 0.5), vel: new THREE.Vector3(0, -3, 0), jitter: 0.6, gravity: 0, life: 0.8 };
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -100;
  }

  set(o) {
    const c = this.cfg;
    if (o.color !== undefined) this.mat.color.setHex(o.color);
    if (o.size !== undefined) this.mat.size = o.size;
    if (o.opacity !== undefined) this.mat.opacity = o.opacity;
    for (const k of ['active', 'jitter', 'gravity', 'life']) if (o[k] !== undefined) c[k] = o[k];
    for (const k of ['origin', 'spread', 'vel']) if (o[k]) c[k].copy(o[k]);
  }

  update(dt) {
    const c = this.cfg;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        this.vel[i3 + 1] -= c.gravity * dt;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        any = true;
        if (this.life[i] <= 0) this.pos[i3 + 1] = -100;
      } else if (c.active) {
        this.life[i] = c.life * (0.5 + Math.random() * 0.7);
        this.pos[i3] = c.origin.x + (Math.random() - 0.5) * c.spread.x;
        this.pos[i3 + 1] = c.origin.y + (Math.random() - 0.5) * c.spread.y;
        this.pos[i3 + 2] = c.origin.z + (Math.random() - 0.5) * c.spread.z;
        this.vel[i3] = c.vel.x + (Math.random() - 0.5) * c.jitter;
        this.vel[i3 + 1] = c.vel.y + (Math.random() - 0.5) * c.jitter;
        this.vel[i3 + 2] = c.vel.z + (Math.random() - 0.5) * c.jitter;
        any = true;
      }
    }
    this.points.visible = any;
    if (any) this.geo.attributes.position.needsUpdate = true;
  }
}
