/**
 * Customers on site, counted ONCE each.
 *
 * Ownership: every business keeps its customers in one `customers` Map (id -> customer). A customer waiting for a bay is
 * ALSO listed in that business's `queue` array, so the queue is a view onto the same customers, never extra people.
 * Ids are unique across businesses ("c12" station / hub charger, "s7" wash / garage), but a Set of ids still guards the total.
 *
 * Metrics (each customer lands in exactly one of the last four):
 *   onSite   - everyone currently on the property
 *   queued   - parked in a queue slot (state "queue"): waiting for a free bay
 *   waiting  - at a bay but not being served yet (waiting to be plugged in / for a worker)
 *   charging - connected to a charger (station or charging hub)
 *   service  - being washed, diagnosed or repaired
 *   arriving - driving in / being assigned a bay (everything else)
 * The cafe / store are purchases made while charging, nobody walks inside, so there is no "in the cafe" metric.
 */
const SERVICE_BAY_STATES = new Set(['working', 'auto', 'diagnosing', 'repairing', 'ready', 'blocked']);

export function siteCounts(businesses) {
  const seen = new Set();
  const out = { onSite: 0, queued: 0, waiting: 0, charging: 0, service: 0, arriving: 0 };
  for (const biz of businesses) {
    if (!biz || !biz.customers) continue;
    for (const c of biz.customers.values()) {
      if (seen.has(c.id)) continue; // never count the same customer twice
      seen.add(c.id);
      out.onSite++;
      const bay = c.bayId != null && biz.bays ? biz.bays[c.bayId] : null;
      if (c.state === 'queue') out.queued++;
      else if (c.state === 'charging' || bay?.state === 'charging') out.charging++;
      else if (bay && SERVICE_BAY_STATES.has(bay.state)) out.service++;
      else if (c.state === 'waiting') out.waiting++;
      else out.arriving++;
    }
  }
  return out;
}

/**
 * Lifetime customer figures summed over every business (station, wash, garage, hubs): lost customers, tips and average satisfaction.
 * Each business keeps its own `stats` object ({ lost, tips, satSum, satN, ... }); the total is the sum, nothing is counted twice.
 */
export function aggregateStats(businesses) {
  const out = { lost: 0, tips: 0, satSum: 0, satN: 0, avgSatisfaction: null };
  for (const b of businesses) {
    const s = b?.stats;
    if (!s) continue;
    out.lost += s.lost || 0;
    out.tips += s.tips || 0;
    out.satSum += s.satSum || 0;
    out.satN += s.satN || 0;
  }
  out.avgSatisfaction = out.satN ? out.satSum / out.satN : null;
  return out;
}
