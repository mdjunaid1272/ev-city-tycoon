import { describe, it, expect } from 'vitest';
import { siteCounts } from '../src/customers/SiteCounts.js';
import { makeWorld, spawnCustomer, parkAndPlug } from './helpers.js';

const biz = (customers, bays = []) => ({ customers: new Map(customers.map((c) => [c.id, c])), bays });

describe('active customer counting (HUD)', () => {
  it('counts each customer once: queued customers are NOT added on top of the customer map', () => {
    const w = makeWorld();
    // fill both bays, then three more cars arrive: they queue
    const cars = Array.from({ length: 5 }, () => spawnCustomer(w));
    const results = cars.map((c) => w.customers.arrived(c).action);
    expect(results.filter((a) => a === 'bay')).toHaveLength(2);
    expect(w.customers.queue.length).toBeGreaterThan(0);
    // the queue is a view onto the same customers
    for (const q of w.customers.queue) expect(w.customers.customers.has(q.id)).toBe(true);

    const counts = siteCounts([w.customers]);
    const accepted = w.customers.customers.size; // customers turned away at the door are removed from the map
    expect(counts.onSite).toBe(accepted);
    expect(counts.onSite).not.toBe(accepted + w.customers.queue.length); // what the old HUD formula showed
    expect(counts.queued).toBe(w.customers.queue.length);
  });

  it('breaks the total down into queued / waiting / charging / service / arriving without overlap', () => {
    const w = makeWorld();
    const a = spawnCustomer(w), b = spawnCustomer(w), c = spawnCustomer(w), d = spawnCustomer(w);
    parkAndPlug(w, a); // charging
    w.customers.arrived(b); w.station.vehicleParked(b.bayId); w.customers.parkedAtBay(b); // waiting at a bay
    w.customers.arrived(c); // third car: queue (both bays taken)
    // d has not arrived yet
    const n = siteCounts([w.customers]);
    expect(n.charging).toBe(1);
    expect(n.waiting).toBe(1);
    expect(n.queued).toBe(1);
    expect(n.arriving).toBe(1);
    expect(n.charging + n.waiting + n.queued + n.service + n.arriving).toBe(n.onSite);
    expect(n.onSite).toBe(4);
    void d;
  });

  it('never counts the same customer twice across businesses', () => {
    const shared = { id: 'c1', state: 'charging' };
    const n = siteCounts([biz([shared]), biz([shared, { id: 's2', state: 'queue' }])]);
    expect(n.onSite).toBe(2);
  });

  it('counts wash / garage jobs as service and hub chargers as charging', () => {
    const wash = biz([{ id: 's1', state: 'waiting', bayId: 0 }, { id: 's2', state: 'waiting', bayId: 1 }], [{ state: 'working' }, { state: 'waiting' }]);
    const hub = biz([{ id: 's3', state: 'waiting', bayId: 0 }], [{ state: 'charging' }]);
    const n = siteCounts([wash, hub]);
    expect(n).toMatchObject({ onSite: 3, service: 1, waiting: 1, charging: 1 });
  });

  it('ignores missing businesses and empty registries', () => {
    expect(siteCounts([null, undefined, {}, biz([])]).onSite).toBe(0);
  });
});
