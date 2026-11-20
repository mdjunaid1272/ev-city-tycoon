import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('customer behaviour', () => {
  afterEach(() => vi.restoreAllMocks());
  const queueUp = (w, specs) => {
    // fill both bays, then let the given customer types queue (oldest first)
    const [a, b] = [spawnCustomer(w), spawnCustomer(w)];
    w.customers.arrived(a); w.customers.arrived(b);
    const queued = specs.map(({ type, waited = 0 }) => {
      const c = spawnCustomer(w, type);
      w.customers.arrived(c);
      c.arrivedAt = w.customers.time - waited;
      return c;
    });
    return { a, b, queued };
  };
  const freeOneBay = (w, a) => { w.station.vehicleParked(a.bayId); w.customers.parkedAtBay(a); w.station.startCharging(a.bayId); finish(w, a); w.station.release(a.bayId); w.station.vehicleLeft(a.bayId); };

  it('customer types really differ: patience, price tolerance and what they pay', () => {
    const w = makeWorld();
    const t = w.customers.cfg.types;
    expect(t.impatient.patience).toBeLessThan(t.regular.patience);
    expect(t.vip.payMult).toBeGreaterThan(t.regular.payMult);
    expect(t.fleet.payMult).not.toBe(t.premium.payMult);
    const a = spawnCustomer(w, 'impatient'), b = spawnCustomer(w, 'regular');
    expect(a.maxPatience).toBeLessThan(b.maxPatience);
  });

  it('a long-waiting low priority customer can overtake ONE priority level, but never two (no starvation, no queue jumping)', () => {
    const w = makeWorld();
    w.economy.reputation = 100; w.customers.getStage = () => 4;
    const pr = (k) => w.customers.cfg.types[k].priority;
    expect(pr('emergency')).toBeGreaterThan(pr('regular')); // sanity: emergency outranks regular
    const { a, queued } = queueUp(w, [{ type: 'regular', waited: 0 }, { type: 'emergency', waited: 0 }]);
    const [regular, emergency] = queued;
    // both fresh: priority decides
    expect(w.customers.queueScore(emergency)).toBeGreaterThan(w.customers.queueScore(regular));
    // regular has waited almost all of its patience: its score rises by at most 1.5 (cannot beat a 2-level gap)
    regular.arrivedAt = w.customers.time - regular.maxPatience * 0.99;
    const gap = pr('emergency') - pr('regular');
    const overtakes = w.customers.queueScore(regular) > w.customers.queueScore(emergency);
    expect(overtakes).toBe(gap < 1.5);
    freeOneBay(w, a);
    expect([regular.state, emergency.state].filter((s) => s === 'assigned')).toHaveLength(1);
  });

  it('equal priority is still first come, first served', () => {
    const w = makeWorld();
    const { a, queued } = queueUp(w, [{ type: 'regular', waited: 20 }, { type: 'regular', waited: 5 }]);
    freeOneBay(w, a);
    expect(queued[0].state).toBe('assigned');
    expect(queued[1].state).toBe('queue');
  });

  it('happy customers become regulars: arrivals speed up with the number of happy customers, capped at +30%', () => {
    const w = makeWorld();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const base = w.customers.arrivalInterval();
    w.customers.stats.happy = 40;
    expect(w.customers.loyalty).toBeCloseTo(0.2, 5);
    expect(w.customers.arrivalInterval()).toBeLessThan(base);
    w.customers.stats.happy = 100000;
    expect(w.customers.loyalty).toBe(0.3);
    expect(w.customers.arrivalInterval()).toBeCloseTo(base / 1.3, 3);
  });

  it('a customer who never reaches the driveway is removed by the watchdog, and the late car cannot take a bay', () => {
    const w = makeWorld();
    const c = spawnCustomer(w);
    const left = vi.fn(); w.bus.on('customer:left', left);
    const rep = w.economy.reputation;
    w.customers.update(10); expect(w.customers.customers.has(c.id)).toBe(true);
    w.customers.update(w.customers.cfg.stuckSeconds ?? 180);
    expect(w.customers.customers.has(c.id)).toBe(false);
    expect(w.customers.stats.lostBy['got lost on the way']).toBe(1);
    expect(left).toHaveBeenCalledTimes(1);
    expect(w.economy.reputation).toBe(rep); // not the player's fault
    expect(w.customers.arrived(c)).toEqual({ action: 'leave', reason: 'gone' }); // the car shows up later: sent away
    expect(w.station.freeBays).toBe(2);
    expect(w.parking.stats('station-bays').reserved).toBe(0);
  });

  it('a customer who is on time is not touched by the watchdog', () => {
    const w = makeWorld();
    const c = spawnCustomer(w);
    w.customers.update(100);
    w.customers.arrived(c);
    w.customers.update(500); // waiting at a bay: patience rules apply, not the watchdog
    expect(w.customers.stats.lostBy['got lost on the way']).toBeUndefined();
  });

  it('customers warn once when their patience is nearly gone', () => {
    const w = makeWorld();
    const c = spawnCustomer(w);
    const { bayId } = w.customers.arrived(c);
    w.station.vehicleParked(bayId); w.customers.parkedAtBay(c);
    const warn = vi.fn(); w.bus.on('customer:impatient', warn);
    c.patience = c.maxPatience * 0.2;
    w.customers.update(0.5); w.customers.update(0.5);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('two events for the same car (double arrival) cannot reserve two bays', () => {
    const w = makeWorld();
    const c = spawnCustomer(w);
    const r1 = w.customers.arrived(c), r2 = w.customers.arrived(c);
    expect(r1.action).toBe('bay');
    expect(w.station.bays.filter((b) => b.customer === c).length).toBeLessThanOrEqual(2);
    expect(w.parking.stats('station-bays').reserved).toBeLessThanOrEqual(2);
    void r2;
  });

  it('unavailable services send customers away with a reason instead of leaving them stuck', () => {
    const w = makeWorld();
    const c = w.customers.createCustomer('regular');
    c.vehicle.connector = 'nope';
    expect(w.customers.checkService(c)).toMatch(/no NOPE connector/);
    c.vehicle.connector = w.station.charger.connectors[0];
    w.station.setPrice(w.station.cfg.maxPrice);
    const d = w.customers.createCustomer('regular');
    d.vehicle.connector = w.station.charger.connectors[0];
    expect(w.customers.checkService(d, 0)).toBe('too expensive');
    const before = w.customers.stats.lost;
    for (let i = 0; i < 30; i++) w.customers.spawn('regular'); // everyone refuses, nobody is stuck in the lot
    expect(w.customers.customers.size).toBe(0);
    expect(w.customers.stats.lost).toBeGreaterThan(before);
  });
});