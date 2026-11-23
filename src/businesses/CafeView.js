import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat, rbox, mesh } from '../world/Materials.js';
import { Kit, shade, glassMaterial } from '../world/Buildings.js';
import { nightMaterials, textTexture } from '../world/Materials.js';
import { makeLabel } from './StationView.js';
import { CAFE_LAYOUT } from './Cafe.js';
import { BAY_SLOTS } from './ChargingStation.js';
import { cafeBuildingInfo } from '../ui/BuildingInfo.js';

const FLOOR = 0.34;
const WALK = 2.3; // m/s
const SHIRTS = [0x2f8cff, 0xe8483f, 0x3fae4a, 0xffc43d, 0x9b5cff, 0x4cc9f0];
const SKIN = [0xf2c9a0, 0xd9a273, 0x8d5a3b, 0xf7d9bd];
const FIGURES_BY_QUALITY = { low: 3, medium: 5, high: 8 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _z = new THREE.Vector3(0, 0, 1);

/**
 * Visual layer of the café, built to be cheap on phones:
 *  - the counter, the machine and the product display are ONE merged mesh (vertex colours) = one draw call
 *  - tables and stools are three InstancedMeshes (tops, legs, stools) whatever the number of tables
 *  - customers are a small pool of light figures (2 meshes each, 3 / 5 / 8 by quality preset) that is created lazily and reused
 *  - one canvas texture for the menu board and one sprite for the order status
 * Nothing is allocated per frame.
 */
export class CafeView {
  constructor({ scene, assets, colliders, nav, bus, cafe, employees = null, settings = null }) {
    Object.assign(this, { scene, assets, colliders, nav, bus, cafe, employees, settings });
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.selectables = [];
    this.tableSlots = []; // { x, z, seats: [{x, z, taken}] }
    this.visibleTables = 0;
    this.figures = new Map(); // customer id -> figure
    this.pool = [];
    this.created = 0;
    this.t = 0;
    this.dirty = true;
    this.built = false;
    this.suppressGuests = false; // the cozy café shows its own customers while it is open
    this.playerPos = null; // set by Game every frame
    this.inMgmt = false;
    this.inside = false;
    this.labelTimer = 0;
    this.syncTimer = 0;
    this.gone = []; // scratch list reused every frame: figures that finished walking out
    this.waiting = []; // scratch list: customer ids in queue order
    this.counterKey = '';
    this.offs = [
      bus.on('cafe:changed', () => { this.dirty = true; }),
      bus.on('hub:built', ({ key }) => { if (key === 'coffee') this.dirty = true; }),
    ];
    this.buildStructure();
    this.apply();
  }

  get maxFigures() { return FIGURES_BY_QUALITY[this.settings?.data?.quality] ?? 5; }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
    this.scene.remove(this.root);
    this.menuTex?.dispose();
    this.counterMesh?.geometry.dispose();
    for (const m of [this.wallMesh, this.southMesh, this.glassMesh, this.roof]) m?.geometry.dispose();
    this.windowGeo?.dispose(); this.windowMat?.dispose(); this.floor?.geometry.dispose(); this.floor?.material.dispose(); this.floorTex?.dispose();
    this.bodyGeo?.dispose();
    this.headGeo?.dispose();
    this.label?.sprite.material.map?.dispose();
    this.label?.sprite.material.dispose();
  }

  // ---------- static structure ----------
  buildStructure() {
    const r = this.root, L = CAFE_LAYOUT, b = L.building, D = L.door;
    const H = 3.4, T = 0.35;
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2; // z1 = south wall (the door side)
    const wall = 0xb8793e, trim = shade(wall, 0.55), dark = shade(wall, -0.5);
    const walls = new Kit(), glass = new Kit(), roofK = new Kit(), south = new Kit(); // `south` = the front facade (cut away in the front view)

    // ---- the four walls; the south wall is low with a see-through window band and the door gap
    walls.box(b.x, H / 2, z0 + T / 2, b.w, H, T, wall); // back
    walls.box(x0 + T / 2, H / 2, b.z, T, H, b.d, wall); // west
    walls.box(x1 - T / 2, H / 2, b.z, T, H, b.d, wall); // east
    const dl = D.x - D.w / 2, dr = D.x + D.w / 2;
    this.windows = [];
    for (const [a, c] of [[x0, dl], [dr, x1]]) {
      const w = c - a, cx = (a + c) / 2;
      south.box(cx, 0.5, z1 - T / 2, w, 1.0, T, wall); // lower wall
      south.box(cx, H - 0.25, z1 - T / 2, w, 0.5, T, wall); // band under the roof
      south.box(cx, 1.05, z1 - T / 2, w - 0.1, 0.12, T + 0.06, trim); // window sill
      this.windows.push([cx, 2.0, z1 - T / 2, w - 0.3, 1.8]);
    }
    for (const x of [x0 + T / 2, dl, dr, x1 - T / 2]) south.box(x, 1.9, z1 - T / 2, 0.14, 2.0, T + 0.08, dark); // window / door posts
    south.box(D.x, 3.12, z1 - T / 2, D.w + 0.5, 0.5, T + 0.1, trim); // lintel
    // plinth + corner posts
    for (const [px, pz, sx, sz] of [[b.x, z1 + 0.1, b.w + 0.3, 0.3], [b.x, z0 - 0.1, b.w + 0.3, 0.3], [x0 - 0.1, b.z, 0.3, b.d + 0.3], [x1 + 0.1, b.z, 0.3, b.d + 0.3]]) walls.box(px, 0.12, pz, sx, 0.24, sz, dark); // plinth ring (the floor stays open inside)
    for (const sx of [x0, x1]) for (const sz of [z0, z1]) walls.box(sx, H / 2, sz, 0.5, H, 0.5, trim);
    // glowing panes on the side walls (they light up at night)
    for (const sx of [x0 + T / 2, x1 - T / 2]) for (const zc of [b.z - 2.6, b.z + 2.6]) {
      glass.box(sx, 1.9, zc, T + 0.06, 1.5, 1.8);
      walls.box(sx, 1.9, zc, T + 0.1, 0.1, 1.9, dark); walls.box(sx, 1.9, zc, T + 0.1, 1.6, 0.1, dark);
    }
    // striped awning over the door
    const n = 7, seg = (D.w + 1.4) / n;
    for (let i = 0; i < n; i++) {
      const x = D.x - (D.w + 1.4) / 2 + seg * (i + 0.5), c = i % 2 ? 0xffffff : 0xffc43d;
      south.box(x, 3.02, z1 + 0.65, seg, 0.12, 1.3, c); south.box(x, 2.82, z1 + 1.3, seg, 0.3, 0.08, c);
    }
    // ---- interior dressing (static, merged into the same mesh)
    walls.box(D.x, 0.05, b.z + 1.2, 1.7, 0.03, b.d - 3.4, 0xb23a48); // red runner from the door to the counter
    for (const [px, pz] of [[x0 + 0.8, z1 - 0.7], [x1 - 0.8, z1 - 0.7]]) { // potted plants beside the door
      walls.box(px, 0.3, pz, 0.6, 0.6, 0.6, 0x8a5a35);
      const leaf = new THREE.IcosahedronGeometry(0.5, 1); leaf.translate(px, 1.0, pz); walls.add(leaf, 0x3fae4a);
    }
    for (const sy of [1.7, 2.4]) walls.box(16.7, sy, z0 + T + 0.2, 1.7, 0.07, 0.4, 0x7a4a28); // back-wall shelves
    for (let i = 0; i < 5; i++) { const jar = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 8); jar.translate(16.0 + i * 0.35, 1.9, z0 + T + 0.2); walls.add(jar, [0xd9a14a, 0xf2e6d2, 0x3a2415, 0xe0b96a, 0xd9a14a][i]); }
    walls.box(x0 + 1.0, 0.95, z0 + 0.9, 1.0, 1.9, 0.7, 0xdfe5ec); // fridge
    walls.box(x0 + 1.0, 1.0, z0 + 1.27, 0.05, 1.5, 0.02, 0x9aa5b1);
    for (const [lx, lz] of [[15.2, -10.5], [19.9, -10.5], [19.1, -14.3]]) { // pendant lamps over the tables and the queue
      walls.box(lx, 3.0, lz, 0.03, 0.8, 0.03, 0x2a2f36);
      const bulb = new THREE.SphereGeometry(0.24, 10, 8); bulb.translate(lx, 2.5, lz); glass.add(bulb, 0xfff2c8);
    }
    const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }); // shared: a theme tints the front facade too
    this.wallMesh = walls.build(wallMat);
    this.wallMesh.position.y = FLOOR;
    this.southMesh = south.build(wallMat); this.southMesh.position.y = FLOOR;
    this.glassMesh = glass.build(glassMaterial());
    this.glassMesh.castShadow = false; this.glassMesh.position.y = FLOOR;

    // see-through shop windows in the south wall (a single transparent material for both)
    this.windowMat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false });
    this.windowGeo = new THREE.BoxGeometry(1, 1, 0.06);
    this.windowMeshes = this.windows.map(([cx, cy, cz, w, h]) => { const m = new THREE.Mesh(this.windowGeo, this.windowMat); m.scale.set(w, h, 1); m.position.set(cx, FLOOR + cy, cz); return m; });

    // floor: warm checker tiles (the lot asphalt stays outside)
    const fc = document.createElement('canvas'); fc.width = fc.height = 64;
    const fg = fc.getContext('2d'); fg.fillStyle = '#e8d3a8'; fg.fillRect(0, 0, 64, 64); fg.fillStyle = '#c9a56a'; fg.fillRect(0, 0, 32, 32); fg.fillRect(32, 32, 32, 32);
    this.floorTex = new THREE.CanvasTexture(fc); this.floorTex.wrapS = this.floorTex.wrapT = THREE.RepeatWrapping; this.floorTex.colorSpace = THREE.SRGBColorSpace;
    this.floorTex.repeat.set((b.w - 2 * T) / 1.6, (b.d - 2 * T) / 1.6);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(b.w - 2 * T, b.d - 2 * T), new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.85 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.set(b.x, FLOOR + 0.03, b.z); this.floor.receiveShadow = true;

    // roof (hidden while the player is inside or in the management view) with a big coffee cup on top
    roofK.box(b.x, H + 0.15, b.z, b.w + 0.6, 0.3, b.d + 0.6, 0xf4f7fa);
    for (const [px, pz, sx, sz] of [[b.x, z1 + 0.15, b.w + 0.6, 0.3], [b.x, z0 - 0.15, b.w + 0.6, 0.3], [x0 - 0.15, b.z, 0.3, b.d + 0.6], [x1 + 0.15, b.z, 0.3, b.d + 0.6]]) roofK.box(px, H + 0.6, pz, sx, 0.6, sz, trim);
    roofK.box(b.x + 2.0, H + 1.1, b.z - 3.0, 1.8, 1.0, 1.4, 0xb5bdc7);
    roofK.cyl(b.x, H + 1.0, b.z + 1.0, 1.1, 0.15, 0xf4f7fa, 18); roofK.cyl(b.x, H + 1.9, b.z + 1.0, 0.8, 1.5, 0xffffff, 18);
    const handle = new THREE.TorusGeometry(0.45, 0.11, 8, 14); handle.translate(b.x + 0.95, H + 1.9, b.z + 1.0); roofK.add(handle, 0x8a5a35);
    this.roof = roofK.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }));
    this.roof.position.y = FLOOR;
    // "CAFE" sign above the door (always visible, even without the roof)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.75), new THREE.MeshBasicMaterial({ map: textTexture('CAFE', { bg: '#5a3a22', fg: '#ffffff', w: 256, h: 64 }) }));
    sign.position.set(D.x, FLOOR + H + 0.85, z1 + 0.34);
    nightMaterials.add(glassMaterial());

    // the whole building is one selectable group (the roof is hidden while the player is inside)
    this.building = new THREE.Group();
    this.sign = sign;
    this.building.add(this.floor, this.wallMesh, this.southMesh, this.glassMesh, ...this.windowMeshes, this.roof, sign);
    this.building.traverse((o) => { if (o.isMesh && o !== this.floor) { o.castShadow = o !== this.glassMesh && !this.windowMeshes.includes(o); o.receiveShadow = true; } });
    this.building.userData.select = () => cafeBuildingInfo(this);
    this.building.userData.focus = new THREE.Vector3(b.x, 0, b.z);
    r.add(this.building);
    this.selectables.push(this.building);
    this.doorPos = new THREE.Vector3(D.x, FLOOR, D.z);
    this.counterPos = new THREE.Vector3(L.counter.x, FLOOR + 1.2, L.counter.z);
    this.counterRect = { x: L.counter.x, z: L.counter.z, w: L.counter.w + 0.3, d: 1.1 };

    // counter: one mesh, rebuilt only when the menu changes (see rebuildCounter)
    this.counterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });
    this.counterMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.counterMat);
    this.counterMesh.castShadow = true;
    this.counterMesh.position.set(L.counter.x, FLOOR, L.counter.z);
    r.add(this.counterMesh);

    // menu board on the back wall, above the counter (one canvas texture, redrawn when prices / the menu change)
    this.menuCanvas = document.createElement('canvas');
    this.menuCanvas.width = 256; this.menuCanvas.height = 256;
    this.menuTex = new THREE.CanvasTexture(this.menuCanvas);
    this.menuTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: this.menuTex }));
    board.position.set(L.counter.x, FLOOR + 2.1, z0 + T + 0.04);
    r.add(board);

    // tables and stools: three instanced meshes for all of them (count = how many are unlocked)
    const nt = L.tables.length;
    this.tops = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 14), mat(0xf1e2c8), nt);
    this.legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 0.7, 8), mat(0x7a4a28), nt);
    this.stools = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.22, 0.45, 10), mat(0x2f8cff), nt * 2);
    L.tables.forEach((t, i) => {
      const seats = [];
      this.place(this.tops, i, t.x, FLOOR + 0.76, t.z);
      this.place(this.legs, i, t.x, FLOOR + 0.38, t.z);
      [-0.85, 0.85].forEach((sx, k) => { this.place(this.stools, i * 2 + k, t.x + sx, FLOOR + 0.22, t.z); seats.push({ x: t.x + sx, z: t.z + 0.1, taken: null }); });
      this.tableSlots.push({ x: t.x, z: t.z, seats, collider: null });
    });
    for (const m of [this.tops, this.legs, this.stools]) { m.count = 0; m.castShadow = true; m.frustumCulled = false; r.add(m); }

    // status label above the counter (above the roof line, so it stays readable)
    this.label = makeLabel(3.4);
    this.label.sprite.position.set(L.counter.x, 4.6, L.counter.z);
    this.label.sprite.visible = false;
    r.add(this.label.sprite);
  }

  /** Front view: the roof and the whole front facade (wall, windows, awning, sign) are cut away so the room can be seen from the street. */
  setCutaway(on) {
    this.cutaway = !!on;
    for (const m of [this.southMesh, this.sign, ...(this.windowMeshes || [])]) if (m) m.visible = !on;
  }

  /** Where the floating Café button hangs: over the door from outside, over the counter once the player is inside. */
  buttonPos() { return this.inside ? this.counterPos : this.doorPos; }

  place(inst, i, x, y, z) {
    _p.set(x, y, z);
    inst.setMatrixAt(i, _m.compose(_p, _q.identity(), _s));
    inst.instanceMatrix.needsUpdate = true;
  }

  /** Counter + machine + the products that are on the menu, merged into one vertex-coloured mesh. */
  rebuildCounter() {
    const c = CAFE_LAYOUT.counter, products = this.cafe.products();
    const key = products.map((p) => (p.available ? 1 : 0)).join('');
    if (key === this.counterKey) return;
    this.counterKey = key;
    const parts = [
      { geo: rbox(c.w, 1.0, 0.9, 0.08, 1), color: 0x7a4a28, at: [0, 0.5, 0] },
      { geo: rbox(c.w + 0.2, 0.1, 1.05, 0.04, 1), color: 0xf1e2c8, at: [0, 1.05, 0] },
      { geo: rbox(0.9, 0.55, 0.5, 0.06, 1), color: 0xc9ced6, at: [-c.w / 2 + 0.6, 1.4, 0] },
      { geo: new THREE.CylinderGeometry(0.1, 0.1, 0.25, 8), color: 0x2a2f36, at: [-c.w / 2 + 0.35, 1.2, 0.28], own: true },
    ];
    const kinds = { espresso: [0x3a2415, 'cup'], croissant: [0xd9a14a, 'pastry'], latte: [0xf2e6d2, 'cup'], sandwich: [0xe0b96a, 'pastry'], iced: [0x9fd8ff, 'cup'] };
    products.forEach((p, i) => {
      if (!p.available) return;
      const [color, shape] = kinds[p.id] || [0xffffff, 'cup'];
      const geo = shape === 'cup' ? new THREE.CylinderGeometry(0.16, 0.12, 0.28, 10) : new THREE.CapsuleGeometry(0.12, 0.3, 3, 8);
      parts.push({ geo, color, at: [-0.3 + i * 0.45, 1.3, 0.12], rotZ: shape === 'cup' ? 0 : Math.PI / 2, own: true });
    });
    const pieces = parts.map(({ geo, color, at, rotZ = 0, own }) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.deleteAttribute('uv'); // only position / normal / colour so the pieces can be merged
      _p.set(at[0], at[1], at[2]); _q.setFromAxisAngle(_z, rotZ);
      g.applyMatrix4(_m.compose(_p, _q, _s));
      const col = new THREE.Color(color), arr = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < arr.length; k += 3) { arr[k] = col.r; arr[k + 1] = col.g; arr[k + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      if (own) geo.dispose(); // the one-off shapes are not cached anywhere
      return g;
    });
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    this.counterMesh.geometry.dispose();
    this.counterMesh.geometry = merged;
  }

  // ---------- state sync ----------
  /** Show / hide the café and add its colliders once it exists (the staff walking grid is rebuilt so nobody walks through it). */
  apply() {
    const built = this.cafe.built;
    if (built !== this.built) {
      this.built = built;
      this.root.visible = built;
      if (built && !this.colliderBoxes) {
        const b = CAFE_LAYOUT.building, D = CAFE_LAYOUT.door, cr = this.counterRect, T = 0.35;
        const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, dl = D.x - D.w / 2, dr = D.x + D.w / 2;
        // four walls (the south one has the door gap) + the counter: the inside is a real room people walk into
        this.colliderBoxes = [
          this.colliders.add(b.x, z0 + T / 2, b.w, T, 5), this.colliders.add(x0 + T / 2, b.z, T, b.d, 5), this.colliders.add(x1 - T / 2, b.z, T, b.d, 5),
          this.colliders.add((x0 + dl) / 2, z1 - T / 2, dl - x0, T, 5), this.colliders.add((dr + x1) / 2, z1 - T / 2, x1 - dr, T, 5),
          this.colliders.add(cr.x, cr.z, cr.w, cr.d, 1.3),
        ];
        this.nav?.rebuild(this.colliders);
      }
    }
    if (!built) return;
    // tables follow the seating level (2 seats per table)
    const want = Math.min(this.tableSlots.length, Math.ceil(this.cafe.seats / 2));
    this.visibleTables = want;
    this.tops.count = this.legs.count = want; this.stools.count = want * 2;
    let added = false;
    this.tableSlots.forEach((t, i) => { if (i < want && !t.collider) { t.collider = this.colliders.add(t.x, t.z, 2.2, 1.3, 1); added = true; } });
    if (added) this.nav?.rebuild(this.colliders);
    this.rebuildCounter();
    this.drawMenu();
    this.dirty = false;
  }

  drawMenu() {
    const g = this.menuCanvas.getContext('2d'), W = 256;
    g.fillStyle = '#2a2018'; g.fillRect(0, 0, W, W);
    g.strokeStyle = '#d9a14a'; g.lineWidth = 8; g.strokeRect(6, 6, W - 12, W - 12);
    g.fillStyle = '#ffd98a'; g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('MENU', W / 2, 44);
    g.font = 'bold 22px system-ui, sans-serif';
    let y = 80;
    for (const p of this.cafe.products()) {
      if (!p.unlocked) continue;
      g.fillStyle = p.available ? '#ffffff' : '#7a6f62';
      g.textAlign = 'left'; g.fillText(p.label, 22, y);
      g.textAlign = 'right'; g.fillText(p.available ? `$${p.price.toFixed(2)}` : 'off', W - 22, y);
      y += 32;
    }
    this.menuTex.needsUpdate = true;
  }

  // ---------- customers ----------
  /** A café guest: a capsule body and a head (2 draw calls, shared geometry and materials), bobbing when it walks. */
  makeFigure() {
    if (this.pool.length) return this.pool.pop();
    if (this.created >= this.maxFigures) return null; // the simulation never depends on how many figures are shown
    const i = this.created++;
    this.bodyGeo ||= new THREE.CapsuleGeometry(0.28, 1.0, 3, 8);
    this.headGeo ||= new THREE.SphereGeometry(0.26, 10, 8);
    const model = new THREE.Group();
    const body = mesh(this.bodyGeo, mat(SHIRTS[i % SHIRTS.length]), { y: 0.8 });
    const head = mesh(this.headGeo, mat(SKIN[i % SKIN.length]), { y: 1.78 });
    model.add(body, head);
    model.userData.body = body;
    this.root.add(model);
    return { model, phase: Math.random() * 6, x: 0, z: 0, target: null, leaving: false, seat: null };
  }

  /** Walking bob and a little sway; standing still breathes slowly. */
  animateGuest(f, moving, dt) {
    const b = f.model.userData.body;
    if (moving) { f.phase += dt * 7; b.position.y = 0.8 + Math.abs(Math.sin(f.phase)) * 0.07; b.rotation.z = Math.sin(f.phase * 0.5) * 0.08; }
    else { b.position.y = 0.8 + Math.sin(this.t * 2 + f.phase) * 0.012; b.rotation.z = 0; }
    f.model.children[1].position.y = b.position.y + 0.98;
  }

  startPoint(c) {
    if (c.kind === 'charging' && c.ref?.bayId != null) return { x: BAY_SLOTS[c.ref.bayId] + (BAY_SLOTS[c.ref.bayId] < 0 ? 2.4 : -2.4), z: 2.4 };
    return { ...CAFE_LAYOUT.entry };
  }

  /** Next point to walk to: guests always cross the wall through the door, never through it. */
  stopFor(f, tg) {
    const D = CAFE_LAYOUT.door, zin = (z) => z < D.z - 0.15;
    if (zin(f.z) === zin(tg.z)) return tg;
    const outside = !zin(f.z), aligned = Math.abs(f.x - D.x) < 0.45;
    const side = aligned ? !outside : outside; // aligned with the door: go straight through; otherwise reach the door line on this side first
    return { x: D.x, z: D.z + (side ? 0.9 : -0.9) };
  }

  assignSeat(f) {
    for (let i = 0; i < this.visibleTables; i++) {
      const s = this.tableSlots[i].seats.find((q) => !q.taken);
      if (s) { s.taken = f; f.seat = s; return s; }
    }
    return null;
  }

  releaseSeat(f) { if (f.seat) { f.seat.taken = null; f.seat = null; } }

  syncFigures() {
    // new customers get a figure
    for (const c of this.cafe.customers.values()) {
      if (this.figures.has(c.id)) continue;
      const f = this.makeFigure();
      if (!f) break;
      const p = this.startPoint(c);
      f.x = p.x; f.z = p.z; f.leaving = false; f.customer = c; f.model.visible = true;
      this.figures.set(c.id, f);
    }
    const waiting = this.waiting;
    waiting.length = 0;
    for (const o of this.cafe.orders) waiting.push(o.customer.id);
    for (const [id, f] of this.figures) {
      const c = this.cafe.customers.get(id);
      if (!c) { // customer is gone: walk out, then return the figure to the pool
        if (!f.leaving) { f.leaving = true; this.releaseSeat(f); f.target = f.customer?.kind === 'charging' ? this.startPoint(f.customer) : { ...CAFE_LAYOUT.entry }; }
        continue;
      }
      if (c.state === 'eating') {
        if (!f.seat && !f.sitTried) { f.sitTried = true; this.assignSeat(f); }
        f.target = f.seat ? f.seat : { x: CAFE_LAYOUT.door.x + 2.4, z: CAFE_LAYOUT.door.z - 1.6 };
      } else {
        const i = waiting.indexOf(id);
        f.target = CAFE_LAYOUT.queue[Math.max(0, Math.min(i < 0 ? 0 : i, CAFE_LAYOUT.queue.length - 1))];
      }
    }
  }

  moveFigures(dt) {
    const gone = this.gone;
    gone.length = 0;
    for (const [id, f] of this.figures) {
      const goal = f.target, tg = goal ? this.stopFor(f, goal) : null;
      let moving = false;
      if (tg) {
        const dx = tg.x - f.x, dz = tg.z - f.z, d = Math.hypot(dx, dz);
        if (d > 0.08) {
          const s = Math.min(d, WALK * dt);
          f.x += (dx / d) * s; f.z += (dz / d) * s;
          f.model.rotation.y = Math.atan2(-dx, -dz);
          moving = true;
        } else if (tg !== goal) { // at a doorway point: the next frame continues towards the real target
          f.x = tg.x; f.z = tg.z;
        } else if (f.leaving) { // arrived at the exit: back to the pool
          f.model.visible = false; gone.push(id); this.pool.push(f); f.sitTried = false; f.target = null; continue;
        } else {
          f.model.rotation.y = f.seat ? Math.PI : 0; // standing in the queue: face the counter (north = -z); seated: face the table
        }
      }
      f.model.position.set(f.x, FLOOR + (f.seat ? -0.3 : 0), f.z);
      f.model.visible = !this.suppressGuests;
      this.animateGuest(f, moving, dt);
    }
    for (const id of gone) this.figures.delete(id);
  }

  updateLabel() {
    const c = this.cafe, n = c.orders.length;
    this.label.sprite.visible = c.built && n > 0;
    if (!n) return;
    const o = c.orders.find((x) => x.state === 'preparing') || c.orders[0];
    const p = c.cfg.products[o.pid];
    this.label.draw({ title: `${n} order${n > 1 ? 's' : ''}`, sub: `${p.icon} ${p.label}${o.state === 'preparing' ? '' : ' · waiting'}`, pct: o.state === 'preparing' ? o.progress : 0, color: '#b8793e' });
  }

  update(dt) {
    this.t += dt;
    if (this.dirty || this.cafe.built !== this.built) this.apply();
    if (!this.built) return;
    this.syncTimer -= dt;
    if (this.syncTimer <= 0) { this.syncTimer = 0.2; this.syncFigures(); } // who goes where: 5x a second; walking is smooth every frame
    this.moveFigures(dt);
    // the roof is lifted while the player is inside the café or looking from the management camera
    const p = this.playerPos, b = CAFE_LAYOUT.building;
    this.inside = !!p && Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.z - b.z) < b.d / 2;
    const roofOn = !(this.inside || this.inMgmt || this.cutaway);
    if (roofOn !== this.roof.visible) this.roof.visible = roofOn;
    this.labelTimer -= dt;
    if (this.labelTimer <= 0) { this.labelTimer = 0.25; this.updateLabel(); }
  }
}
