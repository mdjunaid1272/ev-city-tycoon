import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { EconomyManager } from '../src/economy/EconomyManager.js';
import { PropertyManager } from '../src/businesses/PropertyManager.js';

/** A fake business with the same surface PropertyManager uses. */
function fakeBiz(id, buildCost, { minRep = 0 } = {}) {
  const biz = {
    id, built: false, unlockedBays: 1,
    cfg: { label: `Biz ${id}`, icon: 'x', buildCost, stage: 2, upkeepPerBayPerDay: 10 },
    hub: null,
    canBuild: (rep) => (rep >= minRep ? { ok: true } : { ok: false, reason: `Needs reputation ${minRep}` }),
    build: vi.fn(() => { biz.built = true; biz.bus.emit('svc:built', { biz: id }); return { ok: true }; }),
  };
  return biz;
}

function setup({ cash = 100000, rep = 0, unlocked = ['downtown'] } = {}) {
  const bus = new EventBus();
  const economy = new EconomyManager(bus, { cash, gems: 0, reputation: rep });
  const wash = fakeBiz('wash', 15000), garage = fakeBiz('garage', 30000, { minRep: 20 });
  wash.bus = garage.bus = bus;
  const districts = {
    cfg: { downtown: { name: 'Downtown' }, industrial: { name: 'Industrial' } },
    isUnlocked: (d) => unlocked.includes(d),
    lock: (d) => (unlocked.includes(d) ? null : 'Locked'),
  };
  const cfg = [
    { id: 'wash', kind: 'service', district: 'downtown', ix: 1, iz: 0 },
    { id: 'garage', kind: 'service', district: 'industrial', ix: 2, iz: 0 },
  ];
  const props = new PropertyManager({ bus, economy, cfg, hubs: {}, wash, garage, districts, getStage: () => 4 });
  return { bus, economy, props, wash, garage, unlocked };
}

describe('property purchases', () => {
  it('buys an available property: builds it once and announces it', () => {
    const w = setup();
    const events = [];
    w.bus.on('property:bought', (e) => events.push(e.id));
    w.bus.on('property:changed', () => events.push('changed'));
    expect(w.props.buy('wash')).toEqual({ ok: true });
    expect(w.wash.build).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['wash', 'changed']);
    expect(w.props.ownedCount).toBe(1);
  });

  it('refuses a second purchase of the same property', () => {
    const w = setup();
    w.props.buy('wash');
    expect(w.props.buy('wash')).toEqual({ ok: false, reason: 'Already owned' });
    expect(w.wash.build).toHaveBeenCalledTimes(1);
  });

  it('refuses when the district permit is missing and explains why, without taking money', () => {
    const w = setup({ cash: 1e6 });
    const r = w.props.buy('garage');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Industrial/);
    expect(w.garage.build).not.toHaveBeenCalled();
    expect(w.economy.cash).toBe(1e6);
  });

  it('refuses when reputation is too low even if the district is unlocked', () => {
    const w = setup({ unlocked: ['downtown', 'industrial'], rep: 5 });
    const r = w.props.buy('garage');
    expect(r).toEqual({ ok: false, reason: 'Needs reputation 20' });
    w.economy.reputation = 20;
    expect(w.props.buy('garage').ok).toBe(true);
  });

  it('refuses when the player cannot afford it', () => {
    const w = setup({ cash: 1000 });
    expect(w.props.buy('wash')).toEqual({ ok: false, reason: 'Not enough cash' });
    expect(w.wash.build).not.toHaveBeenCalled();
    expect(w.props.get('wash')).toBeTruthy();
    expect(w.props.info(w.props.get('wash')).canBuy).toBe(false);
  });

  it('unknown property ids are rejected', () => {
    expect(setup().props.buy('moon-base')).toEqual({ ok: false, reason: 'Unknown property' });
  });

  it('owned lots pay a daily property tax booked as an expense', () => {
    const w = setup();
    expect(w.props.dailyCosts()).toBe(0);
    w.props.buy('wash');
    const tax = w.props.dailyCosts();
    expect(tax).toBe(Math.round(15000 * 0.0015 * 100) / 100);
    expect(w.economy.ledger.expenses.property).toBe(tax);
  });

  it('list() reports status per property: available / locked / owned', () => {
    const w = setup();
    w.props.buy('wash');
    const s = Object.fromEntries(w.props.list().map((p) => [p.id, p.status]));
    expect(s).toEqual({ wash: 'owned', garage: 'locked' });
  });
});
