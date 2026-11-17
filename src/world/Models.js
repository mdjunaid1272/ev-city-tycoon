import * as THREE from 'three';
import { mat, rbox, mesh, wallMaterial, textTexture } from './Materials.js';

/** Vehicle archetypes (visual part; sim data lives in public/data/vehicles.json). */
export const CAR_STYLES = {
  compact: { len: 3.6, wid: 1.7, hgt: 0.75, cab: [0.55, 0.62], wheel: 0.32, cabShift: -0.1 },
  suv: { len: 4.4, wid: 1.9, hgt: 0.95, cab: [0.66, 0.7], wheel: 0.4, cabShift: -0.2 },
  sports: { len: 4.3, wid: 1.9, hgt: 0.6, cab: [0.45, 0.5], wheel: 0.34, cabShift: 0.1 },
  van: { len: 4.8, wid: 1.9, hgt: 1.5, cab: [0.9, 0.9], wheel: 0.36, cabShift: -0.7 },
  taxi: { len: 4.0, wid: 1.75, hgt: 0.8, cab: [0.55, 0.62], wheel: 0.33, cabShift: -0.1 },
  sedan: { len: 4.9, wid: 1.85, hgt: 0.68, cab: [0.5, 0.55], wheel: 0.34, cabShift: 0 },
};

/** Stylized EV. Front is -Z. Returns group with userData.wheels and userData.portLocal. */
export function createCar(style = 'compact', color = 0x2f8cff) {
  const s = CAR_STYLES[style] || CAR_STYLES.compact;
  const g = new THREE.Group();
  const bodyMat = mat(color, { rough: 0.35, metal: 0.25 });
  const lowerH = s.hgt * 0.5;
  const body = mesh(rbox(s.wid, lowerH, s.len, 0.28, 3), bodyMat, { y: s.wheel + lowerH / 2 - 0.05 });
  g.add(body);
  if (style === 'van') {
    const box = mesh(rbox(s.wid, s.hgt * 0.55, s.len * 0.72, 0.2, 3), bodyMat, { y: s.wheel + lowerH + s.hgt * 0.22, z: s.len * 0.14 });
    g.add(box);
    const cab = mesh(rbox(s.wid * 0.96, s.hgt * 0.5, s.len * 0.3, 0.2, 3), mat(0x233545, { rough: 0.15, metal: 0.4 }), { y: s.wheel + lowerH + s.hgt * 0.05, z: -s.len * 0.33 });
    g.add(cab);
  } else {
    const cabLen = s.len * s.cab[0], cabH = s.hgt * s.cab[1] * 0.6;
    const cab = mesh(rbox(s.wid * 0.9, cabH, cabLen, 0.25, 3), mat(0x1c2c3b, { rough: 0.12, metal: 0.5 }), {
      y: s.wheel + lowerH + cabH / 2 - 0.12, z: s.len * s.cabShift * 0.4,
    });
    g.add(cab);
    const roof = mesh(rbox(s.wid * 0.86, 0.08, cabLen * 0.8, 0.04, 1), bodyMat, { y: cab.position.y + cabH / 2 - 0.01, z: cab.position.z });
    g.add(roof);
    if (style === 'taxi') g.add(mesh(rbox(0.7, 0.2, 0.32, 0.06, 1), mat(0xfff2a8, { emissive: 0xffe08a, ei: 0.9 }), { y: roof.position.y + 0.16, z: roof.position.z, cast: false })); // taxi roof sign
  }
  // lights
  const head = mat(0xfff6c8, { emissive: 0xfff2a8, ei: 0.8 }), tail = mat(0xff3b3b, { emissive: 0xff2020, ei: 0.7 });
  for (const sx of [-1, 1]) {
    g.add(mesh(rbox(0.38, 0.14, 0.08, 0.04, 1), head, { x: sx * s.wid * 0.33, y: s.wheel + lowerH * 0.75, z: -s.len / 2 + 0.02, cast: false }));
    g.add(mesh(rbox(0.38, 0.12, 0.08, 0.04, 1), tail, { x: sx * s.wid * 0.33, y: s.wheel + lowerH * 0.75, z: s.len / 2 - 0.02, cast: false }));
  }
  // wheels
  const wheels = [];
  const wGeo = new THREE.CylinderGeometry(s.wheel, s.wheel, 0.26, 16);
  wGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(s.wheel * 0.55, s.wheel * 0.55, 0.28, 10);
  hubGeo.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Group();
      w.add(mesh(wGeo, mat(0x1b1d22)), mesh(hubGeo, mat(0xcfd6df, { metal: 0.6, rough: 0.3 }), { cast: false }));
      w.position.set(sx * (s.wid / 2 - 0.08), s.wheel, sz * s.len * 0.31);
      g.add(w);
      wheels.push(w);
    }
  }
  // dirt layer: a slightly larger translucent brown shell over every body part (opacity = dirt level)
  const dirtMat = new THREE.MeshStandardMaterial({ color: 0x6a5130, roughness: 1, transparent: true, opacity: 0, depthWrite: false });
  const shells = [];
  for (const ch of [...g.children]) {
    if (!ch.isMesh || ch.material === head || ch.material === tail) continue;
    const sh = new THREE.Mesh(ch.geometry, dirtMat);
    sh.position.copy(ch.position); sh.rotation.copy(ch.rotation); sh.scale.setScalar(1.025);
    sh.visible = false;
    g.add(sh);
    shells.push(sh);
  }
  g.userData.dirtMat = dirtMat;
  g.userData.dirtShells = shells;
  g.userData.dirt = 0;
  g.userData.wheels = wheels;
  g.userData.style = style;
  g.userData.length = s.len;
  g.userData.width = s.wid;
  g.userData.portY = s.wheel + lowerH * 0.9;
  g.userData.bodyMat = bodyMat;
  return g;
}

/** Show dirt (0..1) on a car model; pooled cars are re-dirtied every time they are reused. */
export function setCarDirt(car, d) {
  const m = car.userData.dirtMat;
  if (!m) return;
  d = Math.max(0, Math.min(1, d));
  car.userData.dirt = d;
  m.opacity = d * 0.72;
  for (const s of car.userData.dirtShells) s.visible = d > 0.02;
}

/** Humanoid with animatable limbs. Facing -Z. */
export function createCharacter({ shirt = 0x2f8cff, pants = 0x2b3a55, skin = 0xf2c9a0, hat = 0x1f8a4c } = {}) {
  const g = new THREE.Group();
  const limb = (w, h, d, color, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = mesh(rbox(w, h, d, w * 0.4, 2), mat(color), { y: -h / 2 + 0.05 });
    pivot.add(m);
    g.add(pivot);
    return pivot;
  };
  const torso = mesh(rbox(0.56, 0.62, 0.34, 0.14, 3), mat(shirt), { y: 1.1 });
  g.add(torso);
  const head = mesh(new THREE.SphereGeometry(0.27, 20, 16), mat(skin), { y: 1.7 });
  g.add(head);
  const cap = mesh(new THREE.SphereGeometry(0.29, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), mat(hat), { y: 1.74 });
  g.add(cap);
  const brim = mesh(rbox(0.3, 0.04, 0.2, 0.02, 1), mat(hat), { y: 1.77, z: -0.27 });
  g.add(brim);
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.035, 8, 8), mat(0x222222), { x: sx * 0.1, y: 1.71, z: -0.25, cast: false }));
  const armL = limb(0.16, 0.55, 0.16, shirt, -0.37, 1.38);
  const armR = limb(0.16, 0.55, 0.16, shirt, 0.37, 1.38);
  const legL = limb(0.2, 0.7, 0.22, pants, -0.15, 0.78);
  const legR = limb(0.2, 0.7, 0.22, pants, 0.15, 0.78);
  g.userData = { armL, armR, legL, legR, torso, head };
  return g;
}

export function animateCharacter(g, phase, amount, t) {
  const { armL, armR, legL, legR, torso } = g.userData;
  const s = Math.sin(phase) * 0.9 * amount;
  legL.rotation.x = s;
  legR.rotation.x = -s;
  armL.rotation.x = -s * 0.9;
  armR.rotation.x = s * 0.9;
  torso.position.y = 1.1 + Math.abs(Math.cos(phase)) * 0.05 * amount + Math.sin(t * 2) * 0.006;
  g.userData.head.position.y = torso.position.y + 0.6;
}

/** EV charger pedestal. socket position stored in userData.socket (local). */
export function createCharger(kind = 'ac') {
  const g = new THREE.Group();
  const color = kind === 'dc' ? 0x1f8a4c : kind === 'ultra' ? 0x7a3bff : 0x2f8cff;
  g.add(mesh(rbox(0.9, 0.12, 0.9, 0.05, 1), mat(0x9aa3ad), { y: 0.06, receive: true }));
  g.add(mesh(rbox(0.5, 1.7, 0.4, 0.14, 3), mat(0xf4f7fa, { rough: 0.4 }), { y: 0.95 }));
  g.add(mesh(rbox(0.52, 0.5, 0.42, 0.14, 3), mat(color, { rough: 0.35 }), { y: 1.55 }));
  g.add(mesh(rbox(0.34, 0.26, 0.04, 0.02, 1), mat(0x0b2a40, { emissive: 0x39d0ff, ei: 0.9 }), { y: 1.55, z: -0.22, cast: false }));
  const bolt = new THREE.Shape();
  bolt.moveTo(0.04, 0.16); bolt.lineTo(-0.08, -0.02); bolt.lineTo(0, -0.02); bolt.lineTo(-0.04, -0.16);
  bolt.lineTo(0.08, 0.02); bolt.lineTo(0, 0.02); bolt.closePath();
  const bm = mesh(new THREE.ShapeGeometry(bolt), mat(0xffe34d, { emissive: 0xffd400, ei: 0.8 }), { y: 1.05, z: -0.205, cast: false });
  bm.rotation.y = Math.PI;
  g.add(bm);
  const holster = mesh(rbox(0.16, 0.3, 0.14, 0.05, 1), mat(0x2a2f36), { x: 0, y: 0.8, z: -0.26 });
  g.add(holster);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 32), new THREE.MeshBasicMaterial({ color: 0x39ffb0, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
  g.add(ring);
  g.userData.socket = new THREE.Vector3(0, 0.8, -0.34);
  g.userData.ring = ring;
  g.userData.screenMat = g.children[3].material;
  return g;
}

export function createTree(rand = Math.random) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.6, 8), mat(0x7a5232), { y: 0.8 }));
  const col = [0x3fae4a, 0x58c15a, 0x2e9a4f][Math.floor(rand() * 3)];
  g.add(mesh(new THREE.IcosahedronGeometry(1.2, 1), mat(col, { rough: 0.9 }), { y: 2.5 }));
  return g;
}

/** Generic colorful building with windows and rounded roof cap. */
export function createBuilding(w, h, d, color, { roofColor = 0xf4f7fa, awning = null, sign = null } = {}) {
  const g = new THREE.Group();
  const wallsMat = [];
  const sideX = wallMaterial(color, d, h), sideZ = wallMaterial(color, w, h);
  const plain = mat(color, { rough: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideX, sideX, plain, plain, sideZ, sideZ]);
  body.position.y = h / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const cap = mesh(rbox(w + 0.5, 0.5, d + 0.5, 0.2, 2), mat(roofColor), { y: h + 0.25, receive: true });
  g.add(cap);
  // ground floor storefront band
  const band = mesh(rbox(w + 0.15, 0.2, d + 0.15, 0.08, 1), mat(0x2b3340), { y: 0.1 });
  g.add(band);
  if (awning != null) {
    for (const [ax, az, ry, len] of [[0, d / 2 + 0.7, 0, w], [0, -d / 2 - 0.7, Math.PI, w]]) {
      const a = mesh(rbox(len * 0.85, 0.15, 1.6, 0.06, 1), mat(awning), { y: 3.2, x: ax, z: az });
      a.rotation.y = ry;
      g.add(a);
    }
  }
  if (sign) {
    const t = textTexture(sign.text, { bg: sign.bg || '#ffffff', fg: sign.fg || '#1f2a37', w: 256, h: 64 });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.6, 7), Math.min(w * 0.6, 7) / 4), new THREE.MeshBasicMaterial({ map: t }));
    sm.position.set(0, 4.3, d / 2 + 0.03);
    g.add(sm);
    const sm2 = sm.clone(); sm2.position.z = -d / 2 - 0.03; sm2.rotation.y = Math.PI;
    g.add(sm2);
  }
  g.userData.size = { w, h, d };
  return g;
}

export function createHouse(w, d, wallColor, roofColor) {
  const g = new THREE.Group();
  const h = 3.4;
  g.add(mesh(rbox(w, h, d, 0.2, 2), mat(wallColor, { rough: 0.8 }), { y: h / 2, receive: true }));
  const roof = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.4, 4), mat(roofColor, { rough: 0.7 }), { y: h + 1.2 });
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
  g.add(roof);
  g.add(mesh(rbox(1, 2, 0.15, 0.05, 1), mat(0x7a4f2b), { y: 1, z: d / 2, cast: false }));
  for (const sx of [-1, 1]) g.add(mesh(rbox(1.1, 1.1, 0.1, 0.04, 1), mat(0x9fd3f2, { emissive: 0xffd48a, ei: 0 }), { x: sx * w * 0.3, y: 1.9, z: d / 2, cast: false }));
  g.add(mesh(rbox(0.7, 1.4, 0.7, 0.05, 1), mat(0xb9b2a8), { x: w * 0.3, y: h + 1.2, z: -d * 0.2 }));
  return g;
}

export function registerProceduralModels(assets) {
  assets.registerProcedural('car', ({ style, color } = {}) => createCar(style, color));
  assets.registerProcedural('character', (o) => createCharacter(o));
  assets.registerProcedural('charger', ({ kind } = {}) => createCharger(kind));
}
