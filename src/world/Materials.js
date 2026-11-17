import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const matCache = new Map();
/** Cached stylized standard material. */
export function mat(color, o = {}) {
  const key = `${color}|${o.rough ?? 0.75}|${o.metal ?? 0}|${o.emissive ?? 0}|${o.ei ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map();
export function rbox(w, h, d, r = 0.12, seg = 2) {
  const key = `${w}|${h}|${d}|${r}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
    geoCache.set(key, g);
  }
  return g;
}

export function mesh(geo, material, { x = 0, y = 0, z = 0, cast = true, receive = false } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** Materials whose emissive follows night time (window glow, lamps). */
export const nightMaterials = new Set();

let windowTex = null;
export function windowTextures() {
  if (windowTex) return windowTex;
  const S = 64;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return c;
  };
  const a = mk(), b = mk();
  const ca = a.getContext('2d'), cb = b.getContext('2d');
  ca.fillStyle = '#ffffff'; ca.fillRect(0, 0, S, S);
  cb.fillStyle = '#000'; cb.fillRect(0, 0, S, S);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const x = 6 + i * 30, y = 8 + j * 28;
      ca.fillStyle = '#7fb4d9'; ca.fillRect(x, y, 22, 18);
      ca.fillStyle = '#d8eefc'; ca.fillRect(x, y, 22, 5);
      cb.fillStyle = (i + j) % 2 ? '#ffd27a' : '#ffe9b0'; cb.fillRect(x, y, 22, 18);
    }
  }
  const t1 = new THREE.CanvasTexture(a), t2 = new THREE.CanvasTexture(b);
  for (const t of [t1, t2]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  windowTex = { map: t1, emissive: t2 };
  return windowTex;
}

/** Material for building walls with repeating windows. Window glow follows night factor. */
export function wallMaterial(color, w, h) {
  const t = windowTextures();
  const map = t.map.clone(), em = t.emissive.clone();
  for (const x of [map, em]) {
    x.repeat.set(Math.max(1, Math.round(w / 5)), Math.max(1, Math.round(h / 4.5)));
    x.needsUpdate = true;
  }
  const m = new THREE.MeshStandardMaterial({
    color, map, roughness: 0.7, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: 0,
  });
  nightMaterials.add(m);
  return m;
}

/** Canvas-drawn text sign texture. */
export function textTexture(text, { w = 256, h = 64, bg = '#1f8a4c', fg = '#ffffff', font = 'bold 34px system-ui, sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
