/**
 * Fleet contracts (pure logic). Unlocked at Stage 3.
 * Offers refresh every in-game day. Accepting a contract (max 2 at once) means: serve N fleet customers
 * of the contract's kind (charging / wash / garage) before the deadline. While a contract is active, fleet
 * customers show up more often. Completion pays a bonus through the economy; missing the deadline costs
 * reputation.
 */
let seq = 0;
const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (r) => Math.round(rnd(r[0], r[1]));

export class ContractManager {
  constructor({ bus, economy, cfg, progression, getBuilt, saved = null }) {
    this.bus = bus;
    this.economy = economy;
    this.cfg = cfg;
    this.progression = progression;
    this.getBuilt = getBuilt; // (key) => bool
    this.offers = saved?.offers || [];
    this.active = saved?.active || [];
    this.day = saved?.day ?? 1;
    this.done = saved?.done ?? 0;
    this.failed = saved?.failed ?? 0;
    bus.on('customer:paid', ({ customer }) => this.progress('charge', customer));
    bus.on('svc:paid', ({ biz, customer }) => this.progress(biz === 'wash' ? 'wash' : biz === 'garage' ? 'garage' : 'charge', customer));
  }

  get unlocked() { return this.progression.isUnlocked('contracts'); }

  /** Weight multiplier for fleet customers of a kind while a matching contract is active. */
  boostFor(kind) {
    return this.active.some((c) => c.kind === kind) ? 4 : 1;
  }
  get hasActive() { return this.active.length > 0; }

  generate() {
    const pool = this.cfg.templates.filter((t) => !t.requires || this.getBuilt(t.requires));
    this.offers = [];
    for (let i = 0; i < this.cfg.offersPerDay && pool.length; i++) {
      const t = pool[Math.floor(Math.random() * pool.length)];
      const need = ri(t.count), unit = Math.round(rnd(t.perUnit[0], t.perUnit[1]));
      this.offers.push({
        id: `k${++seq}`, kind: t.kind, label: t.label, unit: t.unit, need, have: 0, days: ri(t.days), deadlineDay: null,
        reward: need * unit, rep: t.rep, perUnit: unit,
      });
    }
    this.bus.emit('contract:changed');
  }

  newDay(day) {
    this.day = day;
    for (const c of [...this.active]) {
      if (day > c.deadlineDay) {
        this.active.splice(this.active.indexOf(c), 1);
        this.failed++;
        this.economy.changeReputation(-this.cfg.failRep, 'fleet contract failed');
        this.bus.emit('contract:failed', { contract: c });
      }
    }
    if (this.unlocked) this.generate();
    else this.offers = [];
    this.bus.emit('contract:changed');
  }

  accept(id) {
    const c = this.offers.find((o) => o.id === id);
    if (!c || !this.unlocked) return { ok: false, reason: 'Contracts unlock at Stage 3' };
    if (this.active.length >= this.cfg.maxActive) return { ok: false, reason: `You can run ${this.cfg.maxActive} contracts at once` };
    this.offers.splice(this.offers.indexOf(c), 1);
    c.deadlineDay = this.day + c.days;
    this.active.push(c);
    this.bus.emit('contract:accepted', { contract: c });
    this.bus.emit('contract:changed');
    return { ok: true };
  }

  progress(kind, customer) {
    if (customer?.type !== 'fleet') return;
    for (const c of [...this.active]) {
      if (c.kind !== kind) continue;
      c.have++;
      if (c.have >= c.need) {
        this.active.splice(this.active.indexOf(c), 1);
        this.done++;
        this.economy.earn(c.reward, 'contracts', `contract:${c.id}`);
        this.economy.changeReputation(c.rep, 'fleet contract');
        this.bus.emit('contract:done', { contract: c });
      }
      break; // one served customer counts for one contract
    }
    this.bus.emit('contract:changed');
  }

  serialize() {
    return { offers: this.offers, active: this.active, day: this.day, done: this.done, failed: this.failed };
  }
}
