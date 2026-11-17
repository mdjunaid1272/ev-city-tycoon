import * as THREE from 'three';

/**
 * Proximity interaction targets.
 * Each target: { id, pos: Vector3, radius, getPrompt(): {text}|null, run() }.
 * The closest target with a prompt inside its radius becomes `current`.
 */
export class InteractionSystem {
  constructor(bus, scene) {
    this.bus = bus;
    this.targets = [];
    this.current = null;
    this.enabled = true;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.1, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe34d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.ring);
    bus.on('input:key', (code) => { if (code === 'KeyE') this.interact(); });
  }

  add(t) {
    this.targets.push(t);
  }

  update(playerPos, time, dt = 0, speed = 0) {
    let best = null, bestD = Infinity, prompt = null;
    if (this.enabled) {
      for (const t of this.targets) {
        const d = Math.hypot(t.pos.x - playerPos.x, t.pos.z - playerPos.z);
        if (d > t.radius || d >= bestD) continue;
        const p = t.getPrompt();
        if (!p) continue;
        best = t; bestD = d; prompt = p;
      }
    }
    if (best !== this.current || (prompt?.text !== this.prompt?.text)) {
      this.current = best;
      this.prompt = prompt;
      this.bus.emit('interact:target', prompt);
    }
    // auto-interact: standing still at a target whose prompt is flagged `auto` triggers it (no key needed)
    if (best && prompt.auto && speed < 0.8) {
      this.dwell = (this.dwell || 0) + dt;
      if (this.dwell > 0.45) { this.dwell = 0; this.interact(); }
    } else this.dwell = 0;
    if (best) {
      this.ring.visible = true;
      this.ring.position.set(best.pos.x, 0.45, best.pos.z);
      const s = 1.6 + Math.sin(time * 4) * 0.12;
      this.ring.scale.set(s, s, s);
    } else this.ring.visible = false;
  }

  interact() {
    if (!this.enabled || !this.current) return false;
    this.current.run();
    this.bus.emit('interact:done', this.current.id);
    return true;
  }
}
