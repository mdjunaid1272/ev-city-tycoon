/**
 * Property catalog and purchasing (pure logic).
 * Every lot on the map is a property: the two service sites (car wash, garage) and the four hub lots
 * (small / commercial / industrial / highway). Buying checks the district permit, progression stage,
 * reputation and cash, then builds the business on the lot. Owned lots cost a daily property tax.
 */
export class PropertyManager {
  constructor({ bus, economy, cfg, hubs, wash, garage, districts, getStage }) {
    this.bus = bus;
    this.economy = economy;
    this.districts = districts;
    this.getStage = getStage;
    // any lot being built (by purchase here or by walking up to its sign) counts as a property bought
    bus.on('svc:built', ({ biz }) => {
      const e = this.entries.find((x) => x.biz.id === biz);
      if (e) bus.emit('property:bought', { id: e.id, name: e.name || e.biz.cfg.label });
    });
    this.entries = cfg.map((p) => {
      const biz = p.kind === 'hub' ? hubs[p.hub] : p.id === 'wash' ? wash : garage;
      return { ...p, biz, x: p.ix * 60, z: p.iz * 60 };
    });
  }

  get(id) { return this.entries.find((e) => e.id === id); }

  info(e) {
    const biz = e.biz, cfg = biz.cfg;
    const name = e.name || cfg.label;
    const category = e.category || biz.hub?.category;
    const price = cfg.buildCost;
    const owned = biz.built;
    let reason = null;
    if (!owned) {
      const d = this.districts.lock(e.district);
      if (!this.districts.isUnlocked(e.district)) reason = d ? `${this.districts.cfg[e.district].name}: ${d}` : `Buy the ${this.districts.cfg[e.district].name} permit first`;
      else { const c = biz.canBuild(this.economy.reputation); if (!c.ok && !/cash/i.test(c.reason || '')) reason = c.reason; }
    }
    const tax = Math.round(price * (biz.hub ? biz.hub.taxPerDay : 0.0015) * 100) / 100;
    return {
      id: e.id, name, category, district: e.district, kind: e.kind, price, stage: cfg.stage, owned, x: e.x, z: e.z, tax,
      upkeep: cfg.upkeepPerBayPerDay * biz.unlockedBays, blurb: biz.hub?.blurb || (e.id === 'wash' ? 'Wash cars with manual stalls or automatic tunnels.' : 'Diagnose and repair EVs with lifts, scanners and a parts store.'),
      status: owned ? 'owned' : reason ? 'locked' : 'available', reason, canBuy: !owned && !reason && this.economy.canAfford(price), icon: cfg.icon,
    };
  }

  list() { return this.entries.map((e) => this.info(e)); }
  /** Number of lots built (extra properties beyond the home station). */
  get ownedCount() { return this.entries.filter((e) => e.biz.built).length; }

  buy(id) {
    const e = this.get(id);
    if (!e) return { ok: false, reason: 'Unknown property' };
    const i = this.info(e);
    if (i.owned) return { ok: false, reason: 'Already owned' };
    if (i.reason) return { ok: false, reason: i.reason };
    if (!this.economy.canAfford(i.price)) return { ok: false, reason: 'Not enough cash' };
    const r = e.biz.build(); // emits svc:built -> property:bought
    this.bus.emit('property:changed');
    return r;
  }

  /** Daily property tax for every owned lot (category: property). */
  dailyCosts() {
    let total = 0;
    for (const e of this.entries) if (e.biz.built) total += e.biz.cfg.buildCost * (e.biz.hub ? e.biz.hub.taxPerDay : 0.0015);
    total = Math.round(total * 100) / 100;
    if (total > 0) this.economy.expense(total, 'property');
    return total;
  }
}
