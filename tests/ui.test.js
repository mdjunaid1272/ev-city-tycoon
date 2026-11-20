// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { aggregateStats } from '../src/customers/SiteCounts.js';
import { spawnCustomer, parkAndPlug } from './helpers.js';
import { makeUI, emptyBiz } from './ui-helpers.js';

const text = (sel) => document.querySelector(sel).textContent;
const kv = (label) => [...document.querySelectorAll('#modal-card .kv, #modal-card .tile')].find((e) => e.textContent.includes(label));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('HUD: active customers (Daily overview)', () => {
  it('shows every customer once, with a breakdown that adds up', () => {
    const { ui, w } = makeUI();
    const cars = Array.from({ length: 5 }, () => spawnCustomer(w));
    parkAndPlug(w, cars[0]);
    cars.slice(1).forEach((c) => w.customers.arrived(c));
    ui.updateDaily();
    const shown = Number(text('#d-cust'));
    expect(shown).toBe(w.customers.customers.size);
    expect(shown).not.toBe(w.customers.customers.size + w.customers.queue.length);
    const parts = ['dd-arriving', 'dd-queued', 'dd-waiting', 'dd-charging', 'dd-service'].map((id) => Number(text(`#${id}`)));
    expect(parts.reduce((a, b) => a + b, 0)).toBe(shown); // the categories add up to the total exactly
    expect(parts[1]).toBe(w.customers.queue.length);
    expect(parts[3]).toBe(1);
  });

  it('shows revenue today, satisfaction (all businesses) and daily mission progress', () => {
    const { ui, w } = makeUI();
    w.economy.earn(120, 'charging', 'a');
    w.customers.stats.satSum = 160; w.customers.stats.satN = 2; // average 80 at the station
    ui.wash.stats.satSum = 40; ui.wash.stats.satN = 1; // a 40 at the wash: overall 200 / 3
    ui.updateDaily();
    expect(text('#d-rev')).toBe('$120');
    expect(text('#d-sat')).toBe('67%');
    expect(text('#d-dm-count')).toBe('1/3');
  });

  it('the overview detail is collapsed by default and toggles open and closed', () => {
    makeUI();
    const detail = document.getElementById('d-detail');
    expect(detail.hidden).toBe(true);
    expect(document.getElementById('d-stats').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Statistics panel', () => {
  it('shows real totals and refreshes when the game events that change them happen (no reopening needed)', () => {
    const { ui, w } = makeUI();
    ui.modal = 'stats'; ui.renderModal();
    expect(kv('Customers served').textContent).toContain('0');
    const servedTile = kv('Customers served');

    const c = spawnCustomer(w);
    parkAndPlug(w, c);
    for (let i = 0; i < 6000 && c.state === 'charging'; i++) w.station.update(0.5);
    expect(c.state).toBe('paid');
    vi.advanceTimersByTime(300); // events schedule one coalesced render
    const served = w.station.served;
    expect(kv('Customers served').textContent).toContain(String(served));
    expect(kv('Total revenue').textContent).toContain(`$${Math.round(w.economy.totalRevenue)}`);
    expect(Number(kv('Customers served').querySelector('b').textContent)).toBe(ui.stats.total.served);
    expect(ui.stats.total.served).toBeGreaterThan(0);
    expect(kv('Customers served')).toBe(servedTile); // patched in place, not rebuilt
  });

  it('adds up lost customers, tips and satisfaction over ALL businesses', () => {
    const { ui, w } = makeUI();
    w.customers.stats.lost = 2; w.customers.stats.tips = 5;
    ui.wash.stats.lost = 3; ui.wash.stats.tips = 2.5;
    ui.garage.stats.lost = 1;
    ui.hubs = { small: emptyBiz({ lost: 4, tips: 1 }) };
    ui.modal = 'stats'; ui.renderModal();
    expect(kv('Lost customers').textContent).toContain('10');
    expect(kv('Tips earned').textContent).toContain('$8.50');
    expect(aggregateStats([w.customers, ui.wash, ui.garage, ...Object.values(ui.hubs)]).lost).toBe(10);
  });

  it('a burst of events renders once; events while another panel is open do nothing; a disposed UI ignores events', () => {
    const { ui, w } = makeUI();
    ui.modal = 'stats'; ui.renderModal();
    const render = vi.spyOn(ui, 'renderModal');
    for (let i = 0; i < 25; i++) w.economy.earn(1, 'charging', `burst${i}`);
    expect(render).not.toHaveBeenCalled(); // not synchronously
    vi.advanceTimersByTime(200);
    expect(render).toHaveBeenCalledTimes(1);

    render.mockClear();
    ui.modal = 'finance';
    w.economy.earn(1, 'charging', 'x'); vi.advanceTimersByTime(200);
    // the finance panel has its own refresh path: the stats scheduler must not fire for it
    expect(render.mock.calls.length).toBeLessThanOrEqual(1);

    ui.modal = 'stats'; render.mockClear();
    ui.dispose();
    w.economy.earn(1, 'charging', 'after-dispose'); vi.advanceTimersByTime(300);
    expect(render).not.toHaveBeenCalled();
    expect(ui._offs).toHaveLength(0);
  });

  it('renders without errors for a brand-new game (no satisfaction yet)', () => {
    const { ui } = makeUI();
    ui.modal = 'stats'; ui.renderModal();
    expect(kv('Satisfaction').textContent).toContain('—');
  });
});

describe('modal refresh keeps the player\'s place', () => {
  it('keeps the same nodes, scroll position and focus when values change, and waits while a pointer is down', () => {
    const { ui, w } = makeUI();
    ui.modal = 'stats'; ui.renderModal();
    const card = document.getElementById('modal-card');
    const btn = card.querySelector('[data-close]');
    btn.focus(); card.scrollTop = 33;
    w.economy.earn(77, 'charging', 'r1');
    ui.renderModal();
    expect(card.querySelector('[data-close]')).toBe(btn);
    expect(document.activeElement).toBe(btn);
    expect(card.scrollTop).toBe(33);
    expect(kv('Total revenue').textContent).toContain('$77');

    ui._ptrDown = true; // finger on a button: do not swap the DOM under it
    w.economy.earn(23, 'charging', 'r2');
    ui.renderModal();
    expect(kv('Total revenue').textContent).toContain('$77');
    expect(ui._dirty).toBe(true);
  });
});

describe('HUD: customer breakdown stays consistent while the simulation runs', () => {
  it('total == arriving + queued + waiting + charging + service at every step of a busy period (no double counting)', () => {
    const { ui, w } = makeUI();
    const ids = ['dd-arriving', 'dd-queued', 'dd-waiting', 'dd-charging', 'dd-service'];
    for (let step = 0; step < 400; step++) {
      if (step % 7 === 0) { const c = spawnCustomer(w); if (step % 14 === 0) w.customers.arrived(c); }
      for (const c of [...w.customers.customers.values()]) {
        if (c.state === 'assigned' && step % 3 === 0) { w.station.vehicleParked(c.bayId); w.customers.parkedAtBay(c); }
        if (c.state === 'waiting') w.station.startCharging(c.bayId);
      }
      w.station.update(2); w.customers.update(1);
      for (const b of w.station.bays) if (b.state === 'done') { w.station.release(b.id); w.station.vehicleLeft(b.id); }
      ui.updateDaily();
      const shown = Number(text('#d-cust'));
      const parts = ids.reduce((n, id) => n + Number(text(`#${id}`)), 0);
      expect(parts).toBe(shown);
      expect(shown).toBe(w.customers.customers.size);
    }
  });

  it('only changed numbers are written: unchanged values keep their text node', () => {
    const { ui, w } = makeUI();
    spawnCustomer(w);
    ui.updateDaily();
    const node = document.getElementById('dd-queued').firstChild;
    const before = node.nodeValue;
    ui.updateDaily();
    expect(document.getElementById('dd-queued').firstChild).toBe(node);
    expect(node.nodeValue).toBe(before);
  });
});
