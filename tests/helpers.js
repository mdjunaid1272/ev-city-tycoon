import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBus } from '../src/core/EventBus.js';
import { EconomyManager } from '../src/economy/EconomyManager.js';
import { ParkingSystem } from '../src/vehicles/ParkingSystem.js';
import { ChargingStation } from '../src/businesses/ChargingStation.js';
import { CustomerManager } from '../src/customers/CustomerManager.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The real game data (public/data/*.json): tests run against the same numbers the game uses. */
export const data = (name) => JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', `${name}.json`), 'utf8').replace(/^﻿/, '')); // some data files carry a BOM

/** A headless charging station with customers, exactly as Game wires them (no renderer). */
export function makeWorld({ cash, saved = null } = {}) {
  const bus = new EventBus();
  const econ = data('economy');
  const economy = new EconomyManager(bus, saved?.economy || { cash: cash ?? econ.startingCash, gems: econ.startingGems });
  const parking = new ParkingSystem();
  const station = new ChargingStation(bus, economy, econ, saved?.station || null, parking, { getStage: () => 4 });
  const customers = new CustomerManager({
    bus, economy, station, parking, config: data('customers'), vehicleDefs: data('vehicles').vehicles, getHour: () => 12, saved: saved?.customers,
  });
  customers.enabled = false; // tests spawn customers themselves
  return { bus, economy, parking, station, customers, econ };
}

/** Spawn a customer that decides to come (some drivers legitimately stay away). */
export function spawnCustomer(world, type = 'regular') {
  for (let i = 0; i < 200; i++) {
    const c = world.customers.spawn(type);
    if (c) return c;
  }
  throw new Error('no customer spawned');
}

/** Drive one customer from the driveway to a charging bay: arrived -> parked -> plugged in. */
export function parkAndPlug(world, c) {
  const r = world.customers.arrived(c);
  if (r.action !== 'bay') return r;
  world.station.vehicleParked(r.bayId);
  world.customers.parkedAtBay(c);
  world.station.startCharging(r.bayId);
  return r;
}
