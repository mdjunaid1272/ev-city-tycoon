/**
 * Sequential main missions driven purely by EventBus events.
 * Rewards are granted through EconomyManager (never directly).
 */
const MISSIONS = [
  { id: 'm_mgmt', title: 'Try Management Mode', desc: 'Press M (or the camera button) to view your station from above.', target: 1, event: 'camera:mode', test: (p) => p === 'management', reward: { cash: 200 } },
  { id: 'm_hire', title: 'Hire your first employee', desc: 'Open Staff (the 👥 button) and hire an attendant: they plug in and unplug cars for you.', target: 1, event: 'employee:hired', reward: { cash: 500, reputation: 3 } },
  { id: 'm_auto', title: 'Let your team work: 10 tasks', desc: 'Employees connect waiting cars and unplug finished ones on their own.', target: 10, event: 'employee:task-complete', reward: { cash: 800, gems: 5, reputation: 5 } },
  { id: 'm_first', title: 'Charge your first EV', desc: 'Walk to a charger with a waiting car and stand next to it.', target: 1, event: 'charging:complete', reward: { cash: 400, reputation: 5 } },
  { id: 'm_serve5', title: 'Serve 5 charging customers', desc: 'Keep the bays busy.', target: 5, event: 'charging:complete', reward: { cash: 800, gems: 5, reputation: 10 } },
  { id: 'm_bay', title: 'Expand: build a 3rd charging bay', desc: 'Management mode → select the glowing empty bay → Build.', target: 1, event: 'station:bay-unlocked', reward: { cash: 500, reputation: 10 } },
  { id: 'm_upgrade', title: 'Upgrade your chargers', desc: 'Open Charging (⚡) and buy a charger speed upgrade.', target: 1, event: 'station:upgraded', reward: { cash: 1000, gems: 10, reputation: 15 } },
  { id: 'm_stage2', title: 'Reach Stage 2: EV Service Center', desc: 'Missions 🏁 → Stage tab shows the goals: reputation, revenue, 3 bays and a first hire.', target: 1, event: 'stage:up', test: (p) => p.stage === 2, reward: { cash: 1000, gems: 5 } },
  { id: 'm_wash', title: 'Open the Car Wash', desc: 'Needs reputation 8. Build it on the west lot (Business 🏢 screen, or walk to its sign).', target: 1, event: 'svc:built', test: (p) => p.biz === 'wash', reward: { cash: 800, reputation: 5 } },
  { id: 'm_wash5', title: 'Wash 5 cars', desc: 'Hire a Car Wash Worker in Staff 👥. Customers also come from your chargers.', target: 5, event: 'svc:paid', test: (p) => p.biz === 'wash', reward: { cash: 1000, gems: 5, reputation: 8 } },
  { id: 'm_stage3', title: 'Reach Stage 3: Automotive Business Hub', desc: 'Unlocks the garage, store, coffee shop, fleet contracts, solar and storage.', target: 1, event: 'stage:up', test: (p) => p.stage === 3, reward: { cash: 2000, gems: 10 } },
  { id: 'm_garage', title: 'Open the EV Garage', desc: 'Needs reputation 20. Build it on the north lot.', target: 1, event: 'svc:built', test: (p) => p.biz === 'garage', reward: { cash: 1500, reputation: 8 } },
  { id: 'm_repair5', title: 'Complete 5 garage jobs', desc: 'Hire a mechanic and keep spare parts in stock.', target: 5, event: 'svc:paid', test: (p) => p.biz === 'garage', reward: { cash: 2000, gems: 10, reputation: 10 } },
  { id: 'm_happy', title: 'Make 5 customers happy', desc: 'Keep waits short and prices fair: satisfaction 80%+ counts.', target: 5, event: 'customer:paid', test: (p) => p.satisfaction >= 80, reward: { cash: 1200, gems: 10, reputation: 10 } },
  { id: 'm_rep', title: 'Reach 25 reputation', desc: 'Happy customers raise reputation and unlock Premium customers at 10.', target: 1, event: 'reputation:changed', test: (p) => p.total >= 25, reward: { cash: 2000, gems: 20 } },
  { id: 'm_prop', title: 'Buy another property', desc: 'Open the City Map 🗺️, unlock a district permit and buy a lot (small lots in the Residential District are cheapest).', target: 1, event: 'property:bought', test: (p) => p.id.startsWith('hub_'), reward: { cash: 2000, gems: 10, reputation: 10 } },
  { id: 'm_decor', title: 'Decorate your station', desc: 'Management view (M) → 🎨 Decorate. Benches make waiting customers happier; trees and banners attract more.', target: 3, event: 'decor:placed', reward: { cash: 500, gems: 3 } },
  { id: 'm_hub', title: 'Open the Coffee Shop', desc: 'Business 🏢 → Upgrades → Customer hub. Customers spend while they charge.', target: 1, event: 'hub:built', test: (p) => p.key === 'coffee', reward: { cash: 1000, reputation: 5 } },
  { id: 'm_contract', title: 'Complete a fleet contract', desc: 'Business 🏢 → Contracts: accept a job and serve the fleet customers before the deadline.', target: 1, event: 'contract:done', reward: { cash: 2500, gems: 15, reputation: 10 } },
  { id: 'm_stage4', title: 'Reach Stage 4: City EV Empire', desc: 'VIP customers arrive. Check the Stage tab for the goals.', target: 1, event: 'stage:up', test: (p) => p.stage === 4, reward: { cash: 5000, gems: 25 } },
  { id: 'm_rev', title: 'Earn $1,500 in revenue', desc: 'Total charging revenue counts.', target: 1500, event: 'cash:earned', amount: true, reward: { cash: 1500, gems: 15, reputation: 25 } },
];

export class MissionManager {
  constructor(bus, economy) {
    this.bus = bus;
    this.economy = economy;
    this.index = 0;
    this.progress = 0;
    for (const evt of new Set(MISSIONS.map((m) => m.event))) {
      bus.on(evt, (p) => this.onEvent(evt, p));
    }
  }

  get current() {
    return MISSIONS[this.index] || null;
  }

  onEvent(evt, payload) {
    const m = this.current;
    if (!m || m.event !== evt) return;
    if (m.test && !m.test(payload)) return;
    this.progress += m.amount ? (payload?.amount || 0) : 1;
    if (this.progress >= m.target) this.complete();
    else this.bus.emit('mission:progress', this.snapshot());
  }

  complete() {
    const m = this.current;
    this.economy.grant(m.reward);
    this.bus.emit('mission:complete', { mission: m });
    this.index++;
    this.progress = 0;
    this.bus.emit('mission:progress', this.snapshot());
  }

  snapshot() {
    const m = this.current;
    if (!m) return { done: true, title: 'All current missions complete', desc: 'More arrive in later updates.', progress: 1, target: 1, reward: {} };
    return { id: m.id, title: m.title, desc: m.desc, progress: Math.min(this.progress, m.target), target: m.target, reward: m.reward };
  }

  /** Full list with state for the missions screen. */
  list() {
    return MISSIONS.map((m, i) => ({ ...m, state: i < this.index ? 'done' : i === this.index ? 'cur' : 'todo' }));
  }

  serialize() {
    return { index: this.index, progress: this.progress };
  }
  restore(d) {
    if (!d) return;
    this.index = Math.min(Math.max(0, d.index | 0), MISSIONS.length);
    this.progress = Math.max(0, d.progress || 0);
    this.bus.emit('mission:progress', this.snapshot());
  }
}

