// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeUI } from './ui-helpers.js';
import { data } from './helpers.js';
import { TaskManager } from '../src/employees/TaskManager.js';
import { EmployeeManager } from '../src/employees/EmployeeManager.js';
import { NavGrid } from '../src/employees/NavGrid.js';

let ui, w, mgr, tasks;
const card = () => document.getElementById('modal-card');
const open = () => { ui.modal = 'staff'; ui._modalHtml = null; ui.renderModal(); };
const hire = (role = 'attendant', skill = 2) => { const c = mgr.makeCandidate(); c.role = role; c.skill = skill; c.cost = mgr.hireCost(skill); mgr.candidates.push(c); return mgr.hire(c.id); };

beforeEach(() => {
  vi.useFakeTimers();
  ({ ui, w } = makeUI());
  w.economy.cash = 100000;
  tasks = new TaskManager(w.bus);
  mgr = new EmployeeManager({ bus: w.bus, economy: w.economy, tasks, config: data('employees'), getReputation: () => 0, getCapacity: () => 6 });
  const fac = (label, x) => ({ nav: new NavGrid(), posts: [{ x, z: 3 }, { x: x + 1, z: 3 }], door: { x: -14, z: -11.4 }, breakSpot: { x: -16, z: -10 }, built: () => true, label });
  mgr.registerFacility('charging', fac('Charging Station', 0));
  mgr.registerFacility('hub_x', fac('Hub X', 5));
  ui.employees = mgr;
  ui.hubs = {};
});
afterEach(() => vi.useRealTimers());

describe('Staff board', () => {
  it('shows workload per department, payroll, training and each employee\'s real status', () => {
    hire(); hire();
    open();
    const t = card().textContent;
    expect(t).toMatch(/Workload/);
    expect(t).toMatch(/Charging Station/);
    expect(t).toMatch(/Hub X/);
    expect(t).toMatch(/2 staff/);
    expect(t).toMatch(/\/day/);
    expect(t).toMatch(/Team training program/);
    expect(t).toMatch(/Starting shift/); // what they are doing, in words
    expect(t).not.toMatch(/undefined|NaN/);
  });

  it('flags a department with open work and nobody to do it', () => {
    hire();
    tasks.publish({ key: 'j1', type: 'connect', dept: 'hub_x', priority: 1, pos: { x: 5, z: 5 }, base: 1, valid: () => true, run() {} });
    open();
    expect(card().textContent).toMatch(/No staff/);
  });

  it('the training button buys the upgrade with cash and the board shows the new level and bonus', () => {
    open();
    const cash = w.economy.cash;
    card().querySelector('[data-emp-act="efficiency"]').click();
    expect(mgr.efficiencyLevel).toBe(1);
    expect(w.economy.cash).toBe(cash - 3000);
    expect(card().textContent).toMatch(/1\/3 · \+5% team speed/);
  });

  it('training is disabled with an explanation when the cash is missing, and gone when fully trained', () => {
    w.economy.cash = 10;
    open();
    expect(card().querySelector('[data-emp-act="efficiency"]').disabled).toBe(true);
    expect(card().textContent).toMatch(/Not enough cash/);
    mgr.efficiencyLevel = 3;
    open();
    expect(card().querySelector('[data-emp-act="efficiency"]')).toBeNull();
    expect(card().textContent).toMatch(/fully trained/i);
  });

  it('"Balance the team" moves idle staff to where the work is and says what it did', () => {
    hire(); hire();
    for (let i = 0; i < 300; i++) mgr.update(0.1);
    for (let i = 0; i < 6; i++) tasks.publish({ key: `h${i}`, type: 'connect', dept: 'hub_x', priority: 1, pos: { x: 5, z: 5 }, base: 1, valid: () => true, run() {} });
    open();
    card().querySelector('[data-emp-act="balance"]').click();
    expect(mgr.employees.some((e) => mgr.homeOf(e) === 'hub_x')).toBe(true);
    expect(document.getElementById('toasts').textContent).toMatch(/Moved \d employee/);
    open();
    card().querySelector('[data-emp-act="balance"]').click();
    expect(document.getElementById('toasts').textContent).toMatch(/already balanced|Moved/);
  });

  it('no dead buttons on the Staff board', () => {
    hire(); hire();
    open();
    for (const b of card().querySelectorAll('button')) {
      if (b.disabled) continue;
      expect(typeof b.onclick === 'function' || b.hasAttribute('data-close'), b.outerHTML.slice(0, 100)).toBe(true);
    }
  });

  it('hire / fire / duty buttons still work from the board', () => {
    open();
    const cand = mgr.candidates[0];
    card().querySelector(`[data-emp-act="hire:${cand.id}"]`).click();
    expect(mgr.employees).toHaveLength(1);
    const id = mgr.employees[0].id;
    open();
    card().querySelector(`[data-emp-act="duty:${id}"]`).click();
    expect(mgr.employees[0].dept).toBe('off');
    expect(mgr.describe(mgr.employees[0])).toBe('Off duty');
  });
});
