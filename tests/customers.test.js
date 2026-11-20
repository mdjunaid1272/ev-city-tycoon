import { describe, it, expect } from 'vitest';
import { makeWorld, spawnCustomer, parkAndPlug } from './helpers.js';
import { HAPPY_SCORE } from '../src/progression/StatsTracker.js';

const finish = (w, c) => {
  const bay = w.station.bays[c.bayId];
  for (let i = 0; i < 8000 && bay.state === 'charging'; i++) w.station.update(0.5);
  return bay;
};

describe('customer lifecycle', () => {
  it('spawns unique customers with a vehicle, a type and full patience', () => {
    const w = makeWorld();
    const list = Array.from({ length: 6 }, () => spawnCustomer(w));
    expect(new Set(list.map((c) => c.id)).size).toBe(6); // no duplicate customers
    for (const c of list) { expect(c.state).toBe('navigate'); expect(c.vehicle.capacityKwh).toBeGreaterThan(0); expect(c.patience).toBe(c.maxPatience); }
  });

  it('the very first customer of a new game is a compatible regular', () => {
    const w = makeWorld();
    const c = w.customers.spawn();
    expect(c).toBeTruthy();
    expect(c.type).toBe('regular');
    expect(w.station.supports(c.vehicle.connector)).toBe(true);
  });

  it('queue: a customer joins when bays are full, is served in priority order and leaves the queue once assigned', () => {
    const w = makeWorld();
    const [a, b] = [spawnCustomer(w), spawnCustomer(w)];
    w.customers.arrived(a); w.customers.arrived(b);
    const regular = spawnCustomer(w, 'regular'), emergency = spawnCustomer(w, 'emergency');
    expect(w.customers.arrived(regular).action).toBe('queue');
    expect(w.customers.arrived(emergency).action).toBe('queue');
    expect(w.customers.queue).toHaveLength(2);
    // free one bay: the emergency customer (higher priority) is assigned first although the regular arrived earlier
    w.station.vehicleParked(a.bayId); w.customers.parkedAtBay(a); w.station.startCharging(a.bayId);
    finish(w, a); w.station.release(a.bayId); w.station.vehicleLeft(a.bayId);
    expect(emergency.state).toBe('assigned');
    expect(regular.state).toBe('queue');
    expect(w.customers.queue).toEqual([regular]);
  });

  it('turns customers away when the queue is full, without a reputation penalty', () => {
    const w = makeWorld();
    const repBefore = w.economy.reputation;
    let left = 0;
    for (let i = 0; i < 12; i++) { const c = spawnCustomer(w); if (w.customers.arrived(c).action === 'leave') left++; }
    expect(left).toBeGreaterThan(0);
    expect(w.customers.queue.length).toBeLessThanOrEqual(w.customers.maxQueue);
    expect(w.economy.reputation).toBe(repBefore);
  });

  it('pays once: the customer is removed, counted as served, and a replayed completion event changes nothing', () => {
    const w = makeWorld({ cash: 0 });
    const c = spawnCustomer(w);
    parkAndPlug(w, c);
    finish(w, c);
    expect(c.state).toBe('paid');
    expect(w.customers.customers.has(c.id)).toBe(false);
    expect(w.customers.stats.served).toBe(1);
    const cash = w.economy.cash;
    w.bus.emit('charging:complete', { customer: c, revenue: 50, unitPrice: 0.5, vehicle: c.vehicle, bayId: c.bayId });
    expect(w.customers.stats.served).toBe(1);
    expect(w.economy.cash).toBe(cash);
  });

  it('satisfaction stays within 0..100 and tips are paid only to happy customers', () => {
    const w = makeWorld({ cash: 0 });
    const happy = spawnCustomer(w); happy.waitTime = 0;
    expect(w.customers.rate(happy, 0.4)).toBeLessThanOrEqual(100);
    const unhappy = spawnCustomer(w); unhappy.waitTime = unhappy.maxPatience * 5;
    expect(w.customers.rate(unhappy, 0.4)).toBeGreaterThanOrEqual(0);
    expect(w.customers.rate(unhappy, 0.4)).toBeLessThan(w.customers.rate(happy, 0.4));
    const tipsBefore = w.customers.stats.tips;
    unhappy.state = 'charging'; w.customers.customers.set(unhappy.id, unhappy);
    w.customers.rate = () => HAPPY_SCORE - 1; // just below the happy threshold
    w.customers.onPaid({ customer: unhappy, revenue: 100, unitPrice: 0.5 });
    expect(w.customers.stats.tips).toBe(tipsBefore);
    happy.state = 'charging'; w.customers.customers.set(happy.id, happy);
    w.customers.rate = () => HAPPY_SCORE;
    w.customers.onPaid({ customer: happy, revenue: 100, unitPrice: 0.5 });
    expect(w.customers.stats.tips).toBeGreaterThan(tipsBefore);
  });

  it('impatient queued customers leave: removed from the map AND the queue, reputation drops', () => {
    const w = makeWorld();
    const cars = Array.from({ length: 3 }, () => spawnCustomer(w));
    cars.forEach((c) => w.customers.arrived(c));
    const queued = w.customers.queue[0];
    const rep = (w.economy.reputation = 10);
    queued.patience = 0.01;
    w.customers.update(1);
    expect(w.customers.queue).not.toContain(queued);
    expect(w.customers.customers.has(queued.id)).toBe(false);
    expect(w.economy.reputation).toBe(rep - 2);
    // the car is still parked in its slot until it drives out: the view then frees the slot for the next arrival
    expect(w.parking.stats('station-queue').reserved).toBe(w.customers.queue.length + 1);
    w.customers.releaseSlot(queued);
    expect(queued.slot).toBeNull();
    expect(w.parking.stats('station-queue').reserved).toBe(w.customers.queue.length);
  });
});
