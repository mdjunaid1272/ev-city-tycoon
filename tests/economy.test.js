import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { EconomyManager } from '../src/economy/EconomyManager.js';

const make = (cash = 1000) => new EconomyManager(new EventBus(), { cash, gems: 5 });

describe('EconomyManager: revenue and ledger', () => {
  it('books revenue into cash, lifetime revenue and the daily ledger by source', () => {
    const e = make(100);
    expect(e.earn(25.5, 'charging', 'tx1')).toBe(true);
    expect(e.earn(10, 'tips', 'tx2')).toBe(true);
    expect(e.cash).toBe(135.5);
    expect(e.totalRevenue).toBe(35.5);
    expect(e.ledger.revenue).toEqual({ charging: 25.5, tips: 10 });
    expect(e.todayRevenue).toBe(35.5);
  });

  it('never pays the same transaction twice (duplicate payments)', () => {
    const e = make(0);
    expect(e.earn(40, 'charging', 'charge:v1')).toBe(true);
    expect(e.earn(40, 'charging', 'charge:v1')).toBe(false);
    expect(e.cash).toBe(40);
    expect(e.ledger.revenue.charging).toBe(40);
  });

  it.each([0, -5, NaN, Infinity, '12', null, undefined])('rejects the invalid amount %s', (bad) => {
    const e = make(50);
    expect(e.earn(bad, 'charging')).toBe(false);
    expect(e.cash).toBe(50);
    expect(e.todayRevenue).toBe(0);
  });

  it('spend fails without enough cash and changes nothing', () => {
    const e = make(99);
    expect(e.spend(100, 'equipment')).toBe(false);
    expect(e.cash).toBe(99);
    expect(e.ledger.expenses).toEqual({});
    expect(e.spend(99, 'equipment')).toBe(true);
    expect(e.cash).toBe(0);
    expect(e.ledger.expenses.equipment).toBe(99);
  });

  it('expenses that must be paid (electricity) never push cash below zero', () => {
    const e = make(5);
    e.expense(20, 'electricity');
    expect(e.cash).toBe(0);
    expect(e.ledger.expenses.electricity).toBe(20);
  });

  it('rounds money to cents so repeated tiny payments do not drift', () => {
    const e = make(0);
    for (let i = 0; i < 1000; i++) e.earn(0.01, 'charging');
    expect(e.cash).toBe(10);
  });

  it('reputation never goes below zero', () => {
    const e = make();
    e.changeReputation(3);
    e.changeReputation(-10);
    expect(e.reputation).toBe(0);
  });

  it('survives a save/restore round trip', () => {
    const e = make(500);
    e.earn(60, 'charging', 'a'); e.spend(100, 'equipment');
    const copy = new EconomyManager(new EventBus(), e.serialize());
    expect(copy.cash).toBe(e.cash);
    expect(copy.totalRevenue).toBe(e.totalRevenue);
    expect(copy.ledger).toEqual(e.ledger);
  });
});
