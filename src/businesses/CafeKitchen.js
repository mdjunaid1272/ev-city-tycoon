/**
 * Café kitchen mini-game (pure logic, no DOM): the "cooking game" way of running the café.
 *
 * Customers' open orders are TICKETS. The player picks a ticket, then taps the stations the recipe needs (cups, espresso
 * machine, milk steamer, ice, oven, sandwich press). A station works for a few seconds, then the item is READY: collect it
 * quickly for full quality, wait too long and it goes stale (oven / press can even burn). When every step of a ticket is
 * collected the order is served through Cafe.finishOrder (same payment, satisfaction, stats and missions as always) plus a
 * quality tip that grows with the combo of good orders in a row.
 *
 * Orders the player works on are claimed from the café (Cafe.claimKitchen) so no barista takes them; closing the kitchen
 * gives every unfinished order back.
 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class CafeKitchen {
  constructor({ cafe, bus }) {
    this.cafe = cafe;
    this.bus = bus;
    this.k = cafe.cfg.kitchen;
    this.reset();
  }

  reset() {
    this.jobs = {};            // station id -> { oid, state: 'working'|'ready'|'burnt', t, dur, age, q }
    this.tickets = new Map();  // order id -> { steps: { station: 'todo'|'working'|'ready'|'done' }, q: [numbers] }
    this.selected = null;      // order id
    this.combo = 0;
    this.best = 0;
    this.session = { served: 0, tips: 0, perfect: 0, burnt: 0 };
    this.note = null;          // last message { text, kind, id }
    this.noteId = 0;
  }

  get stations() { return this.k.stations; }
  stationDuration(id) { return this.k.stations[id].seconds / (1 + this.k.speedPerMachineLevel * this.cafe.levels.machine); }
  recipeOf(order) { return this.k.recipes[order.pid] || []; }
  orderById(id) { return this.cafe.orders.find((o) => o.id === id) || null; }
  get comboMult() { return Math.min(this.k.comboMax, 1 + this.combo * this.k.comboStep); }
  say(text, kind = 'info') { this.note = { text, kind, id: ++this.noteId }; }

  /** The ticket the player is working on (null when nothing is selected). */
  get ticket() { return this.selected ? this.tickets.get(this.selected) || null : null; }
  /** Stations the selected ticket still needs and nobody has started yet. */
  nextStations() {
    const t = this.ticket;
    return t ? Object.keys(t.steps).filter((s) => t.steps[s] === 'todo' && !this.jobs[s]) : [];
  }

  // ---------- selecting orders ----------
  select(orderId) {
    const o = this.orderById(orderId);
    if (!o) return { ok: false, reason: 'That customer has left' };
    if (this.tickets.has(orderId)) { this.selected = orderId; return { ok: true }; }
    const r = this.cafe.claimKitchen(o);
    if (!r.ok) { this.say(r.reason, 'warn'); return r; }
    const steps = {};
    for (const s of this.recipeOf(o)) steps[s] = 'todo';
    this.tickets.set(orderId, { steps, q: [] });
    this.selected = orderId;
    return { ok: true };
  }

  // ---------- stations ----------
  tapStation(id) {
    const st = this.k.stations[id];
    if (!st) return { ok: false, reason: 'Unknown station' };
    const job = this.jobs[id];
    if (job) {
      if (job.state === 'working') return { ok: false, reason: 'Still working…' };
      return job.state === 'burnt' ? this.clearBurnt(id) : this.collect(id);
    }
    const t = this.ticket;
    if (!t) { this.say('Pick a customer first.', 'warn'); return { ok: false, reason: 'no ticket' }; }
    if (t.steps[id] !== 'todo') {
      const need = Object.keys(t.steps).filter((s) => t.steps[s] === 'todo').map((s) => this.k.stations[s].label);
      this.say(need.length ? `Not needed here. Still needs: ${need.join(', ')}` : 'Everything for this order is already on the way.', 'warn');
      return { ok: false, reason: 'not needed' };
    }
    this.jobs[id] = { oid: this.selected, state: 'working', t: 0, dur: this.stationDuration(id), age: 0, q: 1 };
    t.steps[id] = 'working';
    return { ok: true, started: true };
  }

  qualityFor(age) { return age <= this.k.sweetSeconds ? 1 : age <= this.k.okSeconds ? 0.65 : 0.3; }

  collect(id) {
    const job = this.jobs[id], t = this.tickets.get(job.oid), o = this.orderById(job.oid);
    delete this.jobs[id];
    if (!t || !o) return { ok: false, reason: 'order gone' };
    t.steps[id] = 'done';
    t.q.push(this.qualityFor(job.age));
    if (Object.values(t.steps).every((s) => s === 'done')) return this.serve(o, t);
    return { ok: true, collected: true };
  }

  clearBurnt(id) {
    const job = this.jobs[id], t = this.tickets.get(job.oid);
    delete this.jobs[id];
    if (t && t.steps[id] !== 'done') t.steps[id] = 'todo'; // has to be made again
    this.combo = 0; this.session.burnt++;
    this.say('Burnt! Start it again.', 'bad');
    return { ok: true, cleared: true };
  }

  serve(order, ticket) {
    const quality = ticket.q.reduce((a, b) => a + b, 0) / Math.max(1, ticket.q.length);
    const good = quality >= this.k.goodQuality;
    this.combo = good ? this.combo + 1 : 0;
    this.best = Math.max(this.best, this.combo);
    const r = this.cafe.serveKitchen(order, { quality, mult: this.comboMult });
    this.tickets.delete(order.id);
    if (this.selected === order.id) this.selected = null;
    if (!r.ok) return { ok: false, reason: 'could not serve' };
    this.session.served++; this.session.tips += r.bonus;
    if (quality >= 0.99) this.session.perfect++;
    this.say(quality >= 0.99 ? `Perfect! +$${r.bonus.toFixed(2)} tip${this.combo > 1 ? ` · combo x${this.combo}` : ''}` : `Served! +$${r.bonus.toFixed(2)} tip`, quality >= 0.99 ? 'perfect' : 'good');
    return { ok: true, served: true, quality, bonus: r.bonus };
  }

  // ---------- time ----------
  update(dt) {
    // tickets whose customer left or whose order was taken away
    for (const [oid] of this.tickets) {
      const o = this.orderById(oid);
      if (!o || !o.kitchen) {
        this.tickets.delete(oid);
        for (const [sid, j] of Object.entries(this.jobs)) if (j.oid === oid) delete this.jobs[sid];
        if (this.selected === oid) this.selected = null;
        if (!o) { this.combo = 0; this.say('A customer gave up waiting.', 'bad'); }
      }
    }
    for (const [sid, j] of Object.entries(this.jobs)) {
      const st = this.k.stations[sid], t = this.tickets.get(j.oid);
      if (!t) { delete this.jobs[sid]; continue; }
      if (j.state === 'working') {
        j.t += dt;
        if (j.t >= j.dur) { j.state = 'ready'; j.age = 0; t.steps[sid] = 'ready'; }
      } else if (j.state === 'ready') {
        j.age += dt;
        if (st.burn && j.age > st.burn) { j.state = 'burnt'; t.steps[sid] = 'burnt'; this.say(`${st.label} burnt!`, 'bad'); }
      }
    }
  }

  /** Give every unfinished order back to the café (closing the kitchen). */
  close() {
    for (const oid of this.tickets.keys()) { const o = this.orderById(oid); if (o) this.cafe.releaseKitchen(o); }
    this.jobs = {}; this.tickets.clear(); this.selected = null;
  }
}
