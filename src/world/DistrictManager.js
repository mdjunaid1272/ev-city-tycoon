import * as THREE from 'three';

/**
 * City districts. Downtown is open from the start; the others need a progression stage and a one-off
 * permit fee before their lots can be bought. Locked districts are shown with a tinted overlay and a
 * padlock sign that disappears when the permit is bought.
 */
export function districtOfBlock(ix, iz) {
  if (Math.abs(ix) > 2 || Math.abs(iz) > 2) return null;
  if (ix === -2) return 'residential';
  if (ix === 2) return 'highway';
  if (iz === 1) return 'commercial';
  if (iz === 2) return 'industrial';
  if (iz === -2) return 'park';
  return 'downtown';
}

const BLOCK = 60;

function padlockTexture(name, sub) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,28,44,0.92)';
  g.beginPath(); g.roundRect?.(8, 8, 496, 240, 34) ?? g.rect(8, 8, 496, 240); g.fill();
  g.strokeStyle = '#ffe34d'; g.lineWidth = 6; g.stroke();
  g.font = '84px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('🔒', 256, 82);
  g.fillStyle = '#fff'; g.font = 'bold 40px system-ui'; g.fillText(name, 256, 158);
  g.fillStyle = '#ffe34d'; g.font = '30px system-ui'; g.fillText(sub, 256, 205);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class DistrictManager {
  constructor({ bus, economy, cfg, getStage, scene, saved = null }) {
    this.bus = bus;
    this.economy = economy;
    this.cfg = cfg;
    this.getStage = getStage;
    this.scene = scene;
    this.unlocked = new Set(['downtown', ...(saved?.unlocked || [])]);
    this.overlays = new Map(); // id -> { group, sign }
    this.t = 0;
    this.buildOverlays();
  }

  isUnlocked(id) { return id === 'park' || this.unlocked.has(id); }

  /** null when buyable, else the reason. */
  lock(id) {
    if (this.isUnlocked(id)) return 'Unlocked';
    const d = this.cfg[id];
    if (this.getStage() < d.stage) return `Unlocks at Stage ${d.stage}`;
    return null;
  }
  canUnlock(id) { return !this.lock(id) && this.economy.canAfford(this.cfg[id].cost); }

  unlock(id) {
    if (this.lock(id) || !this.economy.spend(this.cfg[id].cost, 'property')) return false;
    this.unlocked.add(id);
    const o = this.overlays.get(id);
    if (o) this.scene.remove(o.group);
    this.overlays.delete(id);
    this.bus.emit('district:unlocked', { id, name: this.cfg[id].name });
    this.bus.emit('property:changed');
    return true;
  }

  buildOverlays() {
    for (const [id, d] of Object.entries(this.cfg)) {
      if (this.isUnlocked(id)) continue;
      const group = new THREE.Group();
      const blocks = [];
      for (let ix = -2; ix <= 2; ix++) for (let iz = -2; iz <= 2; iz++) if (districtOfBlock(ix, iz) === id) blocks.push([ix, iz]);
      const col = new THREE.Color(d.color);
      let cx = 0, cz = 0;
      for (const [ix, iz] of blocks) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(48, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.32, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(ix * BLOCK, 0.62, iz * BLOCK);
        m.renderOrder = 4;
        group.add(m);
        cx += ix * BLOCK; cz += iz * BLOCK;
      }
      cx /= blocks.length; cz /= blocks.length;
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: padlockTexture(d.name, `Stage ${d.stage} · $${d.cost.toLocaleString('en-US')}`), transparent: true, depthWrite: false }));
      sign.scale.set(16, 8, 1);
      sign.position.set(cx, 22, cz);
      sign.renderOrder = 11;
      group.add(sign);
      this.scene.add(group);
      this.overlays.set(id, { group, sign, baseY: 22 });
    }
  }

  update(dt, zoom = 1) {
    this.t += dt;
    for (const o of this.overlays.values()) {
      const s = Math.max(1, zoom * 0.9);
      o.sign.scale.set(16 * s, 8 * s, 1);
      o.sign.position.y = o.baseY * Math.max(1, zoom * 0.7) + Math.sin(this.t * 2) * 0.6;
    }
  }

  serialize() {
    return { unlocked: [...this.unlocked].filter((x) => x !== 'downtown') };
  }
}
