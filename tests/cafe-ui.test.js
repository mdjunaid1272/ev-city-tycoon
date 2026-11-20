// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeUI } from './ui-helpers.js';
import { data } from './helpers.js';
import { Cafe } from '../src/businesses/Cafe.js';
import { TaskManager } from '../src/employees/TaskManager.js';

let ui, w, cafe;
const card = () => document.getElementById('modal-card');
const click = (sel) => { const b = card().querySelector(sel); if (!b) throw new Error(`no button ${sel}`); b.click(); };
const text = () => card().textContent;
const open = (tab) => { ui.tab.cafe = tab; ui.modal = 'cafe'; ui._modalHtml = null; ui.renderModal(); };

beforeEach(() => {
  vi.useFakeTimers();
  ({ ui, w } = makeUI());
  w.economy.cash = 20000;
  cafe = new Cafe({ bus: w.bus, economy: w.economy, cfg: data('cafe'), hub: { built: { coffee: true } }, tasks: new TaskManager(w.bus) });
  cafe.spawnTimer = 1e12;
  ui.cafe = cafe;
  ui.employees = { employees: [], cfg: { roles: {} } };
  ui.hubs = {};
  ui.guard = (cost, what, fn) => fn(); // purchases above the confirm threshold are covered in the UI tests
});
afterEach(() => vi.useRealTimers());

describe('café board', () => {
  it('shows how to open the café while it does not exist', () => {
    cafe.hub.built.coffee = false;
    open('overview');
    expect(text()).toMatch(/opens with the Coffee Shop/);
    expect(card().querySelector('[data-open-biz="upgrades"]')).toBeTruthy();
  });

  it.each(['overview', 'menu', 'stock', 'upgrades', 'stats'])('the %s tab renders real numbers', (tab) => {
    open(tab);
    expect(card().querySelector('h2').textContent).toMatch(/Caf/);
    expect(text().length).toBeGreaterThan(80);
    expect(text()).not.toMatch(/undefined|NaN|\[object/);
  });

  it('the overview lists waiting orders with their state and offers to prepare the next one', () => {
    const c = { id: 'k1', kind: 'walkin', type: 'commuter', def: { label: 'Commuter', spend: 1 }, patience: 30, maxPatience: 30, state: 'arriving' };
    cafe.placeOrder(c, 'espresso'); cafe.customers.set(c.id, c);
    open('overview');
    expect(text()).toMatch(/Espresso/);
    expect(text()).toMatch(/Waiting/);
    expect(card().querySelector('[data-cafe="prep"]').disabled).toBe(false);
    click('[data-cafe="prep"]');
    expect(cafe.orders[0].state).toBe('preparing');
    expect(card().querySelector('[data-cafe="prep"]').disabled).toBe(true);
    expect(text()).toMatch(/Preparing/);
  });

  it('warns about sold-out products', () => {
    cafe.stock.beans = 0;
    open('overview');
    expect(card().querySelector('.sel-why').textContent).toMatch(/Sold out/);
    expect(card().querySelector('.sel-why').textContent).toMatch(/Coffee beans/);
  });
});

describe('café board: every control does something', () => {
  it('price steppers change the price by 0.25 and the margin line follows', () => {
    open('menu');
    const before = cafe.prices.espresso;
    click('[data-cafe="price:espresso:+"]');
    expect(cafe.prices.espresso).toBeCloseTo(before + 0.25, 2);
    expect(text()).toMatch(/\$3\.75/);
    click('[data-cafe="price:espresso:-"]'); click('[data-cafe="price:espresso:-"]');
    expect(cafe.prices.espresso).toBeCloseTo(before - 0.25, 2);
  });

  it('the menu toggle takes a product off and on', () => {
    open('menu');
    click('[data-cafe="toggle:croissant"]');
    expect(cafe.enabled.croissant).toBe(false);
    expect(text()).toMatch(/Off the menu/);
    click('[data-cafe="toggle:croissant"]');
    expect(cafe.enabled.croissant).toBe(true);
  });

  it('locked products say which upgrade unlocks them', () => {
    cafe.levels.menu = 0;
    open('menu');
    expect(text()).toMatch(/Menu level 1/);
    expect(card().querySelector('[data-cafe="toggle:latte"]')).toBeNull();
  });

  it('stock buttons buy ingredients with real money; Fill buys what you can afford; nothing happens when the storage is full', () => {
    cafe.stock.milk = 0;
    open('stock');
    const cash = w.economy.cash;
    click('[data-cafe="buy:milk:10"]');
    expect(cafe.stock.milk).toBe(10);
    expect(w.economy.cash).toBeCloseTo(cash - 4.5, 2);
    w.economy.cash = 9; // only 20 milk affordable (0.45 each)
    click('[data-cafe="buy:milk:max"]');
    expect(cafe.stock.milk).toBe(30);
    expect(w.economy.cash).toBeCloseTo(0, 2);
    cafe.stock.beans = cafe.cap('beans');
    open('stock');
    expect(card().querySelector('[data-cafe="buy:beans:10"]').disabled).toBe(true);
  });

  it('auto-restock toggles and its label follows', () => {
    open('stock');
    expect(text()).toMatch(/OFF/);
    click('[data-cafe="auto"]');
    expect(cafe.autoRestock).toBe(true);
    expect(text()).toMatch(/ON/);
  });

  it('upgrade buttons buy upgrades; the effect text shows the real before / after numbers; unaffordable ones say why', () => {
    cafe.levels.menu = 0;
    open('upgrades');
    expect(text()).toMatch(/Preparation time x1\.00 → x0\.80/);
    expect(text()).toMatch(/Seats 4 → 6/);
    expect(text()).toMatch(/Unlocks: Latte, Sandwich/);
    const cash = w.economy.cash;
    click('[data-cafe="up:machine"]');
    expect(cafe.levels.machine).toBe(1);
    expect(w.economy.cash).toBe(cash - 2500);
    expect(text()).toMatch(/x0\.80 → x0\.65/);
    w.economy.cash = 5;
    open('upgrades');
    expect(card().querySelector('[data-cafe="up:seating"]').disabled).toBe(true);
    expect(text()).toMatch(/Not enough cash/);
  });

  it('a maxed upgrade shows Max instead of a button', () => {
    cafe.levels.machine = 3;
    open('upgrades');
    expect(card().querySelector('[data-cafe="up:machine"]')).toBeNull();
    expect(text()).toMatch(/Fully upgraded/);
  });

  it('no dead buttons: every button on every tab has a handler or is a tab / link to another board', () => {
    for (const tab of ['overview', 'menu', 'stock', 'upgrades', 'stats']) {
      open(tab);
      for (const b of card().querySelectorAll('button')) {
        if (b.disabled) continue;
        const wired = typeof b.onclick === 'function' || b.hasAttribute('data-close');
        expect(wired, `${tab}: <${b.outerHTML.slice(0, 90)}>`).toBe(true);
      }
    }
  });

  it('failed actions explain themselves with a notification', () => {
    cafe.stock.beans = cafe.cap('beans');
    open('stock');
    ui.cafeAction('buy:beans:10');
    expect(document.getElementById('toasts').textContent).toMatch(/Storage is full/);
  });
});

describe('café notifications and business list', () => {
  it('a stock shortage raises a visible warning', () => {
    ui.bindEvents; // handlers were bound by makeUI
    w.bus.emit('cafe:shortage', { ingredient: 'milk', label: 'Milk' });
    expect(document.getElementById('toasts').textContent).toMatch(/out of Milk/);
  });

  it('the Business overview lists the café once it is open, with a Manage button', () => {
    ui.tab.business = 'overview';
    ui.hubs = {}; ui.wash = { built: false, cfg: { icon: 'w', label: 'Wash', buildCost: 1, minRep: 0 }, canBuild: () => ({ ok: false, reason: 'x' }) };
    ui.garage = ui.wash;
    const html = ui.tplBusiness();
    expect(html).toMatch(/data-open-biz="cafe"/);
    cafe.hub.built.coffee = false;
    expect(ui.tplBusiness()).not.toMatch(/data-open-biz="cafe"/);
  });

  it('open("cafe:stock") opens the café board on that tab', () => {
    ui.renderModal = vi.fn();
    ui.open('cafe:stock');
    expect(ui.modal).toBe('cafe');
    expect(ui.tab.cafe).toBe('stock');
  });
});
