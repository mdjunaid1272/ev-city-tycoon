import * as THREE from 'three';
import { CITY_LIMIT } from '../world/CityManager.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = THREE.MathUtils.clamp;
const ISO_YAW = Math.PI / 4;
const ISO_PITCH = Math.atan(1 / Math.SQRT2); // 35.264 deg: true isometric tilt
const ISO_FOV = 12;

/**
 * Hybrid camera.
 *  - third-person: yaw/pitch/dist orbit around the smoothed player position, with collision pull-in
 *  - management: elevated angled orbit around a pannable focus point
 * Switching blends the two poses (position, look-at, FOV) with an eased 1.1s transition.
 * Convention: yaw is the angle of the camera's horizontal offset: offset = (sin yaw, ., cos yaw).
 */
export class CameraManager {
  constructor({ camera, sceneFog, bus, input, player, colliders, settings, getSelectables }) {
    this.camera = camera;
    this.bus = bus;
    this.input = input;
    this.player = player;
    this.colliders = colliders;
    this.settings = settings;

    this.mode = 'third';
    this.blend = 0; // 0 = third, 1 = management
    this.blendTarget = 0;
    this.enabled = true;

    // Tycoon follow camera: fixed high angle (no rotation), follows the player, zoom only.
    this.tp = { yaw: 0, pitch: 0.98, dist: 20, target: new THREE.Vector3(), smooth: new THREE.Vector3() };
    // Isometric management view: classic 35.264 deg tilt, yaw locked to 45 deg + n*90 deg,
    // very narrow FOV at a long distance = (near-)orthographic projection. Zoom = distance.
    this.mg = { yaw: ISO_YAW, yawTarget: ISO_YAW, pitch: ISO_PITCH, dist: 175, focus: new THREE.Vector3(0, 0, 4), fov: ISO_FOV };
    this.tp.smooth.set(player.pos.x, 1.6, player.pos.z);

    this.poseA = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 62 };
    this.poseB = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: ISO_FOV };
    this.sceneFog = sceneFog;
    this._dir = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    bus.on('input:drag', (d) => this.onDrag(d));
    bus.on('input:zoom', (z) => this.onZoom(z));
    bus.on('input:key', (code) => {
      if (code === 'KeyM') this.toggle();
      if (code === 'KeyQ') this.rotateIso(1);
      if (code === 'KeyR') this.rotateIso(-1);
    });
    bus.on('input:rotate', (d) => this.rotateIso(d));
    this.getSelectables = getSelectables;
  }

  get inManagement() {
    return this.mode === 'management';
  }

  toggle() {
    this.setMode(this.mode === 'third' ? 'management' : 'third');
  }

  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'management') {
      // keep orientation; focus on the player's surroundings
      // snap to the isometric corner angle nearest to the current view direction
      this.mg.yawTarget = Math.round((this.tp.yaw - ISO_YAW) / (Math.PI / 2)) * (Math.PI / 2) + ISO_YAW;
      this.mg.yaw = this.tp.yaw;
      this.mg.focus.set(this.player.pos.x, 0, this.player.pos.z);
      this.blendTarget = 1;
    } else {
      this.blendTarget = 0; // street view keeps its fixed angle
    }
    this.bus.emit('camera:mode', m);
  }

  /** Turn the isometric view by 90 degrees (dir = +1 / -1). */
  rotateIso(dir) {
    if (this.mode !== 'management' || !this.enabled) return;
    this.mg.yawTarget += dir * (Math.PI / 2);
  }

  focusOn(v) {
    this.mg.focus.set(v.x, 0, v.z);
  }

  onDrag({ dx, dy, button, touch }) {
    if (!this.enabled) return;
    const sens = 0.0042 * this.settings.data.sensitivity;
    const inv = this.settings.data.invertY ? -1 : 1;
    if (this.mode === 'third') {
      void sens; void inv; // angle is fixed in the street view; drags are ignored (click/tap walks instead)
    } else {
      // any drag / one-finger pans the map (screen-relative); tilt and angle are locked in isometric
      const k = this.mg.dist * 0.00036;
      void button;
      const rx = Math.cos(this.mg.yaw), rz = -Math.sin(this.mg.yaw);
      const fx = -Math.sin(this.mg.yaw), fz = -Math.cos(this.mg.yaw);
      this.mg.focus.x += (-dx * rx + dy * fx) * k;
      this.mg.focus.z += (-dx * rz + dy * fz) * k;
      void touch;
    }
  }

  /** Back to the default framing of the current mode (zoom, and in management view the focus on the player). */
  reset() {
    if (this.mode === 'third') this.tp.dist = 20;
    else {
      this.mg.dist = 175;
      this.mg.focus.set(this.player.pos.x, 0, this.player.pos.z);
      this.mg.yawTarget = Math.round((this.mg.yawTarget - ISO_YAW) / (Math.PI / 2)) * (Math.PI / 2) + ISO_YAW;
    }
  }

  onZoom(z) {
    if (!this.enabled) return;
    if (this.mode === 'third') this.tp.dist = clamp(this.tp.dist + z * 2, 11, 36);
    else this.mg.dist = clamp(this.mg.dist * (1 + z * 0.12), 60, 420);
  }

  update(dt) {
    const p = this.player.pos;
    // ---- third-person pose ----
    const tp = this.tp;
    const k = 1 - Math.exp(-14 * dt);
    tp.smooth.x += (p.x - tp.smooth.x) * k;
    tp.smooth.z += (p.z - tp.smooth.z) * k;
    tp.smooth.y += (p.y + 1.55 - tp.smooth.y) * k;
    const cp = Math.cos(tp.pitch), sp = Math.sin(tp.pitch);
    this._dir.set(Math.sin(tp.yaw) * cp, sp, Math.cos(tp.yaw) * cp);
    let d = tp.dist;
    // high-angle camera looks down over buildings; only pull in if something is right behind the player
    const hit = this.colliders.raycast(tp.smooth, this._dir, Math.min(tp.dist, 9));
    if (hit < Infinity) d = Math.max(7, Math.min(d, hit - 0.35));
    tp.effDist = tp.effDist === undefined ? d : tp.effDist + (d - tp.effDist) * (d < tp.effDist ? 1 : 1 - Math.exp(-6 * dt));
    this.poseA.pos.copy(tp.smooth).addScaledVector(this._dir, tp.effDist);
    this.poseA.pos.y = Math.max(0.5, this.poseA.pos.y);
    this.poseA.look.copy(tp.smooth).add(new THREE.Vector3(0, 0.2, 0));
    this.poseA.fov = 45;

    // ---- management pose ----
    const mg = this.mg;
    if (this.mode === 'management') mg.yaw += (mg.yawTarget - mg.yaw) * (1 - Math.exp(-7 * dt));
    if (this.mode === 'management' && this.enabled) {
      const m = this.input.move;
      if (m.x || m.y) {
        const sp2 = mg.dist * 0.2 * dt;
        const rx = Math.cos(mg.yaw), rz = -Math.sin(mg.yaw), fx = -Math.sin(mg.yaw), fz = -Math.cos(mg.yaw);
        mg.focus.x += (rx * m.x + fx * m.y) * sp2;
        mg.focus.z += (rz * m.x + fz * m.y) * sp2;
      }
    }
    mg.focus.x = clamp(mg.focus.x, -CITY_LIMIT, CITY_LIMIT);
    mg.focus.z = clamp(mg.focus.z, -CITY_LIMIT, CITY_LIMIT);
    const mcp = Math.cos(mg.pitch);
    this.poseB.pos.set(mg.focus.x + Math.sin(mg.yaw) * mcp * mg.dist, Math.sin(mg.pitch) * mg.dist, mg.focus.z + Math.cos(mg.yaw) * mcp * mg.dist);
    this.poseB.look.copy(mg.focus);
    this.poseB.fov = mg.fov;

    // ---- blend ----
    const speed = 1 / 1.1;
    if (this.blend < this.blendTarget) this.blend = Math.min(this.blendTarget, this.blend + dt * speed);
    else if (this.blend > this.blendTarget) this.blend = Math.max(this.blendTarget, this.blend - dt * speed);
    const e = ease(this.blend);
    const cam = this.camera;
    if (this.blend === 0) cam.position.copy(this.poseA.pos);
    else if (this.blend === 1) cam.position.copy(this.poseB.pos);
    else {
      cam.position.lerpVectors(this.poseA.pos, this.poseB.pos, e);
      cam.position.y += Math.sin(Math.PI * e) * 5; // gentle arc so the move feels cinematic
    }
    const look = this._look || (this._look = new THREE.Vector3());
    look.lerpVectors(this.poseA.look, this.poseB.look, e);
    cam.lookAt(look);
    const fov = THREE.MathUtils.lerp(this.poseA.fov, this.poseB.fov, e);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // the isometric camera sits far away: push fog back so the city stays clear
    const fog = this.sceneFog;
    if (fog) {
      fog.near = THREE.MathUtils.lerp(120, mg.dist * 0.9, e);
      fog.far = THREE.MathUtils.lerp(420, mg.dist * 3 + 250, e);
    }
    this.transitioning = this.blend !== this.blendTarget;
  }

  /** Yaw used for camera-relative player movement. */
  get moveYaw() {
    return this.mode === 'third' ? this.tp.yaw : this.mg.yaw;
  }

  get focusPoint() {
    return this.mode === 'third' ? this.tp.smooth : this.mg.focus;
  }
}
