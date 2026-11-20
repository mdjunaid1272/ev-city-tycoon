// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { SaveManager, SAVE_VERSION } from '../src/core/SaveManager.js';
import { MissionManager } from '../src/progression/MissionManager.js';
import { StatsTracker } from '../src/progression/StatsTracker.js';
import { EconomyManager } from '../src/economy/EconomyManager.js';
import { makeWorld, spawnCustomer, parkAndPlug } from './helpers.js';

beforeEach(() => localStorage.clear());

describe('SaveManager', () => {
  it('migrate() accepts a valid save and rejects garbage and saves from a newer build', () => {
    const s = new SaveManager();
    expect(s.migrate({ version: SAVE_VERSION, savedAt: 5, data: { a: 1 } })).toEqual({ a: 1, savedAt: 5 });
    for (const bad of [null, undefined, 'x', 42, {}, { version: 'one', data: {} }, { version: SAVE_VERSION }, { version: SAVE_VERSION + 1, data: { a: 1 } }]) {
      expect(s.migrate(bad)).toBeNull();
    }
  });

  it('saves and loads through the localStorage fallback when IndexedDB is unavailable', async () => {
    const s = new SaveManager();
    await s.save({ economy: { cash: 321 } });
    const back = await s.load();
    expect(back.economy.cash).toBe(321);
    await s.clear();
    expect(await s.load()).toBeNull();
  });

  it('a corrupt stored save loads as "no save" instead of crashing', async () => {
    localStorage.setItem('evct.save.main', '{not json');
    expect(await new SaveManager().load()).toBeNull();
  });
});

describe('game state survives save + load', () => {
  it('economy, station and customer stats round-trip through JSON', () => {
    const w = makeWorld({ cash: 1e6 });
    w.station.buyBay(2); w.station.setPrice(0.61); w.station.upgradeChargers();
    const c = spawnCustomer(w); parkAndPlug(w, c);
    for (let i = 0; i < 6000 && c.state === 'charging'; i++) w.station.update(0.5);
    const saved = JSON.parse(JSON.stringify({ economy: w.economy.serialize(), station: w.station.serialize(), customers: w.customers.serialize() }));
    const w2 = makeWorld({ saved });
    expect(w2.economy.cash).toBe(w.economy.cash);
    expect(w2.economy.totalRevenue).toBe(w.economy.totalRevenue);
    expect(w2.station.unlockedCount).toBe(3);
    expect(w2.station.pricePerKwh).toBe(0.61);
    expect(w2.station.chargerLevel).toBe(w.station.chargerLevel);
    expect(w2.station.served).toBe(w.station.served);
    expect(w2.customers.stats.served).toBe(w.customers.stats.served);
  });

  it('lifetime statistics round-trip', () => {
    const bus = new EventBus();
    const a = new StatsTracker(bus);
    bus.emit('customer:paid', { customer: { type: 'vip' }, satisfaction: 95 });
    bus.emit('employee:hired', {});
    const b = new StatsTracker(new EventBus(), JSON.parse(JSON.stringify(a.serialize())));
    expect(b.total.served).toBe(1); expect(b.total.vipServed).toBe(1); expect(b.total.hired).toBe(1);
  });

  it('missions: progress is restored and a corrupt save is clamped to something valid', () => {
    const econ = new EconomyManager(new EventBus(), { cash: 0 });
    const m = new MissionManager(new EventBus(), econ);
    m.restore({ index: 2, progress: 4 });
    expect(m.serialize()).toEqual({ index: 2, progress: 4 });
    m.restore({ index: -50, progress: -3 });
    expect(m.serialize()).toEqual({ index: 0, progress: 0 });
    m.restore({ index: 9999, progress: 'x' });
    expect(m.current).toBeNull(); // past the last mission: "all done", no crash
    expect(() => m.snapshot()).not.toThrow();
    m.restore(null); // no data: unchanged
  });

  it('the staff-count mission counts staff hired before it appeared', () => {
    const bus = new EventBus();
    const econ = new EconomyManager(bus, { cash: 0 });
    const m = new MissionManager(bus, econ);
    m.have = { employees: () => 1 };
    m.index = 1; // "Hire your first employee"
    m.syncCurrent();
    expect(m.index).toBe(2); // completed immediately because someone is already on the team
    expect(econ.cash).toBeGreaterThan(0);
  });
});
