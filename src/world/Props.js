import * as THREE from 'three';
import { Layer } from './Streetscape.js';
import { Kit, shade } from './Buildings.js';
import { nightMaterials, nightFades, wallMaterial } from './Materials.js';

/**
 * Urban props and landmarks, all drawn through four shared instanced layers (coloured boxes, coloured cylinders,
 * translucent glass, and flat decal quads): lamp bases, bollards, mailboxes, bus shelters, construction barriers,
 * downtown clock towers and glowing "EV" rooftop signs. Solid pieces register small colliders.
 */
const BLOCK_CENTERS = [-120, -60, 0, 60, 120];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasMat(w, h, draw, basic = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return basic ? new THREE.MeshBasicMaterial({ map: t }) : new THREE.MeshStandardMaterial({ map: t });
}

const clockMaterial = () => canvasMat(128, 128, (g, S) => {
  g.fillStyle = '#f7f2e4'; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#3a2c1f'; g.lineWidth = 8; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 8, 0, 7); g.stroke();
  g.lineWidth = 4; for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; g.beginPath(); g.moveTo(S / 2 + Math.sin(a) * 46, S / 2 - Math.cos(a) * 46); g.lineTo(S / 2 + Math.sin(a) * 54, S / 2 - Math.cos(a) * 54); g.stroke(); }
  g.lineWidth = 6; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + 20, S / 2 - 22); g.stroke();
  g.lineWidth = 4; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 - 8, S / 2 - 40); g.stroke();
});

export function buildProps({ city, scene, colliders, roofSigns = [], settings }) {
  const lowEnd = (settings?.quality?.detail ?? 1) < 0.7;
  const root = new THREE.Group();
  scene.add(root);
  const r = rng(4242);
  const solid = (x, z, w, d, h = 1.4) => colliders.add(x, z, w, d, h);
  const GROUND = 0.33;

  const B = new Layer(new THREE.BoxGeometry(1, 1, 1), { rough: 0.7, cast: true });
  const C = new Layer(new THREE.CylinderGeometry(1, 1, 1, 8), { rough: 0.7, cast: true });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd3f2, roughness: 0.15, transparent: true, opacity: 0.45 });
  const G = new Layer(new THREE.BoxGeometry(1, 1, 1), { material: glassMat });
  const faces = new Layer(new THREE.PlaneGeometry(1, 1), { material: clockMaterial() });
  const signMat = canvasMat(256, 80, (g, W, H) => {
    g.fillStyle = '#17a35a'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.font = 'bold 46px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('⚡ EV CITY', W / 2, H / 2 + 3);
  });
  const signs = new Layer(new THREE.PlaneGeometry(1, 1), { material: signMat });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffc66b, emissiveIntensity: 0 });
  nightMaterials.add(glowMat);
  const glows = new Layer(new THREE.SphereGeometry(1, 10, 8), { material: glowMat });

  // ---- red lamp bases (the lamp posts themselves are CityManager's instanced lamps)
  for (const [x, z] of city.lampPos) C.add(x, GROUND + 0.4, z, 0.3, 0.8, 0.3, 0, 0xd7332b);

  for (let ix = -2; ix <= 2; ix++) for (let iz = -2; iz <= 2; iz++) {
    const cx = BLOCK_CENTERS[ix + 2], cz = BLOCK_CENTERS[iz + 2], type = city.blockType(ix, iz);
    if (type === 'station' || type === 'sale') continue;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([nx, nz], si) => {
      const at = (t, depth = 23.0) => [cx + nx * depth + (nz !== 0 ? t : 0), cz + nz * depth + (nx !== 0 ? t : 0)];
      const ry = nx !== 0 ? Math.PI / 2 : 0; // long axis along the sidewalk
      // bollards beside both crosswalk ramps
      for (const t of lowEnd ? [] : [-19.4, 19.4]) { const [x, z] = at(t, 23.2); C.add(x, GROUND + 0.45, z, 0.17, 0.9, 0.17, 0, 0x3b4450); C.add(x, GROUND + 0.82, z, 0.18, 0.12, 0.18, 0, 0xf2c230); }
      // mailbox
      if (r() > 0.6 && type !== 'industrial' && !lowEnd) {
        const [x, z] = at(-12.2, 23.1);
        C.add(x, GROUND + 0.5, z, 0.07, 1, 0.07, 0, 0x59616c); B.add(x, GROUND + 1.15, z, 0.7, 0.55, 0.55, ry, 0x2f6fe0);
        solid(x, z, 0.8, 0.8, 1.4);
      }
      // bus shelter (one side per leafy / commercial block)
      if ((type === 'tall' || type === 'commercial' || type === 'residential') && si === (ix + iz + 8) % 4 && !(type === 'commercial' && nz > 0)) {
        const [x, z] = at(4.6, 22.9);
        B.add(x, GROUND + 2.6, z, nz !== 0 ? 3.8 : 1.7, 0.15, nz !== 0 ? 1.7 : 3.8, 0, 0x2f6fe0);
        G.add(x - nx * 0.7 * 1, GROUND + 1.3, z - nz * 0.7, nz !== 0 ? 3.6 : 0.06, 2.4, nz !== 0 ? 0.06 : 3.6, 0, 0x9fd3f2);
        for (const s of [-1.7, 1.7]) { const px = x + (nz !== 0 ? s : 0) + nx * 0.7, pz = z + (nx !== 0 ? s : 0) + nz * 0.7; B.add(px, GROUND + 1.3, pz, 0.12, 2.6, 0.12, 0, 0x3b4450); }
        B.add(x - nx * 0.4, GROUND + 0.55, z - nz * 0.4, nz !== 0 ? 2.6 : 0.5, 0.12, nz !== 0 ? 0.5 : 2.6, 0, 0xffc43d);
        B.add(x + nx * 1.3, GROUND + 1.15, z + nz * 1.3, nz !== 0 ? 0.8 : 0.08, 2.3, nz !== 0 ? 0.08 : 0.8, 0, 0xffc43d); // route sign
        solid(x, z, nz !== 0 ? 3.9 : 1.8, nz !== 0 ? 1.8 : 3.9, 2.6);
      }
    });
    // construction barriers beside the industrial block's street
    if (type === 'industrial') for (const [bx, bz] of [[-6, 22.3], [10, -22.3]]) {
      for (let k = 0; k < 3; k++) {
        const x = cx + bx + k * 2.2;
        B.add(x, GROUND + 0.75, cz + bz, 2.0, 0.28, 0.1, 0, k % 2 ? 0xf2c230 : 0x2a2f38);
        B.add(x, GROUND + 0.45, cz + bz, 2.0, 0.28, 0.1, 0, k % 2 ? 0x2a2f38 : 0xf2c230);
        for (const lx of [-0.85, 0.85]) B.add(x + lx, GROUND + 0.4, cz + bz, 0.08, 0.8, 0.5, 0, 0x59616c);
      }
      solid(cx + bx + 2.2, cz + bz, 6.6, 0.7, 1);
    }
    // downtown clock tower in the free 3 m gap at the heart of every other tall block
    if (type === 'tall' && (ix + iz) % 2 === 0) {
      const k = new Kit();
      k.box(0, 0.4, 0, 2.2, 0.8, 2.2, 0x8a8f99);
      k.box(0, 6.5, 0, 2.0, 11.4, 2.0, 0xd9a05b);
      k.box(0, 12.4, 0, 2.3, 0.7, 2.3, 0xf2e2b8);
      k.box(0, 14.1, 0, 2.2, 2.7, 2.2, 0xd9a05b);
      k.box(0, 15.7, 0, 2.7, 0.5, 2.7, 0xf2e2b8);
      const roof = new THREE.ConeGeometry(2.0, 3.2, 4); roof.rotateY(Math.PI / 4); roof.translate(0, 17.6, 0); k.add(roof, 0xc0453a);
      k.box(0, 19.6, 0, 0.12, 1.4, 0.12, 0xf2c230);
      const m = k.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
      m.position.set(cx, GROUND, cz); root.add(m);
      for (let f = 0; f < 4; f++) {
        const a = (f * Math.PI) / 2;
        faces.add(cx + Math.sin(a) * 1.16, GROUND + 14.1, cz + Math.cos(a) * 1.16, 1.7, 1.7, 1, a);
        glows.add(cx + Math.sin(a) * 0.6, GROUND + 16.2, cz + Math.cos(a) * 0.6, 0.18, 0.18, 0.18);
      }
      solid(cx, cz, 2.6, 2.6, 20);
    }
  }

  // ---- glowing EV signs on the roofs of selected towers
  for (const { x, y, z, face } of roofSigns) {
    for (const s of [-3.2, 3.2]) B.add(x + s, y + 1.4, z, 0.25, 2.8, 0.25, 0, 0x59616c);
    B.add(x, y + 3.4, z, 9, 3.0, 0.3, 0, 0x20262f);
    signs.add(x, y + 3.4, z + 0.18, 8.4, 2.6, 1, 0);
    signs.add(x, y + 3.4, z - 0.18, 8.4, 2.6, 1, Math.PI);
    void face;
  }

  // ---- warm light pools under every street lamp (additive, fade in with the night: one draw call)
  const pool = canvasMat(128, 128, (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,214,140,0.95)'); gr.addColorStop(0.45, 'rgba(255,190,110,0.35)'); gr.addColorStop(1, 'rgba(255,170,90,0)');
    g.clearRect(0, 0, S, S); g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });
  pool.transparent = true; pool.blending = THREE.AdditiveBlending; pool.depthWrite = false; pool.opacity = 0; pool.userData.max = 0.55;
  nightFades.add(pool);
  const pools = new Layer(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), { material: pool });
  if (!lowEnd) for (const [x, z] of city.lampPos) pools.add(x, 0.36, z, 11, 1, 11, 0);

  // ---- distant skyline: a ring of hazy towers beyond the scenery, windows lit at night (one instanced draw)
  const sky = rng(99), skyMat = wallMaterial(0x8ea6c6, 20, 44);
  const skyline = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), skyMat, 70);
  const M4 = new THREE.Matrix4(), Qd = new THREE.Quaternion(), Vd = new THREE.Vector3(), Sd = new THREE.Vector3();
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + sky() * 0.05, dist = 300 + sky() * 45, w = 14 + sky() * 18, h = 22 + sky() * sky() * 70, dd = 14 + sky() * 14;
    Qd.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    skyline.setMatrixAt(i, M4.compose(Vd.set(Math.cos(a) * dist, h / 2 - 2, Math.sin(a) * dist), Qd, Sd.set(w, h, dd)));
  }
  skyline.frustumCulled = false; skyline.castShadow = false; skyline.receiveShadow = false;
  if (!lowEnd) root.add(skyline);
  for (const l of [B, C, G, faces, signs, glows, pools]) l.finish(root);
  return { root, counts: { boxes: B.items.length, cylinders: C.items.length, glass: G.items.length, clocks: faces.items.length / 4, roofSigns: roofSigns.length } };
}
