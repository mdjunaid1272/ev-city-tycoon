/**
 * Daily missions, weekly challenges and achievements (data in public/data/missions.json).
 * Progress is measured against the StatsTracker's lifetime counters minus a baseline taken when the goal
 * is created, so goals survive saves and day changes. Rewards are paid through the EconomyManager.
 */
let seq = 0;
const pick = (arr, n) => {
  const a = [...arr]; const out = [];
  while (a.length && out.length < n) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
  return out;
};

export class GoalManager {
  constructor({ bus, economy, stats, cfg, progression, ctx, saved = null }) {
    this.bus = bus;
    this.economy = economy;
    this.stats = stats;
    this.cfg = cfg;
    this.progression = progression;
    this.ctx = ctx; // { washBuilt(), garageBuilt(), employees() }
    this.daily = saved?.daily || [];
    this.weekly = saved?.weekly || [];
    this.achieved = new Set(saved?.achieved || []);
    this.dailyBonusDone = saved?.dailyBonusDone || false;
    this.weekStartDay = saved?.weekStartDay ?? null;
    this.timer = 0;
    this.day = saved?.day ?? 1;
  }

  /** Called once at game start with the current in-game day. */
  init(day) {
    this.day = day;
    if (!this.daily.length) this.rollDaily();
    if (!this.weekly.length || this.weekStartDay === null) { this.weekStartDay = day; this.rollWeekly(); }
  }

  available(t) {
    switch (t.requires) {
      case 'wash': return this.ctx.washBuilt();
      case 'garage': return this.ctx.garageBuilt();
      case 'cafe': return !!this.ctx.cafeBuilt?.();
      case 'employee': return this.ctx.employees() > 0;
      case 'rep10': return this.economy.reputation >= 10;
      case 'contracts': return this.progression.isUnlocked('contracts');
      default: return true;
    }
  }

  make(t, scope) {
    const step = t.step || 1;
    const roll = (a, b, s = step) => Math.round((a + Math.random() * (b - a)) / s) * s;
    const n = roll(t.min, t.max), m = t.stat2 ? roll(t.min2, t.max2, 1) : 0;
    const title = t.title.replace('{n}', n.toLocaleString('en-US')).replace('{m}', m);
    const reward = { cash: Math.round(n * t.cashPer * (t.cashMult ?? 1)) };
    if (t.stat2) reward.cash += Math.round(m * t.cashPer * 1.3);
    if (t.gems) reward.gems = t.gems;
    const tot = this.stats.total;
    return {
      id: `${t.id}_${++seq}`, tpl: t.id, title, stat: t.stat, target: n, stat2: t.stat2 || null, target2: m,
      base: tot[t.stat], base2: t.stat2 ? tot[t.stat2] : 0, reward, done: false, scope,
    };
  }

  rollDaily() {
    const pool = this.cfg.daily.filter((t) => this.available(t));
    this.daily = pick(pool, this.cfg.dailyCount).map((t) => this.make(t, 'daily'));
    this.dailyBonusDone = false;
    this.bus.emit('goals:changed');
  }
  rollWeekly() {
    const pool = this.cfg.weekly.filter((t) => this.available(t));
    this.weekly = pick(pool, this.cfg.weeklyCount).map((t) => this.make(t, 'weekly'));
    this.bus.emit('goals:changed');
  }

  newDay(day) {
    this.day = day;
    this.stats.resetDay();
    this.rollDaily();
    if (day - this.weekStartDay >= this.cfg.weeklyDays) {
      this.weekStartDay = day;
      this.stats.resetWeek();
      this.rollWeekly();
    }
  }

  progressOf(g) {
    const t = this.stats.total;
    const a = Math.max(0, t[g.stat] - g.base);
    const b = g.stat2 ? Math.max(0, t[g.stat2] - g.base2) : 0;
    return { a: Math.min(a, g.target), b: Math.min(b, g.target2), done: a >= g.target && (!g.stat2 || b >= g.target2) };
  }
  fraction(g) {
    const p = this.progressOf(g);
    return g.stat2 ? (p.a / g.target + p.b / g.target2) / 2 : p.a / g.target;
  }

  statValue(stat) {
    if (stat === 'stage') return this.progression.stage;
    if (stat === 'properties') return this.ctx.properties();
    if (stat === 'decor') return this.ctx.decor();
    return this.stats.total[stat] ?? 0;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.8;
    this.check();
  }

  check() {
    for (const g of [...this.daily, ...this.weekly]) {
      if (g.done) continue;
      if (this.progressOf(g).done) {
        g.done = true;
        this.economy.grant(g.reward);
        this.bus.emit('goal:complete', { goal: g, scope: g.scope });
        this.bus.emit('goals:changed');
      }
    }
    if (this.daily.length && !this.dailyBonusDone && this.daily.every((g) => g.done)) {
      this.dailyBonusDone = true;
      this.economy.grant(this.cfg.dailyBonus);
      this.bus.emit('goal:daily-bonus', { reward: this.cfg.dailyBonus });
      this.bus.emit('goals:changed');
    }
    for (const a of this.cfg.achievements) {
      if (this.achieved.has(a.id)) continue;
      if (this.statValue(a.stat) >= a.target) {
        this.achieved.add(a.id);
        this.economy.grant(a.reward);
        this.bus.emit('achievement:unlocked', { achievement: a });
        this.bus.emit('goals:changed');
      }
    }
  }

  achievementList() {
    return this.cfg.achievements.map((a) => ({ ...a, done: this.achieved.has(a.id), value: Math.min(this.statValue(a.stat), a.target) }));
  }

  serialize() {
    return { daily: this.daily, weekly: this.weekly, achieved: [...this.achieved], dailyBonusDone: this.dailyBonusDone, weekStartDay: this.weekStartDay, day: this.day };
  }
}
