/**
 * Station power model (pure logic).
 *
 * Supply per tick, in this order:  solar -> battery discharge -> grid import (limited by grid capacity).
 * If demand exceeds what can be supplied, all charging bays are throttled proportionally.
 * Surplus solar charges the battery; the battery also charges from the grid during cheap off-peak hours.
 * Grid energy is billed at a time-of-day tariff (off-peak / normal / peak).
 * Upgrades: grid capacity, charging efficiency, solar array, battery storage (levels from economy.json).
 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class PowerSystem {
  constructor({ cfg, tariff, simScale, getSun, getHour, saved = null }) {
    this.cfg = cfg;
    this.tariff = tariff;
    this.scale = simScale;
    this.getSun = getSun || (() => 0.6);
    this.getHour = getHour || (() => 12);
    this.levels = { grid: saved?.grid ?? 0, efficiency: saved?.efficiency ?? 0, solar: saved?.solar ?? 0, storage: saved?.storage ?? 0 };
    this.stored = saved?.stored ?? 0; // kWh in the battery
    this.pendingCost = 0; // grid cost not yet booked to the economy
    this.live = { factor: 1, demandKw: 0, gridKw: 0, solarKw: 0, batteryKw: 0, chargingBatteryKw: 0 };
    this.todayStats = { gridKwh: 0, solarKwh: 0, batteryKwh: 0, cost: 0 };
  }

  get gridCapacityKw() { return this.cfg.grid[this.levels.grid].kw; }
  get efficiency() { return this.cfg.efficiency[this.levels.efficiency].eff; }
  get solarPeakKw() { return this.cfg.solar[this.levels.solar].kw; }
  get solarNowKw() { return this.solarPeakKw * clamp(this.getSun(), 0, 1); }
  get storageKwh() { return this.cfg.storage[this.levels.storage].kwh; }
  get storageMaxKw() { return this.cfg.storage[this.levels.storage].maxKw; }

  period(hour = this.getHour()) {
    if (hour >= 23 || hour < 6) return 'offpeak';
    if (hour >= 17 && hour < 21) return 'peak';
    return 'normal';
  }
  get tariffNow() { return this.tariff[this.period()]; }

  /**
   * Advance one tick. demandKw = total power the bays want to draw (grid side, already divided by efficiency).
   * Returns the throttle factor (0..1) to apply to every charging bay.
   */
  step(demandKw, dt) {
    const hours = (dt * this.scale) / 3600;
    const solar = this.solarNowKw;
    const maxBat = this.stored > 0 ? this.storageMaxKw : 0;
    const available = this.gridCapacityKw + solar + maxBat;
    const factor = demandKw <= 0 ? 1 : Math.min(1, available / demandKw);
    let need = demandKw * factor;
    const fromSolar = Math.min(solar, need); need -= fromSolar;
    const fromBat = Math.min(maxBat, need, hours > 0 ? this.stored / hours : 0); need -= fromBat;
    const fromGrid = Math.min(this.gridCapacityKw, need);
    let gridKw = fromGrid, batChargeKw = 0;
    // surplus solar -> battery
    const surplus = solar - fromSolar;
    const space = this.storageKwh - this.stored;
    if (surplus > 0 && space > 0) batChargeKw = Math.min(surplus, this.storageMaxKw, hours > 0 ? space / hours : 0);
    // cheap off-peak grid energy -> battery (arbitrage), only with spare grid capacity
    if (this.period() === 'offpeak' && this.storageKwh > 0 && space - batChargeKw * hours > 0.01) {
      const spare = Math.max(0, this.gridCapacityKw - gridKw);
      const extra = Math.min(spare * 0.8, this.storageMaxKw - batChargeKw, hours > 0 ? (space - batChargeKw * hours) / hours : 0);
      if (extra > 0) { batChargeKw += extra; gridKw += extra; }
    }
    this.stored = clamp(this.stored - fromBat * hours + batChargeKw * hours, 0, this.storageKwh);
    const cost = gridKw * hours * this.tariffNow;
    this.pendingCost += cost;
    const t = this.todayStats;
    t.gridKwh += gridKw * hours; t.solarKwh += fromSolar * hours; t.batteryKwh += fromBat * hours; t.cost += cost;
    this.live = { factor, demandKw, gridKw, solarKw: fromSolar, batteryKw: fromBat, chargingBatteryKw: batChargeKw };
    return factor;
  }

  /** Book accumulated grid cost as an electricity expense. */
  flush(economy) {
    if (this.pendingCost > 0.005) {
      economy.expense(this.pendingCost, 'electricity');
      this.pendingCost = 0;
    }
  }

  resetDay() {
    this.todayStats = { gridKwh: 0, solarKwh: 0, batteryKwh: 0, cost: 0 };
  }

  next(kind) {
    return this.cfg[kind][this.levels[kind] + 1] || null;
  }

  serialize() {
    return { ...this.levels, stored: this.stored };
  }
}
