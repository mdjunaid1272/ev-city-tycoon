import * as THREE from 'three';
import { animateCharacter } from '../world/Models.js';
import { CITY_LIMIT } from '../world/CityManager.js';

const WALK = 4.2, SPRINT = 7.6, ACCEL = 28, PLAYER_R = 0.42;

/** Third-person character: camera-relative movement, sprint, collision, procedural walk animation. */
export class PlayerController {
  constructor({ scene, assets, colliders, input }) {
    this.colliders = colliders;
    this.input = input;
    this.model = assets.create('character', { shirt: 0x2f8cff, hat: 0xe8483f });
    this.model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(this.model);
    this.pos = this.model.position;
    this.pos.set(-8, 0.34, 17);
    this.vel = new THREE.Vector3();
    this.yaw = 0; // model faces -Z (north) = towards the charging bays
    this.model.rotation.y = this.yaw;
    this.phase = 0;
    this.time = 0;
    this.speed = 0;
    this.enabled = true;
    this.target = null; // click-to-move destination {x,z}
    this.stuckT = 0; this.stuckX = 0; this.stuckZ = 0;
    // soft blob shadow so the player is grounded even with shadows off
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02;
    this.model.add(blob);
  }

  update(dt, camYaw) {
    this.time += dt;
    const inp = this.input.move;
    const mx = this.enabled ? inp.x : 0, my = this.enabled ? inp.y : 0;
    let len = Math.hypot(mx, my);
    let sprint = this.input.sprint && len > 0.1;
    // camera-relative: forward = -(sin yaw, cos yaw), right = (cos yaw, -sin yaw)
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = fx * my + rx * mx, dz = fz * my + rz * mx;
    // click / tap to move: walk to the target unless the player takes manual control
    if (len > 0.1 || !this.enabled) this.target = null;
    if (this.target) {
      const tx = this.target.x - this.pos.x, tz = this.target.z - this.pos.z;
      const td = Math.hypot(tx, tz);
      this.stuckT += dt;
      if (this.stuckT > 0.6) {
        if (Math.hypot(this.pos.x - this.stuckX, this.pos.z - this.stuckZ) < 0.25) this.target = null; // blocked
        this.stuckT = 0; this.stuckX = this.pos.x; this.stuckZ = this.pos.z;
      }
      if (td < 0.3) this.target = null;
      else { dx = tx; dz = tz; len = Math.min(1, td / 1.5); sprint = td > 14; }
    }
    const maxV = (sprint ? SPRINT : WALK) * Math.min(1, len);
    const dl = Math.hypot(dx, dz) || 1;
    const tvx = (dx / dl) * maxV, tvz = (dz / dl) * maxV;
    const k = Math.min(1, ACCEL * dt / Math.max(0.01, Math.hypot(tvx - this.vel.x, tvz - this.vel.z) + 1) * 3);
    this.vel.x += (tvx - this.vel.x) * k;
    this.vel.z += (tvz - this.vel.z) * k;
    if (len < 0.05 && Math.hypot(this.vel.x, this.vel.z) < 0.05) this.vel.set(0, 0, 0);

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.colliders.resolveCircle(this.pos, PLAYER_R);
    this.colliders.resolveVehicles(this.pos, PLAYER_R);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -CITY_LIMIT, CITY_LIMIT);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -CITY_LIMIT, CITY_LIMIT);

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.3) {
      const want = Math.atan2(-this.vel.x, -this.vel.z);
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 12);
      this.model.rotation.y = this.yaw;
    }
    this.phase += dt * (3 + this.speed * 1.6);
    animateCharacter(this.model, this.phase, Math.min(1, this.speed / 4), this.time);
  }
}
