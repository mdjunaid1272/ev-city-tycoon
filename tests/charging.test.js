import { describe, it, expect } from 'vitest';
import { makeWorld, spawnCustomer, parkAndPlug } from './helpers.js';

const runUntil = (w, pred, maxSeconds = 4000, dt = 0.5) => {
  for (let t = 0; t < maxSeconds && !pred(); t += dt) w.station.update(dt);
  return pred();
};

describe('charging bays: reservation and release', () => {
  it('gives two cars two different bays and refuses a third (exactly one car per bay)', () => {
    const w = makeWorld();
    const [a, b, c] = [spawnCustomer(w), spawnCustomer(w), spawnCustomer(w)];
    const ra = w.customers.arrived(a), rb = w.customers.arrived(b);
    expect([ra.action, rb.action]).toEqual(['bay', 'bay']);
    expect(ra.bayId).not.toBe(rb.bayId);
    expect(w.station.freeBays).toBe(0);
    expect(w.station.reserveBay(c)).toBeNull();
    expect(w.parking.stats('station-bays').reserved).toBe(2);
  });

  it('bay lifecycle: empty -> reserved -> waiting -> charging -> done -> empty, freeing the parking space', () => {
    const w = makeWorld();
    const c = spawnCustomer(w);
    const { bayId } = w.customers.arrived(c);
    const bay = w.station.bays[bayId];
    expect(bay.state).toBe('reserved');
    w.station.vehicleParked(bayId); expect(bay.state).toBe('waiting');
    expect(w.station.startCharging(bayId)).toBe(true); expect(bay.state).toBe('charging');
    expect(runUntil(w, () => bay.state === 'done')).toBe(true);
    expect(w.station.release(bayId)).toBe(true);
    w.station.vehicleLeft(bayId);
    expect(bay.state).toBe('empty');
    expect(bay.customer).toBeNull();
    expect(w.station.freeBays).toBe(2);
    expect(w.parking.stats('station-bays').reserved).toBe(0);
  });

  it('a freed bay is given to the queue automatically', () => {
    const w = makeWorld();
    const cars = Array.from({ length: 3 }, () => spawnCustomer(w));
    cars.forEach((c) => w.customers.arrived(c));
    const queued = w.customers.queue[0];
    expect(queued).toBeTruthy();
    const first = cars.find((c) => c.state === 'assigned');
    w.station.vehicleParked(first.bayId); w.customers.parkedAtBay(first); w.station.startCharging(first.bayId);
    runUntil(w, () => w.station.bays[first.bayId].state === 'done');
    w.station.release(first.bayId); w.station.vehicleLeft(first.bayId);
    expect(queued.state).toBe('assigned');
    expect(w.customers.queue).not.toContain(queued);
  });
});

describe('charging: payment and invalid states', () => {
  it('bills exactly delivered kWh x price x customer multiplier, once', () => {
    const w = makeWorld({ cash: 0 });
    const c = spawnCustomer(w);
    const r = parkAndPlug(w, c);
    const bay = w.station.bays[r.bayId];
    expect(runUntil(w, () => bay.state === 'done')).toBe(true);
    const expected = Math.round(bay.delivered * w.station.pricePerKwh * c.def.payMult * 100) / 100;
    expect(w.economy.ledger.revenue.charging).toBeCloseTo(expected, 1);
    const cashAfter = w.economy.cash;
    w.station.finishCharging(bay); // a second finish (double click, event replay) must not pay again
    expect(w.economy.cash).toBe(cashAfter);
    expect(w.station.served).toBe(1);
  });

  it('early checkout bills only what was delivered; with nothing delivered it just goes back to waiting', () => {
    const w = makeWorld({ cash: 0 });
    const c = spawnCustomer(w);
    const r = parkAndPlug(w, c);
    const bay = w.station.bays[r.bayId];
    expect(w.station.stopCharging(r.bayId)).toBe(true);
    expect(bay.state).toBe('waiting'); // delivered 0 kWh -> no bill
    expect(w.economy.cash).toBe(0);
    w.station.startCharging(r.bayId);
    for (let i = 0; i < 40; i++) w.station.update(0.5);
    const delivered = bay.delivered;
    expect(delivered).toBeGreaterThan(0);
    expect(w.station.stopCharging(r.bayId)).toBe(true);
    expect(bay.state).toBe('done');
    expect(bay.delivered).toBe(delivered);
    expect(w.economy.ledger.revenue.charging).toBeGreaterThan(0);
  });

  it('rejects actions that do not fit the bay state', () => {
    const w = makeWorld();
    expect(w.station.startCharging(0)).toBe(false); // empty
    expect(w.station.stopCharging(0)).toBe(false); // not charging
    expect(w.station.release(0)).toBe(false); // nothing to unplug
    expect(w.station.startCharging(99)).toBe(false); // no such bay
    const c = spawnCustomer(w);
    const { bayId } = w.customers.arrived(c);
    expect(w.station.startCharging(bayId)).toBe(false); // reserved: the car has not parked yet
  });

  it('a customer who gives up while waiting at a bay frees it without paying', () => {
    const w = makeWorld({ cash: 0 });
    const c = spawnCustomer(w);
    const { bayId } = w.customers.arrived(c);
    w.station.vehicleParked(bayId); w.customers.parkedAtBay(c);
    c.patience = 0.01;
    w.customers.update(1);
    expect(w.customers.customers.has(c.id)).toBe(false);
    expect(w.station.bays[bayId].state).toBe('done');
    expect(w.economy.cash).toBe(0);
    w.station.vehicleLeft(bayId);
    expect(w.station.bays[bayId].state).toBe('empty');
  });

  it('building a bay needs cash and cannot be done twice; price is clamped and NaN ignored', () => {
    const poor = makeWorld({ cash: 10 });
    expect(poor.station.buyBay(2)).toBe(false);
    expect(poor.station.unlockedCount).toBe(2);
    const rich = makeWorld({ cash: 1e6 });
    expect(rich.station.buyBay(2)).toBe(true);
    expect(rich.station.buyBay(2)).toBe(false);
    expect(rich.station.unlockedCount).toBe(3);
    const before = rich.station.pricePerKwh;
    rich.station.setPrice(NaN); expect(rich.station.pricePerKwh).toBe(before);
    rich.station.setPrice(9999); expect(rich.station.pricePerKwh).toBe(rich.station.cfg.maxPrice);
    rich.station.setPrice(-1); expect(rich.station.pricePerKwh).toBe(rich.station.cfg.minPrice);
  });

  it('power capacity: charging power never exceeds the charger or the car limit and tapers when nearly full', () => {
    const w = makeWorld();
    const c = spawnCustomer(w);
    const r = parkAndPlug(w, c);
    const bay = w.station.bays[r.bayId];
    const v = bay.vehicle;
    const p = w.station.requestedPower(bay);
    expect(p).toBeLessThanOrEqual(Math.min(w.station.charger.kw, v.maxChargeKw) + 1e-9);
    v.soc = 0.95;
    expect(w.station.requestedPower(bay)).toBeLessThan(p);
  });
});
