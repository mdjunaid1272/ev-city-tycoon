import { CafeRecipeManager } from './CafeRecipeManager.js';

/**
 * The optional café mini-game (pure logic: no DOM, no Three.js, no dependency on the café business simulation).
 *
 * A session is a short timed "serving game": virtual customers arrive with orders, the player picks ingredients, runs the
 * machines, collects the product at the pickup counter and serves the right customer. Score, combos, perfect orders and
 * star ratings are session-only; the only link to the city economy is ONE capped payout at the end of a session through
 * EconomyManager.grant (a grant, not revenue: it never counts towards stage goals or the café's own statistics).
 *
 * Anti-farming: a per-session coin cap, a daily coin cap, a daily number of rewarded sessions and a cooldown between rewarded
 * sessions. Beyond those limits a session is still playable (practice) but pays nothing. A session pays exactly once.
 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round2 = (n) => Math.round(n * 100) / 100;
let seq = 0;

export class CafeMiniGame {
  constructor({ economy, bus, cfg, saved = null, getDay = () => 1, getMachineLevel = () => 0, now = () => Date.now(), rng = Math.random }) {
    Object.assign(this, { economy, bus, getDay, getMachineLevel, now, rng });
    this.cafeCfg = cfg;
    this.k = cfg.miniGame;
    this.recipes = new CafeRecipeManager(this.k);
    const s = saved && typeof saved === 'object' ? saved : {};
    const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
    this.meta = {
      best: {}, plays: num(s.plays), coins: round2(num(s.coins)), day: num(s.day), dayPlays: num(s.dayPlays), dayCoins: round2(num(s.dayCoins)), lastEnd: num(s.lastEnd),
    };
    for (const mode of Object.keys(this.k.modes)) {
      const b = s.best?.[mode];
      if (b && Number.isFinite(b.score) && b.score >= 0) this.meta.best[mode] = { score: Math.round(b.score), stars: clamp(Math.round(b.stars) || 0, 0, 3) };
    }
    this.state = 'idle'; // idle | running | ended
    this.session = null;
    this.result = null;
    this.note = null;
    this.noteId = 0;
  }

  // ---------- limits ----------
  rollDay() {
    const d = this.getDay();
    if (this.meta.day !== d) { this.meta.day = d; this.meta.dayPlays = 0; this.meta.dayCoins = 0; }
  }
  /** What the menu shows before a session: is it rewarded, and how much of today's allowance is left. */
  status() {
    this.rollDay();
    const R = this.k.rewards;
    const cooldownLeft = Math.max(0, (this.meta.lastEnd + R.cooldownSeconds * 1000 - this.now()) / 1000);
    const playsLeft = Math.max(0, R.maxSessionsPerDay - this.meta.dayPlays), coinsLeft = Math.max(0, round2(R.dayCoinCap - this.meta.dayCoins));
    const rewarded = playsLeft > 0 && coinsLeft > 0 && cooldownLeft <= 0;
    const why = playsLeft <= 0 ? 'Daily reward sessions used up' : coinsLeft <= 0 ? 'Daily coin limit reached' : cooldownLeft > 0 ? `Reward cooldown: ${Math.ceil(cooldownLeft)}s` : '';
    return { rewarded, playsLeft, coinsLeft, cooldownLeft, why, dayCoinCap: R.dayCoinCap, maxSessionsPerDay: R.maxSessionsPerDay };
  }
  get running() { return this.state === 'running'; }
  say(text, kind = 'info') { this.note = { text, kind, id: ++this.noteId }; }
  productLabel(pid) { return this.cafeCfg.products[pid].label; }
  productIcon(pid) { return this.cafeCfg.products[pid].icon; }

  // ---------- session lifecycle ----------
  start(mode = 'quick') {
    const m = this.k.modes[mode];
    if (!m) return { ok: false, reason: 'Unknown mode' };
    if (this.running) return { ok: false, reason: 'Already playing' };
    const st = this.status();
    this.session = {
      id: `mg${++seq}-${this.now()}`, mode, cfg: m, rewarded: st.rewarded, rewardNote: st.why,
      time: 0, left: m.seconds, score: 0, coins: 0, combo: 0, bestCombo: 0, served: 0, perfect: 0, wrong: 0, lost: 0, strikes: 0, mistakes: 0,
      level: 1, spawnTimer: 0.6, customers: [], pickup: [], build: null, jobs: {}, activeId: null, paid: false,
    };
    this.state = 'running'; this.result = null; this.note = null;
    this.bus?.emit('minigame:started', { mode });
    return { ok: true };
  }

  /** Leave the session early: coins earned so far are still paid (within the same caps), no star bonus. */
  quit() { if (this.running) this.end('quit'); }
  /** Close the results screen. */
  dismiss() { if (this.state === 'ended') { this.state = 'idle'; this.session = null; } }

  stars(score, m) { return m.stars.filter((t) => score >= t).length; }

  end(reason) {
    const s = this.session;
    if (!s || this.state !== 'running') return null;
    this.state = 'ended';
    const m = s.cfg, R = this.k.rewards;
    const stars = reason === 'quit' ? 0 : this.stars(s.score, m);
    this.rollDay();
    let payout = 0, limited = '';
    if (s.rewarded && !s.paid) {
      const wanted = s.coins + (R.starBonus[stars] || 0);
      const room = Math.max(0, R.dayCoinCap - this.meta.dayCoins);
      payout = round2(Math.max(0, Math.min(wanted, m.coinCap, room)));
      if (payout < round2(wanted)) limited = wanted > m.coinCap ? 'session cap' : 'daily cap';
      if (payout > 0) this.economy.grant({ cash: payout });
      this.meta.dayCoins = round2(this.meta.dayCoins + payout);
      this.meta.dayPlays++;
      this.meta.coins = round2(this.meta.coins + payout);
    }
    s.paid = true;
    const prev = this.meta.best[s.mode];
    const newBest = !prev || s.score > prev.score;
    if (newBest) this.meta.best[s.mode] = { score: Math.max(0, Math.round(s.score)), stars: Math.max(stars, prev?.stars || 0) };
    else if (stars > prev.stars) prev.stars = stars;
    this.meta.plays++;
    this.meta.lastEnd = this.now();
    this.result = { reason, mode: s.mode, score: Math.max(0, Math.round(s.score)), stars, served: s.served, perfect: s.perfect, wrong: s.wrong, lost: s.lost, bestCombo: s.bestCombo, coinsEarned: round2(s.coins), payout, limited, rewarded: s.rewarded, rewardNote: s.rewardNote, newBest };
    this.bus?.emit('minigame:ended', this.result);
    return this.result;
  }

  // ---------- customers ----------
  levelOf(s) { return Math.min(this.k.scoring.maxLevel, 1 + Math.floor(s.served / this.k.scoring.servedPerLevel)); }

  pickType(s) {
    const entries = Object.entries(this.k.customers).filter(([, t]) => t.fromLevel <= s.level).map(([id, t]) => [id, t.weight + t.grow * (s.level - 1)]);
    let r = this.rng() * entries.reduce((a, [, w]) => a + w, 0);
    for (const [id, w] of entries) { r -= w; if (r <= 0) return id; }
    return entries[0][0];
  }

  spawnCustomer() {
    const s = this.session, typeId = this.pickType(s), t = this.k.customers[typeId];
    const pool = t.pool.filter((pid) => this.k.products[pid].tier <= s.level);
    const items = [];
    for (let i = 0; i < t.count; i++) items.push((pool.length ? pool : ['espresso'])[Math.floor(this.rng() * (pool.length || 1))]);
    const patience = t.patience * Math.max(0.6, 1 - 0.04 * (s.level - 1));
    const c = { id: `c${++seq}`, type: typeId, label: t.label, icon: t.icon, color: t.color, mult: t.mult, patience, maxPatience: patience, items, served: [], spawnedAt: s.time };
    s.customers.push(c);
    this.bus?.emit('minigame:customer', { customer: c });
    return c;
  }

  remaining(c) {
    const left = [...c.items];
    for (const p of c.served) { const i = left.indexOf(p); if (i >= 0) left.splice(i, 1); }
    return left;
  }
  customer(id) { return this.session?.customers.find((c) => c.id === id) || null; }
  /** Most impatient customer that still needs something. */
  urgent() { return [...this.session.customers].sort((a, b) => a.patience / a.maxPatience - b.patience / b.maxPatience)[0] || null; }

  // ---------- the workbench ----------
  /** Which customer / product the player is building for (starts one when the bench is empty). */
  ensureBuild() {
    const s = this.session;
    if (s.build) return { ok: true };
    let c = this.customer(s.activeId);
    if (!c) { c = this.urgent(); if (!c) { this.say('No customers yet.', 'warn'); return { ok: false, reason: 'no customer' }; } s.activeId = c.id; }
    const left = this.remaining(c).filter((p) => !s.pickup.some((x) => x.pid === p && x.cid === c.id));
    const pid = left[0] || this.remaining(c)[0];
    if (!pid) return { ok: false, reason: 'nothing to make' };
    s.build = { cid: c.id, pid, tray: [], used: {}, mistakes: 0 };
    this.say(`Making ${this.productLabel(pid)} for ${c.label}`, 'info');
    return { ok: true };
  }

  mistake(text) {
    const s = this.session;
    if (s.build) s.build.mistakes++;
    s.mistakes++;
    this.say(text, 'bad');
  }

  addIngredient(raw) {
    const s = this.session;
    if (!this.running || !this.k.ingredients[raw]) return { ok: false, reason: 'not running' };
    const b0 = this.ensureBuild();
    if (!b0.ok) return b0;
    const b = s.build, R = this.recipes;
    if (!R.acceptsRaw(b.pid, b.used, raw)) { this.mistake(`${this.k.ingredients[raw].label} is not needed for a ${this.productLabel(b.pid)}`); return { ok: false, reason: 'wrong' }; }
    if (b.tray.length >= this.k.timing.trayMax) { this.say('The tray is full. Use a machine first.', 'warn'); return { ok: false, reason: 'full' }; }
    b.tray.push({ t: raw, q: 1, raw: { [raw]: 1 } });
    b.used[raw] = (b.used[raw] || 0) + 1;
    return { ok: true };
  }

  machineSeconds(id) { return this.k.machines[id].seconds / (1 + this.k.timing.speedPerMachineLevel * this.getMachineLevel()); }
  qualityFor(age) { const T = this.k.timing; return age <= T.sweetSeconds ? 1 : age <= T.okSeconds ? 0.65 : 0.3; }

  tapMachine(id) {
    const s = this.session, m = this.k.machines[id];
    if (!this.running || !m) return { ok: false, reason: 'not running' };
    const job = s.jobs[id];
    if (job) {
      if (job.state === 'working') return { ok: false, reason: 'busy' };
      if (job.state === 'burnt') return this.discardJob(id);
      return this.collect(id);
    }
    if (!s.build) { this.say('Pick ingredients first.', 'warn'); return { ok: false, reason: 'no build' }; }
    const b = s.build, R = this.recipes;
    if (!R.machinesFor(b.pid).includes(id)) { this.mistake(`A ${this.productLabel(b.pid)} does not use the ${m.label}`); return { ok: false, reason: 'wrong machine' }; }
    const inp = R.inputsFor(id, b.tray);
    if (!inp.ok) { this.say(`${m.label} needs: ${inp.missing.join(', ')}`, 'warn'); return { ok: false, reason: 'missing', missing: inp.missing }; }
    const used = inp.picked.map((i) => b.tray[i]);
    const raw = {}; for (const u of used) for (const [k, n] of Object.entries(u.raw)) raw[k] = (raw[k] || 0) + n;
    b.tray = b.tray.filter((_, i) => !inp.picked.includes(i));
    s.jobs[id] = { state: 'working', t: 0, dur: this.machineSeconds(id), age: 0, inQ: (() => { const pr = used.filter((u) => u.proc); return pr.length ? pr.reduce((a, u) => a + u.q, 0) / pr.length : null; })(), raw };
    return { ok: true, started: true };
  }

  collect(id) {
    const s = this.session, job = s.jobs[id], m = this.k.machines[id], b = s.build, R = this.recipes;
    delete s.jobs[id];
    if (!b) return { ok: false, reason: 'no build' };
    const q = this.qualityFor(job.age);
    b.tray.push({ t: m.makes, q: job.inQ === null ? q : (q + job.inQ) / 2, raw: job.raw, proc: true }); // raw ingredients carry no quality: only machine steps do
    b.tray = R.assemble(b.tray);
    this.plateIfDone();
    return { ok: true, collected: true, quality: q };
  }

  discardJob(id) {
    const s = this.session, job = s.jobs[id], b = s.build;
    delete s.jobs[id];
    if (b) for (const [k, n] of Object.entries(job.raw)) b.used[k] = Math.max(0, (b.used[k] || 0) - n); // the ingredients can be fetched again
    s.combo = 0;
    this.mistake(`${this.k.machines[id].label}: burnt! Start again.`);
    return { ok: true, discarded: true };
  }

  /** Throw the current build away (ingredients lost, counts as a mistake). */
  discardBuild() {
    const s = this.session;
    if (!this.running || !s.build) return { ok: false };
    for (const id of Object.keys(s.jobs)) delete s.jobs[id];
    s.build = null; s.mistakes++; s.combo = 0;
    this.say('Order thrown away.', 'bad');
    return { ok: true };
  }

  /** Finished product -> pickup counter (when there is room). */
  plateIfDone() {
    const s = this.session, b = s.build;
    if (!b || !this.recipes.finished(b.pid, b.tray)) return false;
    if (s.pickup.length >= this.k.timing.pickupMax) { this.say('The pickup counter is full: serve a customer first.', 'warn'); return false; }
    s.pickup.push({ pid: b.pid, q: b.tray[0].q, mistakes: b.mistakes, cid: b.cid, id: `p${++seq}` });
    s.build = null;
    this.say(`${this.productLabel(b.pid)} is ready: tap the customer`, 'good');
    return true;
  }

  // ---------- serving ----------
  /** Tap on a customer: serves a matching product from the pickup counter, or (nothing to serve) chooses what to make next. */
  tapCustomer(cid) {
    const s = this.session, c = this.customer(cid);
    if (!this.running || !c) return { ok: false, reason: 'gone' };
    if (!s.pickup.length) { s.activeId = c.id; if (!s.build) this.say(`Next: ${this.remaining(c).map((p) => this.productLabel(p)).join(' + ')} for ${c.label}`, 'info'); return { ok: true, selected: true }; }
    const want = this.remaining(c);
    // best matching product (highest quality) among the pickup items
    const cand = s.pickup.filter((p) => want.includes(p.pid)).sort((a, b) => b.q - a.q)[0];
    if (!cand) {
      s.score = Math.max(0, s.score + this.k.scoring.wrongServe); s.combo = 0; s.wrong++;
      this.say(`${c.label} did not order that!`, 'bad');
      return { ok: false, reason: 'wrong customer' };
    }
    return this.deliver(c, cand);
  }

  deliver(c, p) {
    const s = this.session, sc = this.k.scoring, R = this.k.rewards, m = s.cfg;
    s.pickup.splice(s.pickup.indexOf(p), 1);
    c.served.push(p.pid);
    const perfect = p.mistakes === 0 && p.q >= this.k.timing.perfectQuality;
    const patienceFrac = clamp(c.patience / c.maxPatience, 0, 1);
    s.combo = p.q >= 0.65 ? s.combo + 1 : 0;
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    const comboMult = Math.min(sc.comboMax, 1 + sc.comboStep * Math.max(0, s.combo - 1));
    const base = sc.base * c.mult;
    const points = Math.round((base * (1 + sc.speedBonus * patienceFrac) * p.q + (perfect ? sc.perfectBonus : 0)) * comboMult);
    s.score += points;
    const price = this.cafeCfg.products[p.pid].price;
    s.coins = round2(s.coins + price * R.coinPerPrice * c.mult * m.coinMult * (1 + (perfect ? R.perfectCoins : 0) + Math.min(10, s.combo) * R.comboCoins));
    s.served++;
    if (perfect) s.perfect++;
    s.level = this.levelOf(s);
    const done = this.remaining(c).length === 0;
    if (done) { s.customers.splice(s.customers.indexOf(c), 1); if (s.activeId === c.id) s.activeId = null; }
    this.say(`${perfect ? 'Perfect! ' : ''}+${points}${s.combo > 1 ? ` · combo x${s.combo}` : ''}`, perfect ? 'perfect' : 'good');
    this.plateIfDone();
    this.bus?.emit('minigame:served', { customer: c, product: p, points, perfect, done });
    return { ok: true, served: true, points, perfect, done, quality: p.q };
  }

  // ---------- time ----------
  update(dt) {
    if (!this.running) return;
    dt = Math.min(dt, 0.25);
    const s = this.session, m = s.cfg, sc = this.k.scoring;
    s.time += dt; s.left -= dt;
    // machines
    for (const [id, j] of Object.entries(s.jobs)) {
      const mc = this.k.machines[id];
      if (j.state === 'working') { j.t += dt; if (j.t >= j.dur) { j.state = 'ready'; j.age = 0; } }
      else if (j.state === 'ready') { j.age += dt; if (mc.burn && j.age > mc.burn) { j.state = 'burnt'; this.say(`${mc.label} is burning!`, 'bad'); } }
    }
    // patience / walk-outs
    for (const c of [...s.customers]) {
      c.patience -= dt;
      if (c.patience > 0) continue;
      s.customers.splice(s.customers.indexOf(c), 1);
      if (s.activeId === c.id) s.activeId = null;
      if (s.build?.cid === c.id) s.build.cid = null; // the product being made can still go to somebody else
      s.strikes++; s.lost++; s.combo = 0; s.score = Math.max(0, s.score + sc.strike);
      this.say(`${c.label} walked out!`, 'bad');
      this.bus?.emit('minigame:lost', { customer: c });
    }
    // arrivals: faster as the level rises
    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0) {
      s.spawnTimer = Math.max(m.minSpawn, m.spawn * Math.pow(0.9, s.level - 1)) * (0.85 + this.rng() * 0.3);
      if (s.customers.length < m.maxQueue) this.spawnCustomer();
    }
    if (!s.customers.length && s.time > 1) s.spawnTimer = Math.min(s.spawnTimer, 0.8); // never an empty shop for long
    this.plateIfDone();
    if (s.strikes >= m.strikes) this.end('walkouts');
    else if (s.left <= 0) this.end('time');
  }

  serialize() {
    return { v: 1, plays: this.meta.plays, coins: this.meta.coins, day: this.meta.day, dayPlays: this.meta.dayPlays, dayCoins: this.meta.dayCoins, lastEnd: this.meta.lastEnd, best: JSON.parse(JSON.stringify(this.meta.best)) };
  }
}
