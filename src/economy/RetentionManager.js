/**
 * Offline earnings + daily login reward (pure logic, no DOM).
 *
 * Offline: while you play, smoothed revenue and variable-cost rates are measured (per real second).
 * When you return, aggregate activity is computed for the time away (capped at 4 hours): gross revenue,
 * operating costs, plus salaries and upkeep for the in-game days that passed. Nothing is simulated per NPC.
 * A rewarded ad can double the net earnings. Without automation (no attendant) the station mostly idles.
 */
const VAR_CATEGORIES = new Set(['electricity', 'supplies', 'parts']);
const DAY_SECONDS = 600; // one in-game day = 10 real minutes

export class OfflineManager {
  constructor({ bus, economy, capHours = 4, getPayroll, getUpkeep, hasAutomation, saved = null }) {
    this.bus = bus;
    this.economy = economy;
    this.cap = capHours * 3600;
    this.getPayroll = getPayroll;
    this.getUpkeep = getUpkeep;
    this.hasAutomation = hasAutomation;
    this.rev = saved?.rev ?? 0; // smoothed revenue per real second
    this.var = saved?.var ?? 0; // smoothed variable cost per real second
    this.win = { rev: 0, var: 0, t: 0 };
    this.samples = saved?.samples ?? 0;
    bus.on('cash:earned', ({ amount, source }) => { if (!/^offline/.test(source) && source !== 'login') this.win.rev += amount; });
    const varCost = ({ amount, category }) => { if (VAR_CATEGORIES.has(category)) this.win.var += amount; };
    bus.on('cash:spent', varCost);
    bus.on('cash:expense', varCost);
  }

  update(dt) {
    this.win.t += dt;
    if (this.win.t < 15) return;
    const r = this.win.rev / this.win.t, v = this.win.var / this.win.t;
    const a = this.samples < 3 ? 0.6 : 0.3;
    this.rev = this.samples === 0 ? r : this.rev * (1 - a) + r * a;
    this.var = this.samples === 0 ? v : this.var * (1 - a) + v * a;
    this.samples++;
    this.win = { rev: 0, var: 0, t: 0 };
  }

  /** Compute the report for `elapsedSec` away. Returns null when the absence was too short / nothing to report. */
  compute(elapsedSec) {
    if (!Number.isFinite(elapsedSec) || elapsedSec < 120) return null;
    const seconds = Math.min(elapsedSec, this.cap);
    const factor = this.hasAutomation() ? 1 : 0.25; // unattended stations earn little
    const eff = 0.8; // offline activity is aggregated, so a little less efficient than live play
    const gross = Math.round(this.rev * seconds * factor * eff * 100) / 100;
    const operating = Math.round(this.var * seconds * factor * eff * 100) / 100;
    const days = seconds / DAY_SECONDS;
    const salaries = Math.round(this.getPayroll() * days * 100) / 100;
    const upkeep = Math.round(this.getUpkeep() * days * 100) / 100;
    if (gross <= 0 && salaries <= 0 && upkeep <= 0) return null;
    return { seconds, capped: elapsedSec > this.cap, gross, operating, salaries, upkeep, net: Math.round((gross - operating - salaries - upkeep) * 100) / 100, applied: false, id: `offline:${Date.now()}` };
  }

  /** Book the report once. `multiplier` 2 (rewarded ad) doubles the positive net as a bonus. */
  apply(report, multiplier = 1) {
    if (!report || report.applied) return false;
    report.applied = true;
    if (report.gross > 0) this.economy.earn(report.gross, 'offline earnings', report.id);
    if (report.operating > 0) this.economy.expense(report.operating, 'operating costs');
    if (report.salaries > 0) this.economy.expense(report.salaries, 'salaries');
    if (report.upkeep > 0) this.economy.expense(report.upkeep, 'maintenance');
    if (multiplier > 1 && report.net > 0) this.economy.earn(report.net * (multiplier - 1), 'offline bonus', `${report.id}:bonus`);
    this.bus.emit('offline:applied', { report, multiplier });
    return true;
  }

  serialize() {
    return { rev: this.rev, var: this.var, samples: this.samples };
  }
}

const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 7-day login streak. Claim once per calendar day; missing a day restarts the streak. */
export class DailyReward {
  constructor({ economy, cfg, saved = null }) {
    this.economy = economy;
    this.rewards = cfg.rewards;
    this.last = saved?.last || null; // YYYY-MM-DD of the last claim
    this.streak = saved?.streak || 0;
  }

  /** What the next claim would be, or null if today's reward is already taken. */
  status(now = new Date()) {
    const today = dateKey(now);
    if (this.last === today) return null;
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const streak = this.last === dateKey(y) ? this.streak : 0;
    const dayIndex = streak % this.rewards.length;
    return { today, streak, dayIndex, reward: this.rewards[dayIndex], all: this.rewards };
  }

  /** New players start their streak tomorrow (no popup over the tutorial). */
  markToday(now = new Date()) {
    this.last = dateKey(now);
    this.streak = 0;
  }

  claim(multiplier = 1, now = new Date()) {
    const s = this.status(now);
    if (!s) return false;
    const r = s.reward;
    this.economy.grant({ cash: (r.cash || 0) * multiplier, gems: (r.gems || 0) * multiplier });
    this.last = s.today;
    this.streak = s.streak + 1;
    return true;
  }

  serialize() {
    return { last: this.last, streak: this.streak };
  }
}
