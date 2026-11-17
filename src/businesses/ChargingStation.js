/**
 * Charging station simulation (no Three.js). Customers are created by CustomerManager; the station
 * owns bays, chargers, pricing and the charging/payment calculation.
 *
 * Bay lifecycle:  empty -> reserved -> waiting -> charging -> done -> (vehicle leaves) -> empty
 *
 * Energy:   required = capacity * (target - soc)
 * Power:    min(charger kW, vehicle max kW), tapering above 80% SoC
 * Charging: energy into the battery; the grid supplies energy / efficiency (billed as electricity)
 * Revenue:  energy delivered * price per kWh * customer-type multiplier, booked once via EconomyManager
 */
export const BAY_SLOTS = [-5, 5, -15, 15]; // x positions of the four bay slots (2 unlocked at start)

export class ChargingStation {
  constructor(bus, economy, config, saved = null, parking = null, { power = null, getStage = () => 4 } = {}) {
    this.power = power;
    this.getStage = getStage;
    this.flushTimer = 0;
    this.parking = parking;
    this.bus = bus;
    this.economy = economy;
    this.cfg = config;
    this.pricePerKwh = saved?.pricePerKwh ?? config.defaultPricePerKwh;
    this.chargerLevel = saved?.chargerLevel ?? 1;
    const unlocked = saved?.unlockedBays ?? 2;
    this.bays = BAY_SLOTS.map((x, i) => ({
      id: i, x, unlocked: i < unlocked, state: 'empty', vehicle: null, customer: null, space: null, delivered: 0, drawn: 0, power: 0,
    }));
    // every bay is a reservable parking space; locked bays are disabled
    parking?.addLot('station-bays', BAY_SLOTS.map((x) => ({ x, z: 0, yaw: 0 })));
    this.bays.forEach((b) => { if (parking) parking.spaces('station-bays')[b.id].enabled = b.unlocked; });
    this.served = saved?.served ?? 0;
    this.todayServed = 0;
  }

  get charger() {
    return this.cfg.chargerLevels[this.chargerLevel - 1];
  }
  get unlockedCount() {
    return this.bays.filter((b) => b.unlocked).length;
  }
  get freeBays() {
    return this.bays.filter((b) => b.unlocked && b.state === 'empty').length;
  }
  /** Theoretical max throughput for UI: kW per bay summed. */
  get totalCapacityKw() {
    return this.unlockedCount * this.charger.kw;
  }
  supports(connector) {
    return this.charger.connectors.includes(connector);
  }

  setPrice(p) {
    if (!Number.isFinite(p)) return;
    this.pricePerKwh = Math.round(Math.min(this.cfg.maxPrice, Math.max(this.cfg.minPrice, p)) * 100) / 100;
    this.bus.emit('station:changed');
  }

  nextBayCost() {
    return this.unlockedCount < this.bays.length ? this.cfg.bayCost : null;
  }

  buyBay(id) {
    const b = this.bays[id];
    if (!b || b.unlocked) return false;
    if (!this.economy.spend(this.cfg.bayCost, 'equipment')) return false;
    b.unlocked = true;
    if (this.parking) this.parking.spaces('station-bays')[id].enabled = true;
    this.bus.emit('station:bay-unlocked', { id });
    this.bus.emit('station:changed');
    this.bus.emit('station:bay-free');
    return true;
  }

  nextChargerUpgrade() {
    return this.cfg.chargerLevels[this.chargerLevel] || null;
  }

  /** Why the next charger upgrade is unavailable (progression stage), or null. */
  chargerUpgradeLock() {
    const next = this.nextChargerUpgrade();
    if (next && next.stage > this.getStage()) return `Unlocks at Stage ${next.stage}`;
    return null;
  }

  upgradeChargers() {
    const next = this.nextChargerUpgrade();
    if (!next || this.chargerUpgradeLock() || !this.economy.spend(next.cost, 'equipment')) return false;
    this.chargerLevel = next.level;
    this.bus.emit('station:upgraded', { level: next.level });
    this.bus.emit('station:changed');
    return true;
  }

  /** Reserve a free bay for a customer (exactly one customer per bay, enforced by the parking system). */
  reserveBay(customer) {
    const space = this.parking?.reserve('station-bays', customer.id);
    if (!space) return null;
    const bay = this.bays[space.index];
    bay.space = space;
    bay.state = 'reserved';
    bay.vehicle = customer.vehicle;
    bay.customer = customer;
    bay.delivered = bay.drawn = 0;
    this.bus.emit('station:changed');
    return bay;
  }

  get efficiency() {
    return this.power ? this.power.efficiency : this.cfg.chargerEfficiency;
  }

  /** Power a bay would like to draw into the battery (kW): charger limit, vehicle limit, taper above 80%. */
  requestedPower(b) {
    const v = b.vehicle;
    const kwMax = Math.min(this.charger.kw, v.maxChargeKw);
    const taper = v.soc > 0.8 ? 1 - 0.75 * ((v.soc - 0.8) / 0.2) : 1;
    return kwMax * taper;
  }

  update(dt) {
    const charging = this.bays.filter((b) => b.state === 'charging');
    // total grid-side demand decides whether the power system must throttle all bays
    let factor = 1;
    if (this.power) {
      let demand = 0;
      for (const b of charging) { b.req = this.requestedPower(b); demand += b.req / this.efficiency; }
      factor = this.power.step(demand, dt);
      this.flushTimer += dt;
      if (this.flushTimer >= 4) { this.flushTimer = 0; this.power.flush(this.economy); }
    }
    for (const b of charging) this.tickCharging(b, dt, factor);
  }

  tickCharging(b, dt, factor = 1) {
    const v = b.vehicle;
    const power = this.requestedPower(b) * factor; // kW into the battery after throttling
    b.power = power;
    b.throttle = factor;
    const hours = (dt * this.cfg.simTimeScale) / 3600;
    let e = power * hours;
    const remaining = v.capacityKwh * (v.targetSoc - v.soc);
    if (e >= remaining) e = Math.max(0, remaining);
    v.soc += e / v.capacityKwh;
    b.delivered += e;
    b.drawn += e / this.efficiency;
    if (v.soc >= v.targetSoc - 1e-6) this.finishCharging(b);
  }

  // ---------- power upgrades (grid / efficiency / solar / storage) ----------
  powerUpgradeLock(kind) {
    const n = this.power?.next(kind);
    if (!n) return 'Fully upgraded';
    if (n.stage > this.getStage()) return `Unlocks at Stage ${n.stage}`;
    return null;
  }
  upgradePower(kind) {
    const n = this.power?.next(kind);
    if (!n || this.powerUpgradeLock(kind) || !this.economy.spend(n.cost, 'equipment')) return false;
    this.power.levels[kind]++;
    this.bus.emit('station:power', { kind, level: this.power.levels[kind] });
    this.bus.emit('station:changed');
    return true;
  }

  finishCharging(b) {
    if (b.state !== 'charging') return;
    b.state = 'done';
    b.power = 0;
    const v = b.vehicle, c = b.customer;
    const mult = c?.def?.payMult ?? 1;
    const unitPrice = this.pricePerKwh * mult;
    const revenue = b.delivered * unitPrice;
    const elec = b.drawn * (this.power ? this.power.tariffNow : this.cfg.electricityCostPerKwh); // estimate for the toast; the real bill is metered per tick
    this.economy.earn(revenue, 'charging', `charge:${v.id}`); // txId guards against double payment
    if (this.power) this.power.flush(this.economy);
    else this.economy.expense(elec, 'electricity');
    this.economy.addKwh(b.delivered);
    this.served++;
    this.todayServed++;
    b.released = false; // the vehicle stays plugged in until an attendant (or the player) unplugs it
    this.bus.emit('charging:complete', { bayId: b.id, vehicle: v, customer: c, kwh: b.delivered, revenue, electricity: elec, unitPrice });
    this.bus.emit('station:changed');
  }

  /** Unplug a finished vehicle and send it off. */
  release(bayId) {
    const b = this.bays[bayId];
    if (!b || b.state !== 'done' || b.released) return false;
    b.released = true;
    this.bus.emit('vehicle:depart', { bayId });
    this.bus.emit('station:unplugged', { bayId });
    this.bus.emit('station:changed');
    return true;
  }

  // --- calls from the view / player / employees ---
  vehicleParked(bayId) {
    const b = this.bays[bayId];
    if (b && b.state === 'reserved') {
      b.state = 'waiting';
      this.bus.emit('station:changed');
    }
  }

  startCharging(bayId) {
    const b = this.bays[bayId];
    if (!b || b.state !== 'waiting') return false;
    b.state = 'charging';
    this.bus.emit('charging:start', { bayId, customer: b.customer });
    this.bus.emit('station:changed');
    return true;
  }

  /** Stop early and bill for what was delivered. */
  stopCharging(bayId) {
    const b = this.bays[bayId];
    if (!b || b.state !== 'charging') return false;
    if (b.delivered <= 0) {
      b.state = 'waiting';
      this.bus.emit('station:changed');
      return true;
    }
    this.finishCharging(b);
    return true;
  }

  /** Customer gave up while waiting at the bay: no payment, vehicle leaves. */
  abandon(bayId) {
    const b = this.bays[bayId];
    if (!b || (b.state !== 'waiting' && b.state !== 'reserved')) return false;
    b.state = 'done';
    b.power = 0;
    b.released = true; // nothing to unplug: the customer simply drives off
    this.bus.emit('vehicle:depart', { bayId });
    this.bus.emit('station:changed');
    return true;
  }

  vehicleLeft(bayId) {
    const b = this.bays[bayId];
    if (!b || b.state !== 'done') return;
    if (this.parking && b.space) this.parking.release(b.space, b.customer?.id ?? b.vehicle?.id);
    b.space = null;
    b.state = 'empty';
    b.vehicle = null;
    b.customer = null;
    b.released = false;
    b.delivered = b.drawn = 0;
    this.bus.emit('station:changed');
    this.bus.emit('station:bay-free');
  }

  serialize() {
    return { pricePerKwh: this.pricePerKwh, chargerLevel: this.chargerLevel, unlockedBays: this.unlockedCount, served: this.served, power: this.power?.serialize() };
  }
}
