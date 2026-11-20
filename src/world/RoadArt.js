import * as THREE from 'three';
import { mat } from './Materials.js';

/**
 * Street surfaces and road furniture (visual only: the lane graph in RoadManager is untouched).
 *  - asphalt with faint tyre tracks along the lane centres and a clean, separate surface for every intersection
 *  - double yellow centre line, turn arrows before each junction, checkered curb stones, tactile paving at crossings,
 *    drain grates and roadside signs (speed limit, parking, EV charging)
 * Everything repeated is an InstancedMesh: the whole street layer costs about a dozen draw calls.
 */
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function put(im, i, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
  Q.setFromAxisAngle(UP, ry);
  im.setMatrixAt(i, M.compose(V.set(x, y, z), Q, S.set(sx, sy, sz)));
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Asphalt: warm dark grey with speckles, a few patched squares and (optionally) darker tyre tracks along the two lanes. */
export function asphaltTexture({ tracks = true, vertical = false, seed = 11 } = {}) {
  const r = seeded(seed);
  return canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = '#4b5262'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) { g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.06)'; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
    for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(0,0,0,0.045)'; g.fillRect(r() * W, r() * H, 30 + r() * 40, 18 + r() * 24); }
    if (tracks) {
      // lane centres are at +-3 m of a 12 m road: 25% / 75% of the width; two wheel tracks per lane
      for (const lane of [0.25, 0.75]) for (const off of [-0.055, 0.055]) {
        const grad = vertical ? g.createLinearGradient((lane + off) * W - 8, 0, (lane + off) * W + 8, 0) : g.createLinearGradient(0, (lane + off) * H - 8, 0, (lane + off) * H + 8);
        grad.addColorStop(0, 'rgba(20,24,34,0)'); grad.addColorStop(0.5, 'rgba(20,24,34,0.20)'); grad.addColorStop(1, 'rgba(20,24,34,0)');
        g.fillStyle = grad;
        if (vertical) g.fillRect((lane + off) * W - 8, 0, 16, H); else g.fillRect(0, (lane + off) * H - 8, W, 16);
      }
    }
  });
}

export function buildRoadArt({ root, lines, extent, roadW, blockCenters, quality }) {
  const half = roadW / 2;
  const detail = quality?.detail ?? 1;

  // ---- surfaces: horizontal roads, vertical roads, then a clean square on every intersection (no overlapping z-fighting)
  const hTex = asphaltTexture({ vertical: false }), vTex = asphaltTexture({ vertical: true, seed: 12 }), iTex = asphaltTexture({ tracks: false, seed: 13 });
  const L = extent * 2;
  hTex.repeat.set(L / 12, 1); vTex.repeat.set(1, L / 12); iTex.repeat.set(1, 1);
  const hMat = new THREE.MeshStandardMaterial({ map: hTex, roughness: 0.92 }), vMat = new THREE.MeshStandardMaterial({ map: vTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), iMat = new THREE.MeshStandardMaterial({ map: iTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const plane = (w, d, material, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; root.add(m); return m; };
  for (const l of lines) { plane(L, roadW, hMat, 0, 0.03, l); plane(roadW, L, vMat, l, 0.031, 0); }
  const inter = new THREE.InstancedMesh(new THREE.PlaneGeometry(roadW, roadW), iMat, lines.length * lines.length);
  let ii = 0;
  for (const a of lines) for (const b of lines) { Q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); inter.setMatrixAt(ii++, M.compose(V.set(a, 0.034, b), Q, S.set(1, 1, 1))); }
  inter.receiveShadow = true; root.add(inter);

  const clear = (t) => lines.some((o) => Math.abs(t - o) < half + 0.1); // inside an intersection box
  const paint = (geo, color, n, y = 0.052) => { const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }), Math.max(1, n)); im.count = n; im.receiveShadow = true; im.userData.y = y; root.add(im); return im; };

  // ---- double yellow centre line: one long strip per street segment between two intersections
  const segs = [];
  const edges = [-extent, ...lines.flatMap((o) => [o - half, o + half]), extent];
  for (let i = 0; i < edges.length; i += 2) segs.push([edges[i], edges[i + 1]]);
  const center = paint(new THREE.BoxGeometry(1, 0.02, 0.13), 0xf2c230, lines.length * segs.length * 2 * 2);
  let ci = 0;
  for (const l of lines) for (const [a, b] of segs) {
    for (const off of [-0.17, 0.17]) {
      const a2 = a + (a === -extent ? 0.3 : 4.5), b2 = b - (b === extent ? 0.3 : 4.5); // stop short of the crosswalks
      put(center, ci++, (a2 + b2) / 2, 0.052, l + off, 0, b2 - a2, 1, 1); // along x
      put(center, ci++, l + off, 0.052, (a2 + b2) / 2, Math.PI / 2, b2 - a2, 1, 1); // along z
    }
  }
  center.count = ci;

  // ---- turn arrows on every approach lane, just before the stop line (right-hand traffic: lane = 3 m to the right)
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, -1.7); arrowShape.lineTo(0.2, -1.7); arrowShape.lineTo(0.2, 0.3); arrowShape.lineTo(0.62, 0.3); arrowShape.lineTo(0, 1.7);
  arrowShape.lineTo(-0.62, 0.3); arrowShape.lineTo(-0.2, 0.3); arrowShape.lineTo(-0.2, -1.7); arrowShape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(arrowShape); arrowGeo.rotateX(-Math.PI / 2);
  const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const arrows = paint(arrowGeo, 0xf4f7fa, lines.length * lines.length * 4, 0.053);
  let ai = 0;
  for (const a of lines) for (const b of lines) {
    for (let k = 0; k < 4; k++) {
      const [dx, dz] = DIR[k], [rx, rz] = DIR[(k + 1) % 4];
      const at = 11 + 6.5; // beyond the painted stop line
      // heading of travel is DIR[k]: the arrow points that way
      put(arrows, ai++, a - dx * at + rx * 3, 0.053, b - dz * at + rz * 3, Math.atan2(-dx, -dz));
    }
  }
  arrows.count = ai;

  // ---- curb stones, tactile paving, drain grates and signs per block side
  const centers = blockCenters;
  const curbGeo = new THREE.BoxGeometry(2.0, 0.07, 0.38);
  const curbA = paint(curbGeo, 0xe7e9ee, 0, 0.27), curbB = paint(curbGeo, 0xbfc5cf, 0, 0.27);
  const tact = paint(new THREE.BoxGeometry(1.8, 0.045, 1.2), 0xf2c230, centers.length * centers.length * 8, 0.275);
  const drain = paint(new THREE.BoxGeometry(0.9, 0.02, 0.45), 0x20252e, centers.length * centers.length * 4, 0.056);
  curbA.count = curbB.count = 0;
  const nCurb = centers.length * centers.length * 4 * 12;
  const A = new THREE.InstancedMesh(curbGeo, curbA.material, nCurb), B = new THREE.InstancedMesh(curbGeo, curbB.material, nCurb);
  root.remove(curbA, curbB); root.add(A, B); A.receiveShadow = B.receiveShadow = true;
  let na = 0, nb = 0, nt = 0, nd = 0;
  for (const cx of centers) for (const cz of centers) {
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ry = nx !== 0 ? Math.PI / 2 : 0;
      for (let k = -10; k <= 10; k++) { // 2 m stones along each 48 m side: checkered, leaving room for the crosswalk ramps
        const t = k * 2;
        const x = cx + nx * 23.82 + (nz !== 0 ? t : 0), z = cz + nz * 23.82 + (nx !== 0 ? t : 0);
        if (k % 2 === 0) put(A, na++, x, 0.285, z, ry); else put(B, nb++, x, 0.285, z, ry);
      }
      // tactile paving where the crosswalks meet the sidewalk (both ends of this side)
      for (const t of [-21.7, 21.7]) {
        const x = cx + nx * 22.4 + (nz !== 0 ? t : 0), z = cz + nz * 22.4 + (nx !== 0 ? t : 0);
        put(tact, nt++, x, 0.292, z, ry);
      }
      // a drain grate in the gutter near each end
      const t = -9.5;
      put(drain, nd++, cx + nx * 24.6 * 1 + (nz !== 0 ? t : 0) + nx * 0.5, 0.056, cz + nz * 24.6 + (nx !== 0 ? t : 0) + nz * 0.5, ry);
    }
  }
  A.count = na; B.count = nb; tact.count = nt; drain.count = nd;
  for (const im of [A, B, tact, drain, center, arrows, inter]) im.frustumCulled = false;

  // ---- roadside signs: pole + plate with a painted symbol (3 kinds, seeded placement on the block sides facing the road)
  const r = seeded(321);
  const signTex = ['30', 'P', 'EV'].map((label, i) => canvasTexture(128, 128, (g, W, H) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    if (i === 0) { g.strokeStyle = '#d6322b'; g.lineWidth = 14; g.beginPath(); g.arc(W / 2, H / 2, 48, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#1b2433'; g.font = 'bold 54px system-ui, sans-serif'; }
    else if (i === 1) { g.fillStyle = '#2f6fe0'; g.fillRect(6, 6, W - 12, H - 12); g.fillStyle = '#fff'; g.font = 'bold 80px system-ui, sans-serif'; }
    else { g.fillStyle = '#1f9a52'; g.fillRect(6, 6, W - 12, H - 12); g.fillStyle = '#fff'; g.font = 'bold 56px system-ui, sans-serif'; }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, W / 2, H / 2 + 4);
  }));
  const spots = [];
  for (const cx of centers) for (const cz of centers) {
    if (Math.abs(cx) < 1 && Math.abs(cz) < 1) continue; // the home station block keeps its own signage
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (r() > 0.55) spots.push([cx + nx * 23.2 + (nz !== 0 ? 7.5 : 0), cz + nz * 23.2 + (nx !== 0 ? 7.5 : 0), Math.atan2(nx, nz), Math.floor(r() * 3)]);
  }
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), mat(0x69727d, { metal: 0.4 }), Math.max(1, spots.length));
  poles.count = spots.length; poles.castShadow = true; poles.frustumCulled = false; root.add(poles);
  const plates = signTex.map((t) => { const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.75, 0.05), [mat(0x69727d), mat(0x69727d), mat(0x69727d), mat(0x69727d), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }), mat(0x8b929c)], Math.max(1, spots.length)); im.frustumCulled = false; im.castShadow = true; root.add(im); return im; });
  const per = [0, 0, 0];
  spots.forEach(([x, z, ry, kind], i) => {
    put(poles, i, x, 1.6, z);
    put(plates[kind], per[kind]++, x, 2.5, z, ry); // the printed face (+z of the box) points at the road
  });
  plates.forEach((im, k) => { im.count = per[k]; });
  return { signs: spots.map(([x, z]) => ({ x, z })), counts: { curb: na + nb, tactile: nt, drains: nd, arrows: ai, centerStrips: ci, signs: spots.length } };
}
