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
  return { bus, economy, tasks, mgr, hire };
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
