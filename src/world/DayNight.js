import * as THREE from 'three';
import { nightMaterials } from './Materials.js';

const KEYS = [
  [0, 0x0d1430], [5, 0x101a3c], [6.5, 0xffb07a], [8.5, 0x9fd8ff],
  [16.5, 0x9fd8ff], [18.5, 0xff8f6b], [20.5, 0x101a3c], [24, 0x0d1430],
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();

/** Day/night cycle: moves the sun, tints sky/fog, and drives window/lamp glow. */
export class DayNight {
  constructor(sceneManager, bus) {
    this.sm = sceneManager;
    this.bus = bus;
    this.hour = 9.5;
    this.day = 1;
    this.hoursPerSecond = 24 / 600; // one in-game day = 10 real minutes
    this.night = 0;
    this.apply();
  }

  update(dt) {
    this.hour += dt * this.hoursPerSecond;
    if (this.hour >= 24) {
      this.hour -= 24;
      this.day++;
      this.bus.emit('day:new', this.day);
    }
    this.apply();
  }

  skyColor(out) {
    for (let i = 0; i < KEYS.length - 1; i++) {
      const [h0, c0] = KEYS[i], [h1, c1] = KEYS[i + 1];
      if (this.hour >= h0 && this.hour <= h1) {
        return out.copy(_c1.setHex(c0)).lerp(_c2.setHex(c1), (this.hour - h0) / (h1 - h0));
      }
    }
    return out.setHex(0x9fd8ff);
  }

  apply() {
    const sm = this.sm;
    const a = ((this.hour - 6) / 12) * Math.PI;
    const elev = Math.sin(a);
    this.sun = Math.max(0, elev); // 0 at night .. 1 at noon; drives solar generation
    const day = THREE.MathUtils.clamp(elev * 2.2, 0, 1);
    this.night = THREE.MathUtils.clamp(1 - elev * 3.5, 0, 1);
    if (elev > 0) sm.sunDir.set(Math.cos(a) * 0.9, Math.max(0.22, elev), 0.38).normalize();
    else sm.sunDir.set(-0.45, 0.55, 0.4).normalize(); // moon light
    const sky = this.skyColor(sm.scene.background);
    sm.scene.fog.color.copy(sky);
    sm.sun.intensity = THREE.MathUtils.lerp(0.45, 2.3, day);
    sm.sun.color.setHex(day > 0.6 ? 0xfff3dd : elev > 0 ? 0xffb98a : 0x8fa8ff);
    sm.hemi.intensity = THREE.MathUtils.lerp(0.65, 1.0, day);
    sm.hemi.color.copy(sky).lerp(_c1.setHex(0xffffff), 0.5);
    sm.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.9, 1.05, day);
    for (const m of nightMaterials) m.emissiveIntensity = this.night * (m.emissiveMap ? 1.0 : 2.2);
  }

  get timeString() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
