import { BAY_SLOTS } from '../businesses/ChargingStation.js';

/**
 * Charging department -> TaskManager bridge.
 * Publishes a "connect" task for every vehicle waiting for its plug and an "unplug" task for every
 * finished vehicle that still occupies a bay. Priorities:
 *   connect: customer priority (+ urgency of the customer's remaining patience when a manager is on duty)
 *   unplug : higher when customers are queueing for a bay
 */
export function standPoint(bayId) {
  const bx = BAY_SLOTS[bayId], side = bx < 0 ? 1 : -1;
  return { x: bx + side * 2.45 + side * 1.5, z: 0.9 }; // beside the charger, away from the car
}
export function chargerPoint(bayId) {
  const bx = BAY_SLOTS[bayId], side = bx < 0 ? 1 : -1;
  return { x: bx + side * 2.45, z: 0 };
}

export class ChargingTasks {
  constructor({ bus, station, customers, tasks, employees, cfg }) {
    Object.assign(this, { bus, station, customers, tasks, employees, cfg });
    this.timer = 0;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const st = this.station, cm = this.customers, auto = this.employees.hasManager;
    for (const b of st.bays) {
      if (!b.unlocked) continue;
      if (b.state === 'waiting' && b.customer) {
        const c = b.customer, cid = c.id, id = b.id;
        const urgency = auto ? 40 * (1 - Math.max(0, c.patience / c.maxPatience)) : 0; // manager: auto-prioritise impatient customers
        this.tasks.publish({
          key: `connect:${id}:${cid}`, type: 'connect', dept: 'charging', priority: 10 * c.def.priority + urgency,
          pos: standPoint(id), face: chargerPoint(id), base: this.cfg.connectSeconds,
          valid: () => st.bays[id].state === 'waiting' && st.bays[id].customer?.id === cid,
          run: () => { st.startCharging(id); },
        });
      } else if (b.state === 'done' && !b.released && b.vehicle) {
        const vid = b.vehicle.id, id = b.id;
        this.tasks.publish({
          key: `unplug:${id}:${vid}`, type: 'unplug', dept: 'charging', priority: 12 + cm.queue.length * 12,
          pos: standPoint(id), face: chargerPoint(id), base: this.cfg.unplugSeconds,
          valid: () => st.bays[id].state === 'done' && !st.bays[id].released && st.bays[id].vehicle?.id === vid,
          run: () => { st.release(id); },
        });
      }
    }
  }
}
