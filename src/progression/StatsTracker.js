/**
 * Event-driven counters (lifetime, today, this week) that feed goals, achievements and stage requirements.
 * Everything is derived from EventBus events, so the tracker never touches the simulation.
 */
/** Satisfaction at which a customer counts as happy (goals, missions, tips). Early-game satisfaction averages ~65, so 70 is reachable; 80+ still earns reputation. */
export const HAPPY_SCORE = 70;
const KEYS = ['charged', 'washed', 'repaired', 'served', 'happy', 'vipServed', 'premiumServed', 'tips', 'revenue', 'tasks', 'hired', 'contractsDone', 'days', 'upgrades', 'cafeOrders', 'cafeRevenue'];
const blank = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

export class StatsTracker {
  constructor(bus, saved = null) {
    this.total = { ...blank(), ...(saved?.total || {}) };
    this.today = { ...blank(), ...(saved?.today || {}) };
    this.week = { ...blank(), ...(saved?.week || {}) };
    const inc = (k, n = 1) => { this.total[k] += n; this.today[k] += n; this.week[k] += n; };
    this.inc = inc;
    const served = (customer, satisfaction) => {
      inc('served');
      if (satisfaction >= HAPPY_SCORE) inc('happy');
      if (customer.type === 'vip') inc('vipServed');
      if (customer.type === 'vip' || customer.type === 'premium') inc('premiumServed');
    };
    bus.on('customer:paid', ({ customer, satisfaction }) => { inc('charged'); served(customer, satisfaction); });
    bus.on('svc:paid', ({ biz, customer, satisfaction }) => { inc(biz === 'wash' ? 'washed' : biz === 'garage' ? 'repaired' : 'charged'); served(customer, satisfaction); });
    bus.on('cash:earned', ({ amount, source }) => {
      if (source === 'offline earnings' || source === 'offline bonus') return;
      inc('revenue', amount);
      if (source === 'tips') inc('tips', amount);
    });
    bus.on('cafe:served', ({ amount }) => { inc('cafeOrders'); inc('cafeRevenue', amount || 0); }); // counted separately: a driver who also buys a coffee is not a second 'customer served'
    bus.on('employee:task-complete', () => inc('tasks'));
    bus.on('employee:hired', () => inc('hired'));
    bus.on('cash:spent', ({ category }) => { if (category === 'equipment') inc('upgrades'); });
    bus.on('contract:done', () => inc('contractsDone'));
    bus.on('day:new', () => inc('days'));
  }

  resetDay() { this.today = blank(); }
  resetWeek() { this.week = blank(); }

  serialize() {
    return { total: this.total, today: this.today, week: this.week };
  }
}
