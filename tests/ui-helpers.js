// @vitest-environment jsdom
// Shared fixture: a UIManager wired to a real headless game state and the real index.html markup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { UIManager } from '../src/ui/UIManager.js';
import { StatsTracker } from '../src/progression/StatsTracker.js';
import { makeWorld } from './helpers.js';

export { UIManager };
const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const BODY = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');

export const emptyBiz = (stats = {}) => ({ customers: new Map(), bays: [], queue: [], stats: { lost: 0, tips: 0, satSum: 0, satN: 0, ...stats } });

/** A UIManager wired to a real headless game state (economy, station, customers, stats tracker) and the real index.html markup. */
export function makeUI() {
  document.body.innerHTML = BODY;
  const w = makeWorld({ cash: 0 });
  const stats = new StatsTracker(w.bus);
  const ui = Object.create(UIManager.prototype);
  Object.assign(ui, {
    bus: w.bus, economy: w.economy, station: w.station, customers: w.customers, stats,
    wash: emptyBiz(), garage: emptyBiz(), hubs: {}, properties: { ownedCount: 0 },
    goals: { daily: [{ done: true }, { done: false }, { done: false }] },
    game: { paused: false, selectionRing: { visible: false }, setSelectionOutline() {}, setPaused(p) { this.paused = p; } },
    camera: { inManagement: false }, employees: { cfg: { roles: {} } },
    modal: null, tab: { business: 'overview', missions: 'main' }, selectionFn: null, _offs: [], _listeners: [],
  });
  ui.bindEvents();
  return { ui, w, stats };
}
