/**
 * Four business stages (data in public/data/progression.json).
 * Each stage has goals (reputation, revenue, bays, staff, built facilities, customers served...).
 * Meeting all goals of the next stage advances automatically: rewards are granted through the economy and
 * new features unlock. `isUnlocked(feature)` is the single question other systems ask.
 */
export class ProgressionManager {
  constructor({ bus, economy, cfg, stats, getters, saved = null }) {
    this.bus = bus;
    this.economy = economy;
    this.cfg = cfg;
    this.stats = stats;
    this.g = getters; // { baysBuilt(), employees(), built(key) }
    this.stage = saved?.stage || 1;
    this.timer = 0;
  }

  get stages() { return this.cfg.stages; }
  get current() { return this.stages[this.stage - 1]; }
  get next() { return this.stages[this.stage] || null; }

  isUnlocked(feature) {
    const need = this.cfg.features[feature];
    return need === undefined || this.stage >= need;
  }
  unlockStage(feature) { return this.cfg.features[feature] ?? 1; }

  valueOf(goal) {
    const e = this.economy, s = this.stats.total;
    switch (goal.type) {
      case 'reputation': return e.reputation;
      case 'revenue': return e.totalRevenue;
      case 'bays': return this.g.baysBuilt();
      case 'employees': return this.g.employees();
      case 'built': return this.g.built(goal.key) ? 1 : 0;
      case 'served': return s.served;
      case 'contractsDone': return s.contractsDone;
      case 'properties': return this.g.properties();
      default: return 0;
    }
  }

  /** Goals of a stage with current progress. */
  goalsFor(stageNo) {
    const st = this.stages[stageNo - 1];
    return (st?.goals || []).map((g) => {
      const value = Math.min(this.valueOf(g), g.target);
      return { ...g, value, done: this.valueOf(g) >= g.target };
    });
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    this.check();
  }

  /** Advance as many stages as the goals allow. */
  check() {
    while (this.next && this.goalsFor(this.stage + 1).every((g) => g.done)) this.advance();
  }

  advance() {
    const n = this.next;
    if (!n) return false;
    this.stage = n.stage;
    this.economy.grant(n.reward || {});
    this.bus.emit('stage:up', { stage: n.stage, name: n.name, reward: n.reward || {}, unlocks: n.unlocks || [] });
    this.bus.emit('economy:changed');
    return true;
  }

  serialize() {
    return { stage: this.stage };
  }
}
