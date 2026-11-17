import { ServiceBusiness } from './ServiceBusiness.js';

/**
 * Car wash. Packages need equipment levels; each bay is either MANUAL (a washer works the whole job)
 * or an automatic TUNNEL (a washer only starts the machine, which then runs by itself).
 * Wash result: cleanliness = package + equipment + worker skill; the vehicle's dirt level really drops.
 *
 * bay states: empty -> reserved -> waiting -> working (manual, staffed) | auto (tunnel) -> done
 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class CarWash extends ServiceBusiness {
  constructor(o) {
    super({ ...o, id: 'wash', cfg: o.cfg.wash, saved: o.saved });
    const s = o.saved || {};
    this.equipLevel = s.equipLevel || 1;
    this.priceMult = s.priceMult || {}; // package -> multiplier (0.5 .. 2)
    const unlocked = s.bays || 1;
    this.bays = Array.from({ length: this.cfg.maxBays }, (_, i) => ({
      id: i, unlocked: i < unlocked, mode: s.tunnels?.[i] ? 'tunnel' : 'manual', state: 'empty', customer: null, vehicle: null, space: null, job: null, progress: 0, released: false, workerSkill: 2,
    }));
    this.initParking();
  }

  get equipment() {
    return this.cfg.equipment[this.equipLevel - 1];
  }
  get packages() {
    return this.cfg.packages;
  }
  availablePackages() {
    return this.equipment.packages;
  }
  packagePrice(key) {
    return Math.round(this.cfg.packages[key].price * (this.priceMult[key] ?? 1) * 100) / 100;
  }
  setPriceMult(key, m) {
    if (!this.cfg.packages[key] || !Number.isFinite(m)) return;
    this.priceMult[key] = Math.round(clamp(m, 0.5, 2) * 20) / 20;
    this.emit('changed');
  }

  // ---------- customer decisions ----------
  chooseService(c) {
    const avail = this.availablePackages();
    const table = this.cfg.demand[c.type] || this.cfg.demand.regular;
    const options = Object.fromEntries(Object.entries(table).filter(([k]) => avail.includes(k)));
    if (!Object.keys(options).length) return { service: null, reason: 'package unavailable' };
    // dirtier cars lean towards better packages
    if (c.vehicle.dirt < 0.25) delete options.detailing;
    return { service: this.weighted(options) };
  }
  priceFor(c) {
    return this.packagePrice(c.service);
  }
  priceMultiplier(c) {
    return this.priceMult[c.service] ?? 1;
  }

  // ---------- jobs ----------
  onParked(bay) {
    const c = bay.customer, pkg = this.cfg.packages[c.service];
    bay.job = { pkg: c.service, dirtStart: c.vehicle.dirt, dirtEnd: this.expectedDirt(c.vehicle.dirt, pkg, bay.workerSkill), stages: pkg.stages };
  }
  expectedDirt(dirt, pkg, skill) {
    if (!pkg.exterior) return dirt;
    const clean = clamp(pkg.clean + this.equipment.clean + 0.03 * (skill - 1), 0, 1);
    return dirt * (1 - clean);
  }

  tickBays(dt) {
    for (const b of this.bays) {
      if (b.state === 'auto') {
        b.progress += dt / b.autoTotal;
        if (b.progress >= 1) { b.progress = 1; this.finishWash(b); }
      } else if (b.state === 'working') {
        // staffed job whose worker stopped (fired / off duty): the task went back on the board
        const t = this.tasks.byKey.get(b.taskKey);
        if (!t || t.state === 'open') b.state = 'waiting';
      }
    }
  }

  publishTasks() {
    if (!this.layout) return;
    for (const b of this.bays) {
      if (!b.unlocked || b.state !== 'waiting' || !b.customer || !b.job) continue;
      const c = b.customer, cid = c.id, id = b.id, pkg = this.cfg.packages[c.service];
      const speed = this.equipment.speed;
      const common = {
        dept: 'wash', priority: 10 * c.def.priority + 5, pos: this.layout.stand(id), face: this.layout.face(id),
        valid: () => this.bays[id].customer?.id === cid && (this.bays[id].state === 'waiting' || this.bays[id].state === 'working'),
      };
      if (b.mode === 'manual') {
        b.taskKey = `wash:${id}:${cid}`;
        this.tasks.publish({
          ...common, key: b.taskKey, type: 'wash', base: Math.max(1, (pkg.seconds * (1 - b.progress)) / speed),
          onStart: (emp) => { b.state = 'working'; b.workerSkill = emp.skill; b.startP = b.progress; b.job.dirtEnd = this.expectedDirt(b.job.dirtStart, pkg, emp.skill); },
          onProgress: (p) => { b.progress = b.startP + p * (1 - b.startP); },
          run: () => { b.progress = 1; this.finishWash(b); },
        });
      } else {
        b.taskKey = `wash-start:${id}:${cid}`;
        this.tasks.publish({
          ...common, key: b.taskKey, type: 'wash-start', base: this.cfg.tunnelStartSeconds,
          onStart: (emp) => { b.workerSkill = emp.skill; b.job.dirtEnd = this.expectedDirt(b.job.dirtStart, pkg, emp.skill); },
          run: () => {
            b.state = 'auto';
            b.autoTotal = pkg.seconds / (speed * this.cfg.tunnelSpeedBonus);
          },
        });
      }
    }
  }

  finishWash(b) {
    const c = b.customer, pkg = this.cfg.packages[c.service];
    const v = c.vehicle;
    const clean = pkg.exterior ? clamp(pkg.clean + this.equipment.clean + 0.03 * (b.workerSkill - 1), 0, 1) : 0;
    if (pkg.exterior) v.dirt = Math.round(v.dirt * (1 - clean) * 100) / 100;
    this.economy.expense(this.cfg.suppliesPerWash, 'supplies');
    const quality = pkg.exterior ? clamp(0.45 + clean * 0.55, 0, 1) : 0.85;
    b.job.dirtEnd = v.dirt;
    this.settle(b, { price: this.priceFor(c), quality, label: 'wash' });
    this.emit('washed', { customer: c, package: c.service, dirt: v.dirt });
  }

  // ---------- upgrades ----------
  nextBayCost() {
    return this.unlockedBays < this.cfg.maxBays ? this.cfg.bayCosts[this.unlockedBays] : null;
  }
  addBay() {
    const cost = this.nextBayCost();
    if (cost === null || !this.built || !this.economy.spend(cost, 'equipment')) return false;
    this.bays[this.unlockedBays].unlocked = true;
    this.syncParking();
    this.emit('upgraded', { what: 'bay' });
    this.emit('changed');
    this.emit('bay-free');
    return true;
  }
  nextEquipment() {
    return this.cfg.equipment[this.equipLevel] || null;
  }
  upgradeEquipment() {
    const n = this.nextEquipment();
    if (!n || !this.built || !this.economy.spend(n.cost, 'equipment')) return false;
    this.equipLevel = n.level;
    this.emit('upgraded', { what: 'equipment' });
    this.emit('changed');
    return true;
  }
  canTunnel(bayId) {
    const b = this.bays[bayId];
    return !!b && b.unlocked && b.mode === 'manual' && b.state === 'empty' && this.equipLevel >= this.cfg.tunnelMinEquipment && this.getStage() >= (this.cfg.tunnelStage || 1);
  }
  upgradeTunnel(bayId) {
    if (!this.canTunnel(bayId) || !this.economy.spend(this.cfg.tunnelCost, 'equipment')) return false;
    this.bays[bayId].mode = 'tunnel';
    this.emit('upgraded', { what: 'tunnel', bayId });
    this.emit('changed');
    return true;
  }

  serialize() {
    return {
      built: this.built, equipLevel: this.equipLevel, priceMult: this.priceMult, bays: this.unlockedBays,
      tunnels: this.bays.map((b) => b.mode === 'tunnel'), stats: this.stats,
    };
  }
}
