/**
 * Single authority for every money movement.
 * - rejects invalid amounts (NaN, <=0, Infinity)
 * - rejects overspending
 * - de-duplicates payments by transaction id
 * - keeps a daily ledger (revenue by source, expenses by category)
 */
export class EconomyManager {
  constructor(bus, start = {}) {
    this.bus = bus;
    this.cash = start.cash ?? 10000;
    this.gems = start.gems ?? 25;
    this.reputation = start.reputation ?? 0;
    this.totalRevenue = start.totalRevenue ?? 0;
    this.ledger = start.ledger ?? this.emptyLedger();
    this.lastReport = start.lastReport ?? null;
    this.history = start.history ?? [];
    this.seenTx = new Set();
    this.txOrder = [];
  }

  emptyLedger() {
    return { revenue: {}, expenses: {}, kwh: 0 };
  }

  valid(n) {
    return typeof n === 'number' && Number.isFinite(n) && n > 0;
  }

  round(n) {
    return Math.round(n * 100) / 100;
  }

  /** Revenue. Returns true if booked. */
  earn(amount, source, txId = null) {
    if (!this.valid(amount)) return false;
    if (txId) {
      if (this.seenTx.has(txId)) return false;
      this.seenTx.add(txId);
      this.txOrder.push(txId);
      if (this.txOrder.length > 500) this.seenTx.delete(this.txOrder.shift());
    }
    amount = this.round(amount);
    this.cash = this.round(this.cash + amount);
    this.totalRevenue = this.round(this.totalRevenue + amount);
    this.ledger.revenue[source] = this.round((this.ledger.revenue[source] || 0) + amount);
    this.bus.emit('cash:earned', { amount, source });
    this.bus.emit('economy:changed');
    return true;
  }

  canAfford(amount) {
    return this.valid(amount) && this.cash >= amount;
  }

  /** Purchase / paid expense. Fails (returns false) if the player cannot afford it. */
  spend(amount, category) {
    if (!this.canAfford(amount)) return false;
    amount = this.round(amount);
    this.cash = this.round(this.cash - amount);
    this.ledger.expenses[category] = this.round((this.ledger.expenses[category] || 0) + amount);
    this.bus.emit('cash:spent', { amount, category });
    this.bus.emit('economy:changed');
    return true;
  }

  /** Running cost that is always booked (e.g. electricity); cash is floored at 0. */
  expense(amount, category) {
    if (!this.valid(amount)) return false;
    amount = this.round(amount);
    this.cash = Math.max(0, this.round(this.cash - amount));
    this.ledger.expenses[category] = this.round((this.ledger.expenses[category] || 0) + amount);
    this.bus.emit('cash:expense', { amount, category });
    this.bus.emit('economy:changed');
    return true;
  }

  /** Non-revenue grants (missions, daily rewards). */
  grant({ cash = 0, gems = 0, reputation = 0 }) {
    if (cash > 0 && Number.isFinite(cash)) this.cash = this.round(this.cash + cash);
    if (gems > 0 && Number.isFinite(gems)) this.gems += Math.floor(gems);
    if (reputation > 0 && Number.isFinite(reputation)) this.reputation += reputation;
    this.bus.emit('economy:changed');
  }

  /** Reputation can go up or down but never below 0. */
  changeReputation(delta, reason = '') {
    if (!Number.isFinite(delta) || delta === 0) return;
    this.reputation = Math.max(0, this.reputation + delta);
    this.bus.emit('reputation:changed', { delta, total: this.reputation, reason });
    this.bus.emit('economy:changed');
  }

  addKwh(k) {
    if (this.valid(k)) this.ledger.kwh += k;
  }

  get todayRevenue() {
    return Object.values(this.ledger.revenue).reduce((a, b) => a + b, 0);
  }
  get todayExpenses() {
    return Object.values(this.ledger.expenses).reduce((a, b) => a + b, 0);
  }

  /** Close the day: produce the report and reset the ledger. */
  settleDay(day) {
    const rev = this.todayRevenue, exp = this.todayExpenses;
    this.lastReport = {
      day, revenue: this.round(rev), expenses: this.round(exp), net: this.round(rev - exp),
      bySource: { ...this.ledger.revenue }, byCategory: { ...this.ledger.expenses }, kwh: this.round(this.ledger.kwh),
    };
    this.ledger = this.emptyLedger();
    this.history.push(this.lastReport);
    if (this.history.length > 14) this.history.shift(); // keep two weeks for the finance charts
    this.bus.emit('day:report', this.lastReport);
    return this.lastReport;
  }

  serialize() {
    return {
      cash: this.cash, gems: this.gems, reputation: this.reputation, totalRevenue: this.totalRevenue,
      ledger: this.ledger, lastReport: this.lastReport, history: this.history,
    };
  }
}
