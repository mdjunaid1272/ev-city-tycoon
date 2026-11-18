/**
 * One catalog for every upgrade in the game (charging, power, car wash, garage, customer hub).
 * Each entry knows its level, next effect, cost, lock reason (progression stage / facility) and how to buy.
 * Purchases always go through the businesses, which spend via the EconomyManager.
 */
const $ = (n) => `$${n.toLocaleString('en-US')}`;

export class UpgradeManager {
  constructor({ economy, station, wash, garage, hub, progression, hubs = {} }) {
    Object.assign(this, { economy, station, wash, garage, hub, progression, hubs });
  }

  list() {
    const { station: st, wash: w, garage: g, hub, progression: pr } = this;
    const items = [];
    const add = (o) => {
      const cost = o.cost ?? 0;
      const maxed = o.maxed ?? false;
      const lock = maxed ? null : o.lock || null;
      // facilities that are not built yet are at level 0, not at their starting level
      const level = o.lock && /^Build the/.test(o.lock) ? 0 : o.level;
      items.push({ ...o, level, cost, maxed, lock, can: !maxed && !lock && o.cost !== null && this.economy.canAfford(cost) });
    };
    const pw = st.power;
    const level = (kind) => pw.levels[kind];
    const powerItem = (kind, icon, name, desc) => {
      const n = pw.next(kind);
      add({
        id: `power:${kind}`, group: 'Charging & power', icon, name, level: level(kind), max: pw.cfg[kind].length - 1,
        desc: n ? `${n.name}: ${desc(n)}` : 'Fully upgraded', cost: n ? n.cost : null, maxed: !n, lock: n ? st.powerUpgradeLock(kind) : null, buy: () => st.upgradePower(kind),
      });
    };
    // --- charging ---
    const lockedBay = st.bays.find((b) => !b.unlocked);
    add({ id: 'bay', group: 'Charging & power', icon: '🅿️', name: 'Charging bay', level: st.unlockedCount, max: st.bays.length, desc: `Slot ${lockedBay ? lockedBay.id + 1 : '-'}: +1 vehicle at a time`, cost: lockedBay ? st.cfg.bayCost : null, maxed: !lockedBay, buy: () => st.buyBay(lockedBay.id) });
    const nc = st.nextChargerUpgrade();
    add({ id: 'chargers', group: 'Charging & power', icon: '⚡', name: 'Charger speed', level: st.chargerLevel, max: st.cfg.chargerLevels.length, desc: nc ? `${nc.name}: ${nc.kw} kW per bay${nc.connectors.length > st.charger.connectors.length ? ' + CHADEMO connectors' : ''}` : 'Fully upgraded', cost: nc ? nc.cost : null, maxed: !nc, lock: nc ? st.chargerUpgradeLock() : null, buy: () => st.upgradeChargers() });
    powerItem('grid', '🔌', 'Power capacity', (n) => `${n.kw} kW grid connection (limits total charging power)`);
    powerItem('efficiency', '♻️', 'Charging efficiency', (n) => `${Math.round(n.eff * 1000) / 10}% efficient (less wasted electricity)`);
    powerItem('solar', '☀️', 'Solar energy', (n) => `${n.kw} kW peak: free daytime electricity`);
    powerItem('storage', '🔋', 'Battery storage', (n) => `${n.kwh} kWh: stores solar & cheap night power for peak hours`);
    // --- car wash ---
    const wl = w.built ? null : 'Build the car wash first';
    const nw = w.nextEquipment();
    add({ id: 'wash:bay', group: 'Car wash', icon: '🧽', name: 'Wash bay', level: w.unlockedBays, max: w.bays.length, desc: '+1 wash bay', cost: w.nextBayCost(), maxed: w.nextBayCost() === null, lock: wl, buy: () => w.addBay() });
    add({ id: 'wash:equip', group: 'Car wash', icon: '🫧', name: 'Wash equipment', level: w.equipLevel, max: w.cfg.equipment.length, desc: nw ? `${nw.name}: x${nw.speed} speed, +${Math.round(nw.clean * 100)}% clean, new packages` : 'Fully upgraded', cost: nw ? nw.cost : null, maxed: !nw, lock: wl, buy: () => w.upgradeEquipment() });
    const tunBay = w.bays.findIndex((b) => b.unlocked && b.mode === 'manual');
    const tunLock = wl || (!pr.isUnlocked('tunnel') ? `Unlocks at Stage ${pr.unlockStage('tunnel')}` : w.equipLevel < w.cfg.tunnelMinEquipment ? `Needs wash equipment level ${w.cfg.tunnelMinEquipment}` : null);
    add({ id: 'wash:tunnel', group: 'Car wash', icon: '🚿', name: 'Automatic tunnel', level: w.bays.filter((b) => b.mode === 'tunnel').length, max: w.unlockedBays, desc: 'Converts a bay: staff only start the machine', cost: tunBay >= 0 ? w.cfg.tunnelCost : null, maxed: tunBay < 0 && w.built, lock: tunLock, buy: () => w.upgradeTunnel(tunBay) });
    // --- garage ---
    const gl = g.built ? null : 'Build the garage first';
    const ns = g.cfg.scanner[g.scannerLevel], nt = g.cfg.tools[g.toolLevel];
    add({ id: 'garage:lift', group: 'EV garage', icon: '🛠️', name: 'Repair lift', level: g.unlockedBays, max: g.bays.length, desc: '+1 repair bay', cost: g.nextLiftCost(), maxed: g.nextLiftCost() === null, lock: gl, buy: () => g.addLift() });
    add({ id: 'garage:scanner', group: 'EV garage', icon: '🔍', name: 'Diagnostic scanner', level: g.scannerLevel, max: g.cfg.scanner.length, desc: ns ? `${ns.name}: x${ns.diagSpeed} diagnosis speed${g.scannerLevel === 1 ? ', unlocks motor servicing' : ''}` : 'Fully upgraded', cost: ns ? ns.cost : null, maxed: !ns, lock: gl, buy: () => g.upgrade('scanner') });
    add({ id: 'garage:tools', group: 'EV garage', icon: '🧰', name: 'Tool station', level: g.toolLevel, max: g.cfg.tools.length, desc: nt ? `${nt.name}: x${nt.speed} repair speed` : 'Fully upgraded', cost: nt ? nt.cost : null, maxed: !nt, lock: gl, buy: () => g.upgrade('tools') });
    add({ id: 'garage:battery', group: 'EV garage', icon: '🔋', name: 'Battery service equipment', level: g.batteryStation ? 1 : 0, max: 1, desc: 'Unlocks battery replacement jobs ($480)', cost: g.batteryStation ? null : g.cfg.batteryStationCost, maxed: g.batteryStation, lock: gl, buy: () => g.upgrade('battery') });
    // --- customer hub ---
    for (const key of ['store', 'coffee', 'lounge']) {
      const c = hub.cfg[key];
      add({ id: `hub:${key}`, group: 'Customer hub', icon: c.icon, name: c.label, level: hub.built[key] ? 1 : 0, max: 1, desc: c.blurb, cost: hub.built[key] ? null : c.cost, maxed: hub.built[key], lock: hub.built[key] ? null : hub.lock(key, pr), buy: () => hub.build(key, pr) });
    }
    // --- purchased charging hubs ---
    for (const h of Object.values(this.hubs || {})) {
      if (!h.built) continue;
      const grp = `${h.cfg.icon} ${h.cfg.label}`;
      const nb = h.nextBayCost(), nc = h.nextCharger();
      add({ id: `${h.id}:bay`, group: grp, icon: '🅿️', name: 'Charging bay', level: h.unlockedBays, max: h.bays.length, desc: '+1 charging bay at this hub', cost: nb, maxed: nb === null, buy: () => h.addBay() });
      add({ id: `${h.id}:chargers`, group: grp, icon: '⚡', name: 'Charger speed', level: h.chargerLevel + 1, max: h.hub.chargers.length, desc: nc ? `${nc.name}: ${nc.kw} kW per bay` : 'Fully upgraded', cost: nc ? nc.cost : null, maxed: !nc, lock: nc ? h.chargerLock() : null, buy: () => h.upgradeCharger() });
    }
    return items;
  }

  get(id) {
    return this.list().find((i) => i.id === id);
  }

  buy(id) {
    const it = this.get(id);
    if (!it || it.maxed || it.lock || !it.can) return { ok: false, reason: it?.lock || (it?.maxed ? 'Fully upgraded' : 'Not enough cash') };
    return { ok: !!it.buy(), reason: '' };
  }

  summary() {
    return `${$(this.economy.cash)}`;
  }
}
