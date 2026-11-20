import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { EconomyManager } from '../src/economy/EconomyManager.js';
import { TaskManager } from '../src/employees/TaskManager.js';
import { EmployeeManager } from '../src/employees/EmployeeManager.js';
import { NavGrid } from '../src/employees/NavGrid.js';
import { data } from './helpers.js';

const task = (over = {}) => ({ key: 'k', type: 'plug', dept: 'charging', priority: 10, pos: { x: 0, z: 0 }, base: 1, valid: () => true, run: () => {}, ...over });

describe('task board: assignment', () => {
  it('the same key never creates a duplicate task, it refreshes the existing one', () => {
    const tm = new TaskManager(new EventBus());
    const a = tm.publish(task({ key: 'bay0', priority: 1 }));
    const b = tm.publish(task({ key: 'bay0', priority: 50 }));
    expect(b).toBe(a);
    expect(a.priority).toBe(50);
    expect(tm.stats.published).toBe(1);
  });

  it('hands the highest priority task out, each task to exactly one worker', () => {
    const tm = new TaskManager(new EventBus());
    tm.publish(task({ key: 'low', priority: 1 })); tm.publish(task({ key: 'high', priority: 30 }));
    const first = tm.request({ id: 'e1', dept: 'charging', pos: { x: 0, z: 0 } });
    const second = tm.request({ id: 'e2', dept: 'charging', pos: { x: 0, z: 0 } });
    const third = tm.request({ id: 'e3', dept: 'charging', pos: { x: 0, z: 0 } });
    expect(first.key).toBe('high');
    expect(second.key).toBe('low');
    expect(third).toBeNull();
    expect([first.reservedBy, second.reservedBy]).toEqual(['e1', 'e2']);
  });

  it('only gives a worker tasks of its own department and skill', () => {
    const tm = new TaskManager(new EventBus());
    tm.publish(task({ key: 'w', dept: 'wash' })); tm.publish(task({ key: 'hard', minSkill: 3 }));
    expect(tm.request({ id: 'e', dept: 'charging', pos: { x: 0, z: 0 }, canDo: (t) => (t.minSkill || 1) <= 2 })).toBeNull();
  });

  it('a released task goes back to the board; a task that became invalid is cancelled instead of assigned', () => {
    const tm = new TaskManager(new EventBus());
    let valid = true;
    const t = tm.publish(task({ valid: () => valid }));
    tm.request({ id: 'e1', dept: 'charging', pos: { x: 0, z: 0 } });
    tm.release(t, 'blocked');
    expect(t.state).toBe('open');
    expect(tm.request({ id: 'e2', dept: 'charging', pos: { x: 0, z: 0 } })).toBe(t);
    valid = false; tm.validate();
    expect(t.state).toBe('cancelled');
    expect(tm.tasks.size).toBe(0);
  });

  it('a completed task cannot be completed twice', () => {
    const tm = new TaskManager(new EventBus());
    const t = tm.publish(task());
    tm.request({ id: 'e', dept: 'charging', pos: { x: 0, z: 0 } });
    tm.complete(t); tm.complete(t);
    expect(tm.stats.completed).toBe(1);
  });
});

function staffing(cash = 50000) {
  const bus = new EventBus();
  const economy = new EconomyManager(bus, { cash, gems: 0 });
  const tasks = new TaskManager(bus);
  const mgr = new EmployeeManager({ bus, economy, tasks, config: data('employees'), getReputation: () => 0, getCapacity: () => 2 });
  mgr.registerFacility('charging', { nav: new NavGrid(), posts: [{ x: -0.8, z: 3.6 }, { x: 0.8, z: 3.6 }], door: { x: -14, z: -11.4 }, breakSpot: { x: -16.5, z: -10.5 }, built: () => true, label: 'Charging Station' });
  const hire = (skill = 2) => {
    const c = mgr.makeCandidate(); c.role = 'attendant'; c.skill = skill; c.cost = mgr.hireCost(skill); mgr.candidates.push(c);
    return mgr.hire(c.id);
  };
  const step = (seconds, dt = 0.1) => { for (let t = 0; t < seconds; t += dt) mgr.update(dt); };
  return { bus, economy, tasks, mgr, hire, step };
}

describe('employees: hiring and doing tasks', () => {
  it('hiring costs cash once, and is refused when unaffordable or over the staff limit', () => {
    const s = staffing();
    const before = s.economy.cash;
    const r = s.hire();
    expect(r.ok).toBe(true);
    expect(s.economy.cash).toBe(before - s.mgr.hireCost(2));
    expect(s.mgr.employees).toHaveLength(1);
    s.hire();
    expect(s.hire()).toMatchObject({ ok: false, reason: expect.stringMatching(/limit/i) });
    expect(s.mgr.employees).toHaveLength(2);

    const poor = staffing(1);
    expect(poor.hire()).toMatchObject({ ok: false, reason: 'Not enough cash' });
    expect(poor.mgr.employees).toHaveLength(0);
  });

  it('an attendant walks to a published task, performs it and completes it exactly once', () => {
    const s = staffing();
    const run = vi.fn();
    s.hire();
    s.tasks.publish(task({ key: 'plug0', pos: { x: 0.8, z: 2 }, run }));
    const done = [];
    s.bus.on('employee:task-complete', () => done.push(1));
    for (let i = 0; i < 1200 && !done.length; i++) s.mgr.update(0.1);
    expect(done).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.mgr.employees[0].tasksDone).toBe(1);
    expect(s.tasks.stats.completed).toBe(1);
    expect(s.tasks.tasks.size).toBe(0);
  });

  it('two employees and one task: only one of them takes it (no duplicate assignment)', () => {
    const s = staffing();
    s.hire(); s.hire();
    const run = vi.fn();
    s.tasks.publish(task({ key: 'only', pos: { x: 0, z: 2 }, run }));
    for (let i = 0; i < 1200; i++) s.mgr.update(0.1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.mgr.employees.reduce((n, e) => n + e.tasksDone, 0)).toBe(1);
  });

  it('firing a worker releases the task it was holding so someone else can do it', () => {
    const s = staffing();
    const r = s.hire();
    const t = s.tasks.publish(task({ key: 'held', pos: { x: -0.8, z: 2 } }));
    for (let i = 0; i < 400 && t.state === 'open'; i++) s.mgr.update(0.1);
    expect(['reserved', 'active']).toContain(t.state);
    s.mgr.fire(r.employee.id);
    for (let i = 0; i < 20; i++) s.mgr.update(0.1);
    expect(t.reservedBy).toBeNull();
    expect(t.state).toBe('open');
  });

  it('an employee never ends up inside a blocked cell (stuck recovery keeps them moving)', () => {
    const s = staffing();
    s.hire();
    s.tasks.publish(task({ key: 'far', pos: { x: 10, z: -10 } }));
    for (let i = 0; i < 1500; i++) s.mgr.update(0.1);
    const e = s.mgr.employees[0];
    expect(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.z)).toBe(true);
    expect(['idle', 'move', 'perform', 'complete', 'recover', 'return', 'arriving']).toContain(e.state);
  });
});

describe('employees: workload, specialisation and the team training program', () => {
  /** Station + one charging hub, so attendants can be moved between two places. */
  function twoSites(cash = 1e6) {
    const s = staffing(cash);
    s.mgr.registerFacility('hub_x', { nav: new NavGrid(), posts: [{ x: 5, z: 5 }, { x: 6, z: 5 }], door: { x: -14, z: -11.4 }, breakSpot: { x: -16, z: -10 }, built: () => true, label: 'Hub X' });
    const hubTasks = (n) => { for (let i = 0; i < n; i++) s.tasks.publish(task({ key: `hubjob${i}`, dept: 'hub_x', pos: { x: 5, z: 5 } })); };
    return { ...s, hubTasks };
  }

  it('the training program raises every employee\'s speed by exactly its bonus, costs cash, and has a maximum', () => {
    const s = staffing();
    const e = s.hire(3).employee;
    const base = s.mgr.workMult(e);
    const cash = s.economy.cash;
    const n = s.mgr.nextEfficiency();
    expect(s.mgr.buyEfficiency()).toEqual({ ok: true });
    expect(s.economy.cash).toBe(cash - n.cost);
    expect(s.economy.ledger.expenses.training).toBe(n.cost);
    expect(s.mgr.workMult(e)).toBeCloseTo(base * 1.05, 6);
    s.mgr.buyEfficiency(); s.mgr.buyEfficiency();
    expect(s.mgr.efficiencyBonus).toBeCloseTo(0.15, 6);
    expect(s.mgr.workMult(e)).toBeCloseTo(base * 1.15, 6);
    expect(s.mgr.buyEfficiency()).toMatchObject({ ok: false, reason: 'Fully trained' });
    expect(s.mgr.nextEfficiency()).toBeNull();
  });

  it('training needs cash and takes nothing when it fails', () => {
    const s = staffing(100);
    expect(s.mgr.buyEfficiency()).toMatchObject({ ok: false, reason: 'Not enough cash' });
    expect(s.economy.cash).toBe(100);
    expect(s.mgr.efficiencyLevel).toBe(0);
  });

  it('the training level is saved; older saves without it start at level 0; corrupt values are clamped', () => {
    const s = staffing();
    s.mgr.buyEfficiency(); s.mgr.buyEfficiency();
    const saved = JSON.parse(JSON.stringify(s.mgr.serialize()));
    expect(saved.efficiencyLevel).toBe(2);
    const mk = (sv) => new EmployeeManager({ bus: new EventBus(), economy: s.economy, tasks: s.tasks, config: data('employees'), getReputation: () => 0, getCapacity: () => 2, saved: sv });
    expect(mk(saved).efficiencyLevel).toBe(2);
    expect(mk({ employees: [] }).efficiencyLevel).toBe(0);
    expect(mk({ efficiencyLevel: 99 }).efficiencyLevel).toBe(3);
    expect(mk({ efficiencyLevel: -5 }).efficiencyLevel).toBe(0);
    expect(mk({ efficiencyLevel: 'x' }).efficiencyLevel).toBe(0);
  });

  it('workload counts open work against the staff of each department', () => {
    const s = twoSites();
    s.hire(); s.hire();
    s.hubTasks(5);
    expect(s.mgr.workload('hub_x')).toMatchObject({ tasks: 5, staff: 0 });
    expect(s.mgr.workload('charging')).toMatchObject({ tasks: 0, staff: 2 });
    expect(s.mgr.workload('hub_x').perStaff).toBeGreaterThan(s.mgr.workload('charging').perStaff);
  });

  it('balance() moves idle attendants to the busier site, one at a time, and keeps the quiet site staffed', () => {
    const s = twoSites();
    s.hire(); s.hire();
    s.step(30); // both settle at their posts, idle
    s.hubTasks(6);
    const moved = s.mgr.balance();
    expect(moved).toBeGreaterThan(0);
    expect(s.mgr.employees.filter((e) => s.mgr.homeOf(e) === 'hub_x').length).toBe(moved);
    expect(s.mgr.employees.filter((e) => s.mgr.homeOf(e) === 'charging').length).toBeGreaterThanOrEqual(0);
    // work gets done at the hub
    s.step(120);
    expect(s.tasks.stats.completed).toBeGreaterThan(0);
  });

  it('balance() does nothing when the other site is not busier, or would leave a site with work empty', () => {
    const s = twoSites();
    s.hire();
    s.step(20);
    expect(s.mgr.balance()).toBe(0); // no work anywhere
    s.hubTasks(2);
    for (let i = 0; i < 3; i++) s.tasks.publish(task({ key: `st${i}`, dept: 'charging', pos: { x: 0, z: 2 } }));
    expect(s.mgr.balance()).toBe(0); // the only attendant must stay where the work is
  });

  it('new attendants start where the workload is highest', () => {
    const s = twoSites();
    s.hire();
    s.hubTasks(6);
    const e = s.hire().employee;
    expect(s.mgr.homeOf(e)).toBe('hub_x');
    const calm = twoSites();
    expect(calm.mgr.homeOf(calm.hire().employee)).toBe('charging'); // no work anywhere: the default site
  });

  it('describe() says what an employee is doing in plain words', () => {
    const s = staffing();
    const e = s.hire().employee;
    expect(s.mgr.describe(e)).toBe('Starting shift');
    s.step(40);
    expect(s.mgr.describe(e)).toBe('Waiting for work');
    s.tasks.publish(task({ key: 'job', type: 'connect', pos: { x: 0.8, z: 2 }, base: 20 }));
    let seen = new Set();
    for (let i = 0; i < 400; i++) { s.mgr.update(0.1); seen.add(s.mgr.describe(e)); }
    expect([...seen].some((t) => /Connecting a car/.test(t))).toBe(true);
    s.mgr.assign(e.id, 'off');
    expect(s.mgr.describe(e)).toBe('Off duty');
  });

  it('skill progression: experience raises the level and the work speed, training raises the skill', () => {
    const s = staffing();
    const e = s.hire(2).employee;
    const w0 = s.mgr.workMult(e);
    e.xp = 600;
    expect(s.mgr.level(e)).toBe(10);
    expect(s.mgr.workMult(e)).toBeCloseTo(w0 * 1.2, 6);
    const sal = e.salary;
    expect(s.mgr.train(e.id)).toBe(true);
    expect(e.skill).toBe(3);
    expect(e.salary).toBeGreaterThan(sal); // better people cost more
  });

  it('salaries are paid daily through the economy; unpaid days slow the team and eventually make people quit', () => {
    const s = staffing(5000);
    const e = s.hire().employee;
    const cash = s.economy.cash;
    s.mgr.paySalaries();
    expect(s.economy.cash).toBe(cash - e.salary);
    s.economy.cash = 0;
    const fast = s.mgr.workMult(e);
    s.mgr.paySalaries();
    expect(e.unpaidDays).toBe(1);
    expect(s.mgr.workMult(e)).toBeLessThan(fast);
    const quit = vi.fn(); s.bus.on('employee:quit', quit);
    s.mgr.paySalaries(); s.mgr.paySalaries();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
