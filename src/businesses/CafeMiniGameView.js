import * as THREE from 'three';
import { mat, mesh } from '../world/Materials.js';
import { CAFE_LAYOUT } from './Cafe.js';

const FLOOR = 0.34;
const WALK = 2.6;
const SKIN = [0xf2c9a0, 0xd9a273, 0x8d5a3b, 0xf7d9bd];
const MAX_BY_QUALITY = { low: 3, medium: 4, high: 5 };

/**
 * The 3D side of the café mini-game: the virtual customers stand in the café queue with an order bubble above their head,
 * walk out when served (or when they give up), and the finished products sit on the pickup counter. A small pool of light
 * figures (capsule + head + one accessory) and one sprite per figure / pickup slot: nothing is allocated per frame.
 * It only draws what CafeMiniGame says; it never changes any game state.
 */
export class CafeMiniGameView {
  constructor({ cafeView, mg, settings = null }) {
    this.cv = cafeView; this.mg = mg; this.settings = settings;
    this.group = new THREE.Group();
    this.group.visible = false;
    cafeView.root.add(this.group);
    this.figs = new Map();   // customer id -> figure
    this.pool = [];
    this.created = 0;
    this.t = 0;
    this.shown = false;
    this.bodyGeo = new THREE.CapsuleGeometry(0.28, 1.0, 3, 8);
    this.headGeo = new THREE.SphereGeometry(0.26, 10, 8);
    this.crownGeo = new THREE.CylinderGeometry(0.2, 0.26, 0.2, 6);
    this.hatGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 14);
    this.hatTopGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.22, 10);
    this.bandGeo = new THREE.BoxGeometry(0.56, 0.08, 0.56);
    this.bodyMats = {};
    this.pickupSprites = [];
    for (let i = 0; i < mg.k.timing.pickupMax; i++) { const sp = this.makeSprite(0.9, 0.9); sp.userData.key = ''; sp.visible = false; this.group.add(sp); this.pickupSprites.push(sp); }
  }

  get maxFigures() { return MAX_BY_QUALITY[this.settings?.data?.quality] ?? 4; }

  dispose() {
    this.cv.root.remove(this.group);
    for (const g of [this.bodyGeo, this.headGeo, this.crownGeo, this.hatGeo, this.hatTopGeo, this.bandGeo]) g.dispose();
    this.group.traverse((o) => { if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); } });
  }

  makeSprite(w, h) {
    const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * (h / w));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(w * 2.4, h * 2.4, 1);
    sp.userData.canvas = c; sp.userData.key = null;
    return sp;
  }

  bodyMat(color) { return (this.bodyMats[color] ||= mat(new THREE.Color(color).getHex())); }

  makeFigure() {
    if (this.pool.length) return this.pool.pop();
    if (this.created >= this.maxFigures) return null;
    const i = this.created++, model = new THREE.Group();
    const body = mesh(this.bodyGeo, this.bodyMat('#2f8cff'), { y: 0.8 });
    const head = mesh(this.headGeo, mat(SKIN[i % SKIN.length]), { y: 1.78 });
    const crown = mesh(this.crownGeo, mat(0xffc43d), { y: 2.12, cast: false });
    const hat = new THREE.Group(); hat.position.y = 2.0; hat.add(mesh(this.hatGeo, mat(0x35c28a), { cast: false }), mesh(this.hatTopGeo, mat(0x35c28a), { y: 0.12, cast: false }));
    const band = mesh(this.bandGeo, mat(0xe8483f), { y: 1.9, cast: false });
    model.add(body, head, crown, hat, band);
    const bubble = this.makeSprite(1.5, 0.62); bubble.position.set(0, 3.1, 0); model.add(bubble);
    this.group.add(model);
    return { model, body, head, crown, hat, band, bubble, phase: Math.random() * 6, x: 0, z: 0, target: null, leaving: false, customer: null };
  }

  /** Order bubble: the order's icons (served ones ticked) and a patience bar. Redrawn only when it changes. */
  drawBubble(f, c) {
    const mg = this.mg, frac = Math.max(0, Math.min(1, c.patience / c.maxPatience));
    const key = `${c.items.join()}|${c.served.join()}|${Math.round(frac * 12)}`;
    if (f.bubble.userData.key === key) return;
    f.bubble.userData.key = key;
    const cv = f.bubble.userData.canvas, g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#fffaf0'; g.strokeStyle = frac < 0.34 ? '#e8483f' : '#b8793e'; g.lineWidth = 8;
    g.beginPath(); g.roundRect(6, 6, W - 12, H - 34, 26); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(W / 2 - 16, H - 28); g.lineTo(W / 2, H - 4); g.lineTo(W / 2 + 16, H - 28); g.fillStyle = '#fffaf0'; g.fill();
    g.font = '58px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const left = [...c.items]; const done = [...c.served];
    const n = c.items.length, step = Math.min(84, (W - 40) / n), x0 = W / 2 - (step * (n - 1)) / 2, cy = (H - 34) / 2 + 4;
    c.items.forEach((pid, i) => {
      const isDone = done.includes(pid) && (done.splice(done.indexOf(pid), 1), true);
      g.globalAlpha = isDone ? 0.35 : 1;
      g.fillText(mg.productIcon(pid), x0 + i * step, cy);
      g.globalAlpha = 1;
      if (isDone) { g.fillStyle = '#2f9e6a'; g.font = 'bold 40px system-ui'; g.fillText('✓', x0 + i * step + 22, cy + 18); g.font = '58px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; }
    });
    void left;
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(24, H - 58, W - 48, 10);
    g.fillStyle = frac < 0.34 ? '#e8483f' : frac < 0.67 ? '#ffc43d' : '#38d996'; g.fillRect(24, H - 58, (W - 48) * frac, 10);
    f.bubble.material.map.needsUpdate = true;
  }

  assign(f, c) {
    f.customer = c; f.leaving = false;
    f.body.material = this.bodyMat(c.color);
    f.crown.visible = c.type === 'vip'; f.hat.visible = c.type === 'tourist'; f.band.visible = c.type === 'rusher';
    const p = { ...CAFE_LAYOUT.entry };
    f.x = p.x; f.z = p.z; f.model.visible = true; f.bubble.visible = true; f.bubble.userData.key = null;
  }

  sync() {
    const s = this.mg.session, active = this.mg.state === 'running' && !!s;
    const present = new Set();
    if (active) {
      s.customers.forEach((c, i) => {
        present.add(c.id);
        let f = this.figs.get(c.id);
        if (!f) { f = this.makeFigure(); if (!f) return; this.assign(f, c); this.figs.set(c.id, f); }
        f.target = CAFE_LAYOUT.queue[Math.min(i, CAFE_LAYOUT.queue.length - 1)];
        this.drawBubble(f, c);
      });
    }
    for (const [id, f] of this.figs) if (!present.has(id) && !f.leaving) { f.leaving = true; f.target = { ...CAFE_LAYOUT.entry }; f.bubble.visible = false; }
    // pickup counter: one sprite per finished product
    const c = CAFE_LAYOUT.counter;
    this.pickupSprites.forEach((sp, i) => {
      const p = active ? s.pickup[i] : null;
      sp.visible = !!p;
      if (!p) return;
      sp.position.set(c.x + 1.0 - i * 0.8, FLOOR + 1.9, c.z + 0.2);
      if (sp.userData.key !== p.id) {
        sp.userData.key = p.id;
        const cv = sp.userData.canvas, g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
        g.fillStyle = 'rgba(255,250,240,.95)'; g.beginPath(); g.arc(cv.width / 2, cv.height / 2, cv.width / 2 - 14, 0, Math.PI * 2); g.fill();
        g.strokeStyle = p.mistakes === 0 && p.q >= 0.95 ? '#ffc43d' : '#b8793e'; g.lineWidth = 10; g.stroke();
        g.font = '120px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(this.mg.productIcon(p.pid), cv.width / 2, cv.height / 2 + 8);
        sp.material.map.needsUpdate = true;
      }
    });
  }

  /** Show or hide the whole layer (called when the session starts / the screen closes). */
  setShown(on) {
    if (on === this.shown) return;
    this.shown = on;
    this.group.visible = on;
    this.cv.suppressGuests = on; // the real café customers step out of the picture while the game is on
    if (!on) for (const [id, f] of [...this.figs]) { f.model.visible = false; this.pool.push(f); this.figs.delete(id); f.target = null; }
  }

  update(dt) {
    if (!this.shown) return;
    this.t += dt;
    this.sync();
    const gone = [];
    for (const [id, f] of this.figs) {
      const goal = f.target, tg = goal ? this.cv.stopFor(f, goal) : null;
      let moving = false;
      if (tg) {
        const dx = tg.x - f.x, dz = tg.z - f.z, d = Math.hypot(dx, dz);
        if (d > 0.08) { const s = Math.min(d, WALK * dt); f.x += (dx / d) * s; f.z += (dz / d) * s; f.model.rotation.y = Math.atan2(-dx, -dz); moving = true; }
        else if (tg !== goal) { f.x = tg.x; f.z = tg.z; }
        else if (f.leaving) { f.model.visible = false; gone.push(id); this.pool.push(f); f.target = null; continue; }
        else f.model.rotation.y = 0; // waiting at the counter: face it
      }
      f.model.position.set(f.x, FLOOR, f.z);
      if (moving) { f.phase += dt * 7; f.body.position.y = 0.8 + Math.abs(Math.sin(f.phase)) * 0.07; } else f.body.position.y = 0.8 + Math.sin(this.t * 2 + f.phase) * 0.012;
      f.head.position.y = f.body.position.y + 0.98;
    }
    for (const id of gone) this.figs.delete(id);
  }
}
