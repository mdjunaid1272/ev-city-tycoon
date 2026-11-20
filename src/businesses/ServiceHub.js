/**
 * Customer hub at the charging station: convenience store, coffee shop, lounge (pure logic).
 *  - store / coffee: customers who are charging may buy something while they wait (revenue: store / coffee)
 *  - lounge: customers wait longer (patience x1.25) and rate the station higher
 *  - coffee also gives a satisfaction bonus to the customers who bought one
 * A cashier on duty raises the purchase chance. Every sale goes through the EconomyManager.
 */
let seq = 0;
const TYPE_FACTOR = { regular: 1, premium: 1.3, impatient: 0.5, fleet: 0.5, vip: 1.5, emergency: 0.15 };

export class ServiceHub {
  constructor({ bus, economy, cfg, getStage, getEmployees, saved = null }) {
    this.bus = bus;
    this.economy = economy;
    this.cfg = cfg;
    this.getStage = getStage;
    this.getEmployees = getEmployees;
    this.built = { store: false, coffee: false, lounge: false, ...(saved?.built || {}) };
    this.pending = [];
    this.time = 0;
    this.sales = { store: 0, coffee: 0, ...(saved?.sales || {}) };
    this.count = { store: 0, coffee: 0, ...(saved?.count || {}) };
    bus.on('charging:start', ({ customer }) => this.onChargingStart(customer));
  }

  lock(key, progression) {
    if (this.built[key]) return 'Built';
    const need = progression.unlockStage(this.cfg[key].feature);
    if (this.getStage() < need) return `Unlocks at Stage ${need}`;
    return null;
  }
  canBuild(key, progression) {
    return !this.lock(key, progression) && this.economy.canAfford(this.cfg[key].cost);
  }
  build(key, progression) {
    if (!this.cfg[key] || this.lock(key, progression)) return false;
    if (!this.economy.spend(this.cfg[key].cost, 'equipment')) return false;
    this.built[key] = true;
    this.bus.emit('hub:built', { key });
    this.bus.emit('station:changed');
    return true;
  }

  get patienceMult() {
    return this.built.lounge ? this.cfg.lounge.patienceMult : 1;
  }
  satisfactionBonus(c) {
    let s = this.built.lounge ? this.cfg.lounge.satisfaction : 0;
    if (c?.boughtCoffee) s += this.cfg.coffee.satisfaction;
    return s;
  }

  onChargingStart(c) {
    if (!c) return;
    const cashier = this.getEmployees().satisfactionBonus > 0 ? 1.25 : 1;
    for (const key of ['store', 'coffee']) {
      if (!this.built[key]) continue;
      if (key === 'coffee' && this.coffeeHandledByCafe) continue; // the Café turns this chance into a real order (see Cafe.js)
      const p = this.cfg[key].chance * (TYPE_FACTOR[c.type] ?? 1) * cashier;
      if (Math.random() < p) this.pending.push({ at: this.time + 4 + Math.random() * 14, c, key });
    }
  }

  update(dt) {
    this.time += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p.at > this.time) continue;
      this.pending.splice(i, 1);
      if (p.c.state !== 'charging') continue; // customer already left
      const [lo, hi] = this.cfg[p.key].spend;
      const amount = Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
      if (this.economy.earn(amount, p.key, `hub:${p.key}:${p.c.id}:${++seq}`)) {
        this.sales[p.key] += amount;
        this.count[p.key]++;
        if (p.key === 'coffee') p.c.boughtCoffee = true;
        this.bus.emit('hub:sale', { key: p.key, amount, customer: p.c });
      }
    }
  }

  serialize() {
    return { built: this.built, sales: this.sales, count: this.count };
  }
}
