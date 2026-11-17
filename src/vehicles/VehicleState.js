/** Per-vehicle wear: dirt level (0 clean .. 1 filthy) and component condition (0..100). */
export const CONDITION_KEYS = ['battery', 'motor', 'tyres', 'brakes'];

export function randomDirt() {
  return Math.round((0.15 + Math.random() * 0.8) * 100) / 100;
}

export function randomCondition() {
  const c = {};
  for (const k of CONDITION_KEYS) {
    // most components are fine, some are worn
    c[k] = Math.round(Math.random() < 0.28 ? 25 + Math.random() * 35 : 65 + Math.random() * 35);
  }
  return c;
}

export function averageCondition(v) {
  return Math.round(CONDITION_KEYS.reduce((s, k) => s + v.condition[k], 0) / CONDITION_KEYS.length);
}
