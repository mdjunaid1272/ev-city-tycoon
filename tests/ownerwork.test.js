// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { TaskManager } from '../src/employees/TaskManager.js';
import { OwnerWork } from '../src/employees/OwnerWork.js';

function setup({ staff = 0 } = {}) {
  document.body.innerHTML = '';
  const bus = new EventBus(), tasks = new TaskManager(bus), pos = { x: 0, z: 0 };
  const employees = { workload: vi.fn(() => ({ staff })) };
  const w = new OwnerWork({ bus, tasks, employees, getPos: () => pos });
  const log = { start: 0, ran: 0, progress: [] };
  let valid = true;
  const publish = (over = {}) => tasks.publish({ key: 'wash:0:c1', type: 'wash', dept: 'wash', priority: 15, pos: { x: 10, z: 10 }, base: 4, valid: () => valid,
    onStart: (emp) => { log.start++; log.emp = emp; }, onProgress: (p) => log.progress.push(p), run: () => { log.ran++; }, ...over });
  return { bus, tasks, w, pos, publish, log, employees, setValid: (v) => { valid = v; } };
}
const run = (w, secs, dt = 0.1) => { for (let i = 0; i < secs / dt; i++) w.update(dt); };

describe('owner works wash / garage jobs', () => {
  it('does nothing when the owner is not near an open job', () => {
    const { w, publish, tasks } = setup();
    publish(); run(w, 5);
    expect(w.working).toBe(false);
    expect([...tasks.tasks.values()][0].state).toBe('open');
  });

  it('standing beside the bay does the job: onStart with the owner, progress, run, complete', () => {
    const { w, pos, publish, tasks, log, bus } = setup();
    const done = vi.fn(); bus.on('owner:task-complete', done);
    publish(); pos.x = 10; pos.z = 9;
    w.update(0.1);
    expect(w.working).toBe(true); expect(log.start).toBe(1); expect(log.emp.skill).toBe(2);
    expect(document.getElementById('work-bar').classList.contains('hidden')).toBe(false);
    run(w, 3);
    expect(w.progress).toBeGreaterThan(0.4); expect(log.ran).toBe(0);
    run(w, 3);
    expect(log.ran).toBe(1); expect(w.working).toBe(false); expect(tasks.tasks.size).toBe(0);
    expect(done).toHaveBeenCalledWith({ type: 'wash' });
    expect(document.getElementById('work-bar').classList.contains('hidden')).toBe(true);
    expect(log.progress.at(-1)).toBeLessThanOrEqual(1);
  });

  it('walking away hands the job back (open again, nothing completed)', () => {
    const { w, pos, publish, tasks, log } = setup();
    publish(); pos.x = 10; pos.z = 10; run(w, 1);
    expect(w.working).toBe(true);
    pos.x = 40; w.update(0.1);
    expect(w.working).toBe(false);
    expect([...tasks.tasks.values()][0].state).toBe('open'); expect(log.ran).toBe(0);
  });

  it('never takes a job an employee already holds, nor garage jobs above the owner skill', () => {
    const { w, pos, publish, tasks } = setup();
    const held = publish(); tasks.request({ id: 'e1', dept: 'wash', pos: { x: 0, z: 0 } }); expect(held.state).toBe('reserved');
    publish({ key: 'repair:0:c2', dept: 'garage', type: 'repair', minSkill: 4 });
    pos.x = 10; pos.z = 10; run(w, 2);
    expect(w.working).toBe(false);
  });

  it('ignores charging and cafe jobs', () => {
    const { w, pos, publish } = setup();
    publish({ key: 'connect:1', dept: 'charging', type: 'connect' }); publish({ key: 'cafe:1', dept: 'cafe', type: 'cafe-order' });
    pos.x = 10; pos.z = 10; run(w, 2);
    expect(w.working).toBe(false);
  });

  it('drops a job that became invalid, and disposing hands back the job and removes the bar', () => {
    const { w, pos, publish, setValid } = setup();
    publish(); pos.x = 10; pos.z = 10; run(w, 1); expect(w.working).toBe(true);
    setValid(false); w.update(0.1); expect(w.working).toBe(false);
    setValid(true); publish({ key: 'wash:0:c3' }); run(w, 1); expect(w.working).toBe(true);
    w.dispose(); expect(document.getElementById('work-bar')).toBeNull(); expect(w.working).toBe(false);
  });

  it('reminds the owner (once per interval) only when cars wait and nobody is on duty', () => {
    const a = setup(); const toast = vi.fn(); a.bus.on('toast', toast);
    a.publish(); run(a.w, 20);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].text).toMatch(/Car Wash.*hire a washer/);
    run(a.w, 60); expect(toast).toHaveBeenCalledTimes(1);
    run(a.w, 40); expect(toast).toHaveBeenCalledTimes(2);
    const b = setup({ staff: 1 }); const t2 = vi.fn(); b.bus.on('toast', t2);
    b.publish(); run(b.w, 200); expect(t2).not.toHaveBeenCalled();
  });
});