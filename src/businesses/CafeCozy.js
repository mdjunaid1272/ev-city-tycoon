import { CafeRecipeBook } from './CafeRecipeBook.js';
import { CafeRoster } from './CafeRoster.js';
import { CafeDecor } from './CafeDecor.js';

/**
 * The cozy café simulation (pure logic: no DOM, no Three.js). An OPTIONAL activity on top of the café business.
 *
 * Open the café for a relaxed shift: customers with names, tastes and stories arrive one by one, order drinks and desserts
 * (sometimes with a special request), and you make and serve them. No countdown, no punishment: a customer who waits too long
 * simply leaves unhappy. Serving earns Café coins (a soft currency spent on recipes' equipment-free things: furniture, themes,
 * floors), XP (café level -> new drinks, desserts, machines, customers, themes) and friendship (story chapters, gifts).
 *
 * Link to the city (all optional, all capped): at the end of a rewarded shift a small cash grant and a little reputation go
 * through EconomyManager (grants, never revenue), limited per day and by a cooldown. The café business itself keeps its own
 * passive income; the only thing flowing back is a small, capped boost to its customer arrivals (cafeBonus).
 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round2 = (n) => Math.round(n * 100) / 100;
let seq = 0;

export class CafeCozy {
  constructor({ economy, bus, cfg, saved = null, getDay = () => 1, getHour = () => 12, getMachineLevel = () => 0, now = () => Date.now(), rng = Math.random }) {
    Object.assign(this, { economy, bus, cfg, getDay, getHour, getMachineLevel, now, rng });
    this.book = new CafeRecipeBook(cfg);
    const s = saved && typeof saved === 'object' ? saved : {};
    const num = (v, d = 0) => (Number.isFinite(v) && v >= 0 ? v : d);
    this.xp = Math.floor(num(s.xp));
    this.coins = round2(num(s.coins, saved ? 0 : cfg.progress.starterCoins));
    this.life = { served: Math.floor(num(s.life?.served)), perfect: Math.floor(num(s.life?.perfect)), shifts: Math.floor(num(s.life?.shifts)), coins: round2(num(s.life?.coins)) };
    this.discovered = new Set(Array.isArray(s.discovered) ? s.discovered.filter((p) => cfg.products[p]) : []);
    this.pantry = {};
    for (const id of Object.keys(cfg.ingredients)) this.pantry[id] = clamp(Math.floor(num(s.pantry?.[id], cfg.pantry.cap)), 0, cfg.pantry.cap);
    this.display = {};
    for (const [id, p] of Object.entries(cfg.products)) if (p.display) this.display[id] = clamp(Math.floor(num(s.display?.[id], p.stock)), 0, cfg.pantry.displayCap);
    this.today = { n: num(s.today?.n), shifts: Math.floor(num(s.today?.shifts)), cash: round2(num(s.today?.cash)), rep: Math.floor(num(s.today?.rep)), coins: round2(num(s.today?.coins)), lastEnd: num(s.today?.lastEnd) };
    this.roster = new CafeRoster({ cfg, saved: s.roster, rng });
    this.decor = new CafeDecor({ cfg, saved: s.decor });
    this.state = 'idle'; // idle | open | summary
    this.session = null;
    this.summary = null;
    this.note = null; this.noteId = 0;
    this.lastLevel = this.level;
  }

  // ---------- level, unlocks ----------
  get level() { const L = this.cfg.progress.levels; let lv = 1; for (let i = 0; i < L.length; i++) if (this.xp >= L[i]) lv = i + 1; return lv; }
  get maxLevel() { return this.cfg.progress.levels.length; }
  levelProgress() {
    const L = this.cfg.progress.levels, lv = this.level;
    if (lv >= L.length) return { frac: 1, into: 0, need: 0, next: null };
    return { frac: (this.xp - L[lv - 1]) / (L[lv] - L[lv - 1]), into: this.xp - L[lv - 1], need: L[lv] - L[lv - 1], next: L[lv] };
  }
  unlockedProducts(kind = null) { return Object.entries(this.cfg.products).filter(([, p]) => p.level <= this.level && (!kind || p.kind === kind)).map(([id]) => id); }
  unlockedMachines() { return Object.entries(this.cfg.machines).filter(([, m]) => m.level <= this.level).map(([id]) => id); }
  /** Everything that unlocks exactly at a café level (for the progress screen and the level-up message). */
  unlocksAt(level) {
    const c = this.cfg;
    return {
      drinks: Object.entries(c.products).filter(([, p]) => p.level === level && p.kind === 'drink').map(([id]) => id),
      desserts: Object.entries(c.products).filter(([, p]) => p.level === level && p.kind === 'dessert').map(([id]) => id),
      machines: Object.entries(c.machines).filter(([, m]) => m.level === level).map(([id]) => id),
      customers: Object.entries(c.customers).filter(([, x]) => x.level === level).map(([id]) => id),
      themes: Object.entries(c.decor.themes).filter(([, t]) => t.level === level).map(([id]) => id),
      furniture: Object.entries(c.decor.items).filter(([, i]) => i.level === level && !i.gift && i.price > 0).map(([id]) => id),
    };
  }
  say(text, kind = 'info') { this.note = { text, kind, id: ++this.noteId }; }
  productLabel(pid) { return this.cfg.products[pid].label; }
  productIcon(pid) { return this.cfg.products[pid].icon; }

  addXp(n) {
    if (!(n > 0)) return;
    this.xp += Math.floor(n);
    if (this.session) this.session.xp += Math.floor(n);
    const lv = this.level;
    while (this.lastLevel < lv) {
      this.lastLevel++;
      this.bus?.emit('cozy:level', { level: this.lastLevel, unlocks: this.unlocksAt(this.lastLevel) });
      this.say(`Café level ${this.lastLevel}!`, 'perfect');
      if (this.session) (this.session.levelUps ||= []).push(this.lastLevel);
    }
  }
  /** Café coins: capped per day so decoration cannot be farmed. Story rewards bypass the cap (they are one-time). */
  addCoins(n, { capped = true } = {}) {
    this.rollDay();
    let a = round2(n);
    if (capped) a = Math.max(0, Math.min(a, round2(this.cfg.rewards.city.dayCoinCap - this.today.coins)));
    this.coins = round2(this.coins + a);
    if (capped) this.today.coins = round2(this.today.coins + a);
    this.life.coins = round2(this.life.coins + a);
    if (this.session) this.session.coinsEarned = round2(this.session.coinsEarned + a);
    return a;
  }

  // ---------- day limits ----------
  rollDay() { const d = this.getDay(); if (this.today.n !== d) this.today = { n: d, shifts: 0, cash: 0, rep: 0, coins: 0, lastEnd: this.today.lastEnd }; }
  status() {
    this.rollDay();
    const R = this.cfg.rewards.city, cooldownLeft = Math.max(0, (this.today.lastEnd + R.cooldownSeconds * 1000 - this.now()) / 1000);
    const shiftsLeft = Math.max(0, R.shiftsPerDay - this.today.shifts), cashLeft = round2(Math.max(0, R.dayCashCap - this.today.cash));
    const rewarded = shiftsLeft > 0 && cooldownLeft <= 0;
    const why = shiftsLeft <= 0 ? 'No more rewarded shifts today' : cooldownLeft > 0 ? `Rest a little: ${Math.ceil(cooldownLeft)}s` : '';
    return { rewarded, shiftsLeft, cashLeft, cooldownLeft, why, coinsLeft: round2(Math.max(0, R.dayCoinCap - this.today.coins)), repLeft: Math.max(0, R.dayReputationCap - this.today.rep), ...R };
  }
  get open() { return this.state === 'open'; }

  // ---------- pantry ----------
  restockInfo() {
    let cost = 0, missing = 0;
    for (const [id, ing] of Object.entries(this.cfg.ingredients)) { const m = this.cfg.pantry.cap - this.pantry[id]; if (m > 0) { cost += m * ing.cost; missing += m; } }
    for (const [id, p] of Object.entries(this.cfg.products)) if (p.display) { const m = this.cfg.pantry.displayCap - this.display[id]; if (m > 0) { cost += m * p.restock; missing += m; } }
    return { cost: round2(cost), missing };
  }
  /** Buy the missing supplies with city cash (an ordinary supplies expense). */
  restock() {
    const { cost, missing } = this.restockInfo();
    if (!missing) return { ok: false, reason: 'The pantry is full' };
    if (!this.economy.spend(cost, 'supplies')) return { ok: false, reason: 'Not enough cash for supplies' };
    for (const id of Object.keys(this.pantry)) this.pantry[id] = this.cfg.pantry.cap;
    for (const id of Object.keys(this.display)) this.display[id] = this.cfg.pantry.displayCap;
    return { ok: true, cost };
  }

  // ---------- shift lifecycle ----------
  openShift() {
    if (this.state === 'open') return { ok: false, reason: 'The café is already open' };
    const st = this.status();
    for (const id of Object.keys(this.pantry)) this.pantry[id] = Math.min(this.cfg.pantry.cap, this.pantry[id] + this.cfg.pantry.regenPerShift); // the pantry refills a little by itself
    for (const id of Object.keys(this.display)) this.display[id] = Math.min(this.cfg.pantry.displayCap, this.display[id] + 3);
    this.session = {
      id: `cz${++seq}-${this.now()}`, rewarded: st.rewarded, rewardNote: st.why, time: 0, spawnTimer: 1.2, spawned: 0, served: 0, perfect: 0, happy: 0, lost: 0, combo: 0, bestCombo: 0,
      sat: 0, satN: 0, coinsEarned: 0, xp: 0, customers: [], pickup: [], build: null, jobs: {}, activeId: null, dialogue: null, closing: false, mistakes: 0, tips: [], levelUps: [], beats: 0, gifts: [], visitors: [],
    };
    this.state = 'open'; this.summary = null; this.note = null;
    this.bus?.emit('cozy:opened');
    return { ok: true };
  }

  /** Close the café now (or the last customer left): pay out, show the summary. */
  closeShift() {
    const s = this.session;
    if (!s || this.state !== 'open') return null;
    for (const c of [...s.customers]) this.finishVisit(c, true);
    this.state = 'summary';
    this.rollDay();
    const R = this.cfg.rewards.city;
    let cash = 0, rep = 0, why = s.rewardNote;
    if (s.rewarded && s.served > 0 && !s.paid) {
      cash = round2(Math.max(0, Math.min(s.coinsEarned * R.cashPerCoin, R.dayCashCap - this.today.cash)));
      if (cash > 0) { this.economy.grant({ cash }); this.today.cash = round2(this.today.cash + cash); }
      const avg = s.satN ? s.sat / s.satN : 0;
      if (s.served >= 4 && avg >= 0.7 && this.today.rep < R.dayReputationCap) { rep = R.reputationPerShift; this.economy.changeReputation(rep, 'café shift'); this.today.rep += rep; }
      this.today.shifts++;
    } else if (!s.rewarded) why = s.rewardNote || 'No city reward this shift';
    s.paid = true;
    this.today.lastEnd = this.now();
    this.life.shifts++;
    const avg = s.satN ? s.sat / s.satN : 0;
    this.summary = { served: s.served, perfect: s.perfect, happy: s.happy, lost: s.lost, bestCombo: s.bestCombo, coins: s.coinsEarned, xp: s.xp, cash, rep, rewarded: s.rewarded, why, avgSatisfaction: avg, levelUps: [...s.levelUps], beats: s.beats, gifts: [...s.gifts], level: this.level };
    this.bus?.emit('cozy:closed', this.summary);
    return this.summary;
  }
  dismiss() { if (this.state === 'summary') { this.state = 'idle'; this.session = null; } }

  // ---------- customers ----------
  present() { return this.session.customers.map((c) => c.rid); }

  spawnCustomer() {
    const s = this.session, lvl = this.level;
    const rid = this.roster.pick({ level: lvl, hour: this.getHour(), day: this.getDay(), exclude: this.present() });
    const def = this.cfg.customers[rid];
    const unlocked = this.unlockedProducts();
    const hasDessert = unlocked.some((p) => this.cfg.products[p].kind === 'dessert');
    const two = (def.category === 'tourist' || def.vip || (lvl >= 2 && this.rng() < 0.3)) && hasDessert;
    const kinds = two ? ['drink', 'dessert'] : [this.rng() < 0.82 || !hasDessert ? 'drink' : 'dessert'];
    const pids = this.roster.chooseProducts({ id: rid, count: kinds.length, unlocked, kinds });
    const lines = pids.map((pid) => {
      const reqs = Object.entries(this.cfg.requests).filter(([, r]) => r.level <= lvl && r.only.includes(pid));
      const requests = reqs.length && this.rng() < Math.min(0.55, 0.12 * (lvl - 1)) ? [reqs[Math.floor(this.rng() * reqs.length)][0]] : [];
      return { pid, requests, done: false, product: null };
    });
    const patience = this.cfg.service.patienceSeconds * (def.category === 'office' ? 0.8 : 1);
    const c = { id: `c${++seq}`, rid, name: def.name, icon: def.icon, category: def.category, vip: def.vip, colors: { shirt: def.shirt, hat: def.hat, skin: def.skin }, lines, patience, maxPatience: patience, state: 'waiting', eatLeft: 0, sats: [], liked: false, chatReady: false, spawnedAt: s.time };
    s.customers.push(c); s.spawned++;
    this.bus?.emit('cozy:customer', { customer: c });
    return c;
  }
  customer(id) { return this.session?.customers.find((c) => c.id === id) || null; }
  remaining(c) { return c.lines.filter((l) => !l.done); }
  urgent() { return this.session.customers.filter((c) => c.state === 'waiting').sort((a, b) => a.patience / a.maxPatience - b.patience / b.maxPatience)[0] || null; }

  finishVisit(c, closing = false) {
    const s = this.session, i = s.customers.indexOf(c);
    if (i < 0) return;
    s.customers.splice(i, 1);
    if (s.activeId === c.id) s.activeId = null;
    if (s.dialogue?.cid === c.id) s.dialogue = null;
    const served = c.lines.filter((l) => l.done).map((l) => l.pid);
    if (served.length) {
      const avg = c.sats.reduce((a, b) => a + b, 0) / c.sats.length;
      const before = this.roster.levelOf(c.rid);
      this.roster.recordVisit(c.rid, { day: this.getDay(), happy: avg >= 0.8, served });
      if (this.roster.levelOf(c.rid) > before) { this.addXp(this.cfg.progress.xp.friend); this.say(`${c.name} and you are now ${this.roster.levelName(this.roster.levelOf(c.rid)).toLowerCase()}s!`, 'perfect'); }
      s.visitors.push(c.rid);
    } else if (!closing) { s.lost++; this.bus?.emit('cozy:lost', { customer: c }); }
    this.bus?.emit('cozy:left', { customer: c, served: served.length });
  }

  // ---------- the workbench ----------
  mistake(text) { const s = this.session; if (s.build) s.build.mistakes++; s.mistakes++; s.combo = 0; this.say(text, 'bad'); }

  /** Choose what to make: the selected customer's first open line (the most impatient customer when nobody is selected). */
  ensureBuild() {
    const s = this.session;
    if (s.build) return { ok: true };
    let c = this.customer(s.activeId);
    if (!c || c.state !== 'waiting') { c = this.urgent(); if (!c) { this.say('Nobody is waiting yet.', 'warn'); return { ok: false, reason: 'no customer' }; } s.activeId = c.id; }
    const li = c.lines.findIndex((l, i) => !l.done && !s.pickup.some((p) => p.cid === c.id && p.li === i));
    if (li < 0) { this.say('Everything for this customer is ready: serve them.', 'warn'); return { ok: false, reason: 'all made' }; }
    const line = c.lines[li], forbid = line.requests.map((r) => this.cfg.requests[r].forbid).filter(Boolean);
    s.build = { cid: c.id, li, pid: line.pid, tray: [], used: {}, addons: [], mistakes: 0, forbid };
    this.say(`Making ${this.productLabel(line.pid)} for ${c.name}`, 'info');
    return { ok: true };
  }

  addIngredient(raw) {
    const s = this.session, ing = this.cfg.ingredients[raw];
    if (!this.open || !ing) return { ok: false, reason: 'closed' };
    const b0 = this.ensureBuild(); if (!b0.ok) return b0;
    const b = s.build;
    if (this.book.isDisplay(b.pid)) { this.mistake(`A ${this.productLabel(b.pid)} comes from the bakery display`); return { ok: false, reason: 'display' }; }
    if (!this.book.acceptsRaw(b.pid, b.used, raw, b.forbid)) {
      this.mistake(b.forbid.includes(raw) ? `The customer asked for no ${ing.label.toLowerCase()}!` : `${ing.label} is not needed for a ${this.productLabel(b.pid)}`);
      return { ok: false, reason: 'wrong' };
    }
    if (!this.book.isAddon(raw) && b.tray.length >= this.cfg.quality.trayMax) { this.say('The tray is full: use a machine first.', 'warn'); return { ok: false, reason: 'full' }; }
    if ((this.pantry[raw] || 0) <= 0) { this.say(`Out of ${ing.label.toLowerCase()}: restock the pantry.`, 'warn'); return { ok: false, reason: 'out' }; }
    this.pantry[raw]--;
    if (this.book.isAddon(raw)) { b.addons.push(raw); b.used[raw] = (b.used[raw] || 0) + 1; }
    else { b.tray.push({ t: raw, q: 1, raw: { [raw]: 1 } }); b.used[raw] = (b.used[raw] || 0) + 1; }
    return { ok: true };
  }

  /** The bakery display holds ready-made donuts and croissants. */
  tapDisplay(pid) {
    const s = this.session;
    if (!this.open || !this.display.hasOwnProperty(pid)) return { ok: false, reason: 'closed' };
    const b0 = this.ensureBuild(); if (!b0.ok) return b0;
    const b = s.build;
    if (b.pid !== pid) { this.mistake(`That order is not a ${this.productLabel(pid)}`); return { ok: false, reason: 'wrong' }; }
    if (this.display[pid] <= 0) { this.say(`The display is out of ${this.productLabel(pid).toLowerCase()}s: restock.`, 'warn'); return { ok: false, reason: 'out' }; }
    this.display[pid]--;
    b.tray = [{ t: this.cfg.products[pid].final, q: 1, raw: {}, proc: false }];
    this.plateIfDone();
    return { ok: true, plated: true };
  }

  machineSeconds(r) { return r.seconds / (1 + this.cfg.quality.speedPerMachineLevel * this.getMachineLevel()); }
  qualityFor(age) { const Q = this.cfg.quality; return age <= Q.sweetSeconds ? 1 : age <= Q.okSeconds ? 0.65 : 0.3; }

  tapMachine(id) {
    const s = this.session, m = this.cfg.machines[id];
    if (!this.open || !m) return { ok: false, reason: 'closed' };
    if (m.level > this.level) { this.say(`${m.label} unlocks at café level ${m.level}`, 'warn'); return { ok: false, reason: 'locked' }; }
    const job = s.jobs[id];
    if (job) {
      if (job.state === 'working') return { ok: false, reason: 'busy' };
      if (job.state === 'burnt') return this.discardJob(id);
      return this.collect(id);
    }
    if (!s.build) { this.say('Pick ingredients first.', 'warn'); return { ok: false, reason: 'no build' }; }
    const b = s.build, B = this.book;
    if (!B.machinesFor(b.pid).includes(id)) { this.mistake(`A ${this.productLabel(b.pid)} does not use the ${m.label.toLowerCase()}`); return { ok: false, reason: 'wrong machine' }; }
    const inp = B.inputsFor(id, b.tray, b.pid);
    if (!inp.ok) { this.say(`${m.label} needs: ${inp.missing.join(', ') || 'the right ingredients'}`, 'warn'); return { ok: false, reason: 'missing', missing: inp.missing }; }
    const used = inp.picked.map((i) => b.tray[i]), raw = {};
    for (const u of used) for (const [k, n] of Object.entries(u.raw)) raw[k] = (raw[k] || 0) + n;
    b.tray = b.tray.filter((_, i) => !inp.picked.includes(i));
    const pr = used.filter((u) => u.proc);
    s.jobs[id] = { state: 'working', t: 0, dur: this.machineSeconds(inp.recipe), age: 0, makes: inp.recipe.makes, inQ: pr.length ? pr.reduce((a, u) => a + u.q, 0) / pr.length : null, raw };
    return { ok: true, started: true };
  }

  collect(id) {
    const s = this.session, job = s.jobs[id], b = s.build;
    delete s.jobs[id];
    if (!b) return { ok: false, reason: 'no build' };
    const q = this.qualityFor(job.age);
    b.tray.push({ t: job.makes, q: job.inQ === null ? q : (q + job.inQ) / 2, raw: job.raw, proc: true });
    b.tray = this.book.combine(b.pid, b.tray);
    this.plateIfDone();
    return { ok: true, collected: true, quality: q };
  }

  discardJob(id) {
    const s = this.session, job = s.jobs[id], b = s.build;
    delete s.jobs[id];
    if (b) for (const [k, n] of Object.entries(job.raw)) b.used[k] = Math.max(0, (b.used[k] || 0) - n);
    this.mistake(`${this.cfg.machines[id].label}: burnt! Gather the ingredients again.`);
    return { ok: true, discarded: true };
  }

  discardBuild() {
    const s = this.session;
    if (!this.open || !s.build) return { ok: false };
    for (const id of Object.keys(s.jobs)) delete s.jobs[id];
    s.build = null; s.combo = 0; s.mistakes++;
    this.say('Order thrown away.', 'bad');
    return { ok: true };
  }

  plateIfDone() {
    const s = this.session, b = s.build;
    if (!b || !this.book.finished(b.pid, b.tray)) return false;
    if (s.pickup.length >= this.cfg.quality.pickupMax) { this.say('The pickup counter is full: serve a customer first.', 'warn'); return false; }
    s.pickup.push({ id: `p${++seq}`, pid: b.pid, q: b.tray[0].q, mistakes: b.mistakes, cid: b.cid, li: b.li, addons: [...b.addons] });
    s.build = null;
    this.say(`${this.productLabel(b.pid)} is ready: tap the customer`, 'good');
    return true;
  }

  // ---------- serving ----------
  /** Tap a customer: serve a matching product, or (nothing to serve) choose whom to make something for. */
  tapCustomer(cid) {
    const s = this.session, c = this.customer(cid);
    if (!this.open || !c) return { ok: false, reason: 'gone' };
    if (c.state !== 'waiting') return { ok: true, selected: false, chat: c.chatReady };
    const open = this.remaining(c);
    const cand = s.pickup.filter((p) => open.some((l) => l.pid === p.pid)).sort((a, b) => (b.cid === c.id) - (a.cid === c.id) || b.q - a.q)[0];
    if (!cand) { // nothing ready for this customer: choose them as the one to make something for (relaxed: no penalty for a mis-tap)
      s.activeId = c.id;
      if (!s.build) this.say(`Next: ${open.map((l) => this.productLabel(l.pid)).join(' + ')} for ${c.name}`, 'info');
      return { ok: true, selected: true };
    }
    return this.deliver(c, cand);
  }

  deliver(c, p) {
    const s = this.session, R = this.cfg.rewards, X = this.cfg.progress.xp;
    const line = c.lines.find((l) => !l.done && l.pid === p.pid);
    s.pickup.splice(s.pickup.indexOf(p), 1);
    // satisfaction: quality, taste, requests, patience, a lovely café
    let sat = 0.62 + p.q * 0.2;
    const liked = this.roster.likes(c.rid, p.pid);
    if (liked) sat += 0.08;
    let reqOk = true;
    for (const rid of line.requests) {
      const r = this.cfg.requests[rid];
      if (r.addon) { if (p.addons.includes(r.addon) || (r.addon === 'ice' && p.addons.includes('ice'))) sat += 0.06; else { sat -= 0.14; reqOk = false; } }
      if (r.forbid) { if (p.addons.includes(r.forbid)) { sat -= 0.2; reqOk = false; } else sat += 0.04; }
    }
    if (c.patience / c.maxPatience < 0.3) sat -= 0.08;
    sat += this.decor.satisfactionBonus();
    sat = clamp(sat, 0, 1);
    const happy = sat >= 0.8, perfect = p.mistakes === 0 && p.q >= this.cfg.quality.perfect && reqOk;
    line.done = true; line.product = p.pid; line.perfect = perfect; c.sats.push(sat); if (liked) c.liked = true;
    s.combo++; s.bestCombo = Math.max(s.bestCombo, s.combo); s.served++; this.life.served++;
    if (perfect) { s.perfect++; this.life.perfect++; }
    if (happy) s.happy++;
    s.sat += sat; s.satN++;
    const price = this.cfg.products[p.pid].price;
    const mult = 1 + (perfect ? R.perfectBonus : 0) + (happy ? R.happyBonus : 0) + (liked ? R.likedBonus : 0);
    const coins = this.addCoins(price * R.coinsPerPrice * mult * (c.vip ? R.vipMult : 1) * (1 + Math.min(s.combo, R.comboMax) * R.comboBonus));
    let xp = X.served + (perfect ? X.perfect : 0) + (happy ? X.happy : 0) + (this.cfg.products[p.pid].kind === 'dessert' ? X.dessert : 0);
    if (!this.discovered.has(p.pid)) { this.discovered.add(p.pid); xp += X.discover; this.say(`New recipe discovered: ${this.productLabel(p.pid)}!`, 'perfect'); }
    this.addXp(xp);
    if (!c.lines.some((l) => !l.done)) {
      c.state = 'eating'; c.eatLeft = 7 + this.rng() * 4; c.chatReady = !!this.roster.nextBeat(c.rid, 1); // this visit counts for the chapter
      if (s.activeId === c.id) s.activeId = null;
    }
    this.say(`${perfect ? 'Perfect! ' : happy ? 'Happy customer! ' : ''}+${coins.toFixed(1)} coins`, perfect ? 'perfect' : 'good');
    this.plateIfDone();
    this.bus?.emit('cozy:served', { customer: c, product: p, satisfaction: sat, perfect, happy, coins });
    return { ok: true, served: true, perfect, happy, coins, satisfaction: sat, done: c.state === 'eating' };
  }

  // ---------- chatting (optional) ----------
  /** Offer the customer's next story chapter. The visit that is just ending counts as one visit for gating. */
  chat(cid) {
    const s = this.session, c = this.customer(cid);
    if (!this.open || !c || c.state !== 'eating') return { ok: false, reason: 'not now' };
    const def = this.cfg.customers[c.rid], beat = this.roster.nextBeat(c.rid, 1); // the visit in progress counts
    if (!beat) return { ok: false, reason: 'no story yet' };
    s.dialogue = { cid: c.id, rid: c.rid, name: def.name, icon: def.icon, index: beat.index, title: beat.title, lines: beat.lines.map((l) => ({ ...l })), choices: (beat.choices || []).map((x) => ({ text: x.text })), reward: beat.reward || null };
    return { ok: true, dialogue: s.dialogue };
  }
  /** Finish the open dialogue (a choice index, or null when skipped / no choices). Returns { reply, friend, reward }. */
  finishDialogue(choice = null) {
    const s = this.session, d = s?.dialogue;
    if (!d) return { ok: false };
    const r = this.roster.completeBeat(d.rid, d.index, choice);
    s.dialogue = null;
    if (!r.repeated) {
      s.beats++;
      this.addXp(this.cfg.progress.xp.beat);
      if (r.reward) {
        if (r.reward.coins) this.addCoins(r.reward.coins, { capped: false });
        if (r.reward.unlock?.decor && this.decor.grant(r.reward.unlock.decor)) s.gifts.push(r.reward.unlock.decor);
      }
    }
    const c = this.customer(d.cid); if (c) c.chatReady = false;
    return { ok: true, ...r };
  }
  skipDialogue() { const s = this.session; if (s?.dialogue) { const c = this.customer(s.dialogue.cid); s.dialogue = null; if (c) c.chatReady = true; } }

  // ---------- time ----------
  update(dt) {
    if (!this.open) return;
    dt = Math.min(dt, 0.25);
    const s = this.session, V = this.cfg.service;
    s.time += dt;
    for (const [id, j] of Object.entries(s.jobs)) {
      const m = this.cfg.machines[id];
      if (j.state === 'working') { j.t += dt; if (j.t >= j.dur) { j.state = 'ready'; j.age = 0; } }
      else if (j.state === 'ready') { j.age += dt; if (m.burn && j.age > m.burn) { j.state = 'burnt'; this.say(`${m.label} is burning!`, 'bad'); } }
    }
    for (const c of [...s.customers]) {
      if (c.state === 'waiting') {
        c.patience -= dt;
        if (c.patience <= 0) {
          if (s.build?.cid === c.id) s.build.cid = null; // what is being made can still go to somebody else
          this.say(`${c.name} had to go.`, 'warn');
          this.finishVisit(c);
        }
      } else if (c.state === 'eating' && s.dialogue?.cid !== c.id) {
        c.eatLeft -= dt;
        if (c.eatLeft <= 0) this.finishVisit(c);
      }
    }
    // arrivals: relaxed, never more than the queue holds, and a closing time after enough customers
    if (!s.closing) {
      s.spawnTimer -= dt;
      const waiting = s.customers.filter((c) => c.state === 'waiting').length;
      if (s.spawnTimer <= 0 && waiting < V.maxQueue) {
        this.spawnCustomer();
        s.spawnTimer = V.arrivalSeconds[0] + this.rng() * (V.arrivalSeconds[1] - V.arrivalSeconds[0]);
        if (s.spawned >= V.shiftCustomers) { s.closing = true; this.say('That was the last customer of the day.', 'info'); }
      }
      if (!waiting && s.time > 2) s.spawnTimer = Math.min(s.spawnTimer, 1.5); // a quiet moment never lasts long
    } else if (!s.customers.length) this.closeShift();
    this.plateIfDone();
  }

  // ---------- decoration (café coins) ----------
  buyDecor(id) { const r = this.decor.buy(id, this.coins, this.level); if (r.ok) this.coins = round2(this.coins - r.cost); return r; }
  buyTheme(id) { const r = this.decor.buyTheme(id, this.coins, this.level); if (r.ok) this.coins = round2(this.coins - r.cost); return r; }
  buyFloor(id) { const r = this.decor.buyFloor(id, this.coins, this.level); if (r.ok) this.coins = round2(this.coins - r.cost); return r; }

  /** Small, capped boost to the café business's customer arrivals: a charming café draws a few more people (never revenue itself). */
  cafeBonus() { return 1 + Math.min(0.12, (this.level - 1) * 0.012 + this.decor.appeal() * 0.002); }

  serialize() {
    return {
      v: 1, xp: this.xp, coins: this.coins, life: { ...this.life }, discovered: [...this.discovered], pantry: { ...this.pantry }, display: { ...this.display }, today: { ...this.today },
      roster: this.roster.serialize(), decor: this.decor.serialize(),
    };
  }
}
