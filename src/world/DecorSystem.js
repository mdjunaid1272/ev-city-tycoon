import * as THREE from 'three';
import { mat, rbox, mesh, nightMaterials, textTexture } from './Materials.js';

const FLOOR = 0.34;

function buildItem(id) {
  const g = new THREE.Group();
  switch (id) {
    case 'tree':
      g.add(mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.3, 7), mat(0x7a5232), { y: 0.65 }), mesh(new THREE.IcosahedronGeometry(0.85, 1), mat(0x3fae4a, { rough: 0.9 }), { y: 1.9 }));
      break;
    case 'planter': {
      g.add(mesh(rbox(1.9, 0.5, 0.8, 0.1, 1), mat(0x8a5a35), { y: 0.25 }));
      [0xff7a59, 0xffc43d, 0xff8fb1, 0xb06cff, 0xf4f7fa, 0xff7a59].forEach((c, i) => g.add(mesh(new THREE.SphereGeometry(0.18, 8, 6), mat(c), { x: -0.8 + i * 0.32, y: 0.62, z: (i % 2 ? 0.12 : -0.12) })));
      break;
    }
    case 'bench':
      g.add(mesh(rbox(1.9, 0.14, 0.6, 0.05, 1), mat(0x8a5a35), { y: 0.5 }), mesh(rbox(1.9, 0.5, 0.1, 0.04, 1), mat(0x8a5a35), { y: 0.85, z: -0.27 }), mesh(rbox(0.12, 0.5, 0.5, 0.03, 1), mat(0x4a525d), { x: -0.8, y: 0.25 }), mesh(rbox(0.12, 0.5, 0.5, 0.03, 1), mat(0x4a525d), { x: 0.8, y: 0.25 }));
      break;
    case 'picnic':
      g.add(mesh(rbox(1.8, 0.1, 1.0, 0.04, 1), mat(0xb9a27a), { y: 0.78 }), mesh(rbox(1.8, 0.1, 0.4, 0.04, 1), mat(0x8a5a35), { y: 0.45, z: -0.8 }), mesh(rbox(1.8, 0.1, 0.4, 0.04, 1), mat(0x8a5a35), { y: 0.45, z: 0.8 }), mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6), mat(0xdfe5ec), { y: 1.3, x: 0.6 }), mesh(new THREE.ConeGeometry(1.0, 0.35, 8), mat(0xff7a59), { y: 2.3, x: 0.6 }));
      break;
    case 'lamp': {
      const bulb = new THREE.MeshStandardMaterial({ color: 0xfff4c4, emissive: 0xffe08a, emissiveIntensity: 0 });
      nightMaterials.add(bulb);
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.11, 3.6, 8), mat(0x56606b, { metal: 0.4 }), { y: 1.8 }), mesh(new THREE.SphereGeometry(0.28, 10, 8), bulb, { y: 3.7, cast: false }));
      break;
    }
    case 'banner': {
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6), mat(0xdfe5ec), { y: 1.7 }));
      const f = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), new THREE.MeshBasicMaterial({ map: textTexture('⚡', { w: 128, h: 256, bg: '#1f8a4c', font: 'bold 90px system-ui' }), side: THREE.DoubleSide }));
      f.position.set(0.62, 2.1, 0);
      g.add(f);
      break;
    }
    default: g.add(mesh(rbox(0.8, 0.8, 0.8, 0.1, 1), mat(0x9aa3ad), { y: 0.4 }));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/**
 * Placement mode controller + item visuals.
 *  place mode : a ghost snapped to the 1 m grid follows the pointer (green = valid, red = invalid);
 *               click (desktop) / Place button (touch) buys it; rotate with R / the Rotate button.
 *  remove mode: click a placed item to remove it (partial refund).
 * Placed items are saved by the PlacementManager and rebuilt from it, so the configuration persists.
 */
export class DecorSystem {
  constructor({ scene, bus, placement, camera, groundPlane, touch }) {
    this.scene = scene;
    this.bus = bus;
    this.pm = placement;
    this.camera = camera;
    this.plane = groundPlane;
    this.touch = touch;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.meshes = new Map();
    this.raycaster = new THREE.Raycaster();
    this.active = false;
    this.mode = 'place';
    this.item = null;
    this.rot = 0;
    this.pos = null; // {lot, x, z}
    this.valid = null;
    this.ghost = new THREE.Group();
    this.ghostBox = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghostBox.position.y = 0.25;
    this.ghost.add(this.ghostBox);
    this.ghost.visible = false;
    this.root.add(this.ghost);
    this.ghostModel = null;
    bus.on('decor:changed', () => this.sync());
    bus.on('svc:built', () => this.sync());
    bus.on('input:hover', (e) => { if (this.active && !this.touch) this.pointer(e.x, e.y, false); });
    bus.on('input:key', (code) => { if (this.active && code === 'KeyT') this.rotate(); }); // T = turn the item (Q / R rotate the camera)
    this.sync();
  }

  // ---------- visuals of placed items ----------
  worldOf(lotId, x, z) {
    return this.pm.lots.get(lotId).toWorld(x, z);
  }

  sync() {
    const live = new Set();
    for (const p of this.pm.placed) {
      const lot = this.pm.lots.get(p.lot);
      if (!lot || !lot.built()) continue;
      live.add(p.uid);
      let m = this.meshes.get(p.uid);
      if (!m) { m = buildItem(p.item); m.userData.uid = p.uid; this.root.add(m); this.meshes.set(p.uid, m); }
      const w = lot.toWorld(p.x, p.z);
      m.position.set(w.x, FLOOR, w.z);
      m.rotation.y = lot.rot + p.rot * (Math.PI / 2);
    }
    for (const [uid, m] of this.meshes) if (!live.has(uid)) { this.root.remove(m); this.meshes.delete(uid); }
  }

  // ---------- placement mode ----------
  start(itemId) {
    this.active = true;
    this.mode = 'place';
    this.item = itemId;
    this.rot = 0;
    this.pos = null;
    this.rebuildGhostModel();
    this.emitState();
  }
  startRemove() {
    this.active = true;
    this.mode = 'remove';
    this.item = null;
    this.pos = null;
    this.ghost.visible = false;
    this.emitState();
  }
  cancel() {
    this.active = false;
    this.pos = null;
    this.ghost.visible = false;
    this.emitState();
  }
  rotate() {
    if (!this.active || this.mode !== 'place') return;
    this.rot = (this.rot + 1) % 4;
    if (this.pos) this.reposition(this.pos.lot, this.pos.lx, this.pos.lz);
    this.emitState();
  }
  emitState() {
    this.bus.emit('decor:ui', { active: this.active, mode: this.mode, item: this.item, rot: this.rot, valid: this.valid, pos: this.pos });
  }

  rebuildGhostModel() {
    if (this.ghostModel) this.ghost.remove(this.ghostModel);
    this.ghostModel = this.item ? buildItem(this.item) : null;
    if (this.ghostModel) {
      this.ghostModel.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.75; o.castShadow = false; } });
      this.ghost.add(this.ghostModel);
    }
  }

  /** Cast a ray at the ground and find the lot under it. Returns {lot, lx, lz} or null. */
  hit(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, p)) return null;
    for (const [id, lot] of this.pm.lots) {
      if (!lot.built()) continue;
      const l = lot.toLocal(p.x, p.z);
      if (Math.abs(l.x) <= 21 && Math.abs(l.z) <= 21) return { lot: id, lx: l.x, lz: l.z };
    }
    return null;
  }

  reposition(lot, lx, lz) {
    const s = this.pm.snap(this.item, this.rot, lx, lz);
    this.pos = { lot, lx, lz, x: s.x, z: s.z };
    this.valid = this.pm.validate(lot, this.item, s.x, s.z, this.rot);
    const L = this.pm.lots.get(lot), w = L.toWorld(s.x, s.z);
    const [fw, fd] = this.pm.footprint(this.item, this.rot);
    this.ghost.position.set(w.x, FLOOR, w.z);
    this.ghost.rotation.y = L.rot;
    this.ghostBox.scale.set(fw, 1, fd);
    this.ghostBox.material.color.setHex(this.valid.ok ? 0x39ff88 : 0xff4d4d);
    if (this.ghostModel) { this.ghostModel.rotation.y = this.rot * (Math.PI / 2); }
    this.ghost.visible = true;
    this.emitState();
  }

  /** Pointer moved / clicked. commit=true buys (place) or removes (remove mode). */
  pointer(x, y, commit) {
    if (!this.active) return false;
    const h = this.hit(x, y);
    if (this.mode === 'remove') {
      if (commit && h) {
        const snapX = Math.floor(h.lx) + 0.5, snapZ = Math.floor(h.lz) + 0.5;
        const p = this.pm.find(h.lot, snapX, snapZ);
        if (p) this.pm.remove(p.uid);
        else this.bus.emit('toast', { text: 'Nothing to remove here' });
      }
      return true;
    }
    if (!h) { this.ghost.visible = false; this.pos = null; this.valid = null; this.emitState(); return true; }
    this.reposition(h.lot, h.lx, h.lz);
    if (commit && !this.touch) this.confirm();
    return true;
  }

  /** Buy the ghost's item at its current position. */
  confirm() {
    if (!this.active || this.mode !== 'place' || !this.pos) return { ok: false, reason: 'Pick a spot first' };
    const r = this.pm.place(this.pos.lot, this.item, this.pos.x, this.pos.z, this.rot);
    if (!r.ok) this.bus.emit('toast', { text: r.reason });
    else this.reposition(this.pos.lot, this.pos.lx, this.pos.lz);
    return r;
  }

  update(zoom) {
    void zoom;
    if (this.ghost.visible) this.ghostBox.material.opacity = 0.35 + Math.sin(performance.now() / 180) * 0.1;
  }
}
