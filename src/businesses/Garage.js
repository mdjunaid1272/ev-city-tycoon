import { ServiceBusiness } from './ServiceBusiness.js';
import { CONDITION_KEYS } from '../vehicles/VehicleState.js';

/**
 * EV garage. Job: DIAGNOSE (mechanic + scanner) -> requirement generated -> parts consumed -> REPAIR
 * (mechanic + tools) -> vehicle condition improves -> customer pays.
 * Parts come from an inventory; a job waits ("blocked") while stock is missing and the customer's
 * patience keeps running. A manager on duty restocks automatically.
 *
 * bay states: empty -> reserved -> waiting -> diagnosing -> ready | blocked -> repairing -> done
 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// which condition component each service fixes ('general' = small boost to everything)
const COMPONENT = { brakes: 'brakes', tyres: 'tyres', motor: 'motor', battery: 'battery' };
const SERVICE_FOR = { brakes: 'brake_check', tyres: 'tyre_replace', motor: 'motor_service', battery: 'battery_replace' };

export class Garage extends ServiceBusiness {
  constructor(o) {
    super({ ...o, id: 'garage', cfg: o.cfg.garage, saved: o.saved });
    const s = o.saved || {};
    this.scannerLevel = s.scannerLevel || 1;
    this.toolLevel = s.toolLevel || 1;
    this.batteryStation = !!s.batteryStation;
    this.priceMult = s.priceMult ?? 1;
    this.autoRestock = s.autoRestock ?? true;
    this.stock = {};
    for (const [k, p] of Object.entries(this.cfg.parts)) this.stock[k] = s.stock?.[k] ?? p.stock;
    this.restockTimer = 0;
    const unlocked = s.lifts || 1;
    this.bays = Array.from({ length: this.cfg.maxBays }, (_, i) => ({
      id: i, unlocked: i < unlocked, state: 'empty', customer: null, vehicle: null, space: null, job: null, progress: 0, released: false,
    }));
    this.initParking();
  }

  get scanner() { return this.cfg.scanner[this.scannerLevel - 1]; }
  get tools() { return this.cfg.tools[this.toolLevel - 1]; }
  servicePrice(key) {
    return Math.round(this.cfg.services[key].price * this.priceMult * 100) / 100;
  }
  setPriceMult(m) {
    if (!Number.isFinite(m)) return;
    this.priceMult = Math.round(clamp(m, 0.5, 2) * 20) / 20;
    this.emit('changed');
  }
  priceMultiplier() { return this.priceMult; }

  /** Equipment (not staff) requirements. */
  equipmentOk(key) {
    const s = this.cfg.services[key];
    return this.scannerLevel >= s.scanner && (!s.needsBatteryStation || this.batteryStation);
  }
  /** Highest mechanic skill currently on duty (0 if none). */
  get mechanicSkill() {
    return this.emp.employees.filter((e) => e.role === 'mechanic' && this.emp.onDuty(e)).reduce((m, e) => Math.max(m, e.skill), 0);
  }
  hasParts(key) {
    return Object.entries(this.cfg.services[key].parts).every(([p, n]) => this.stock[p] >= n);
  }

  // ---------- customer decisions ----------
  /** What the owner thinks is wrong with a car, from its component condition. */
  symptomsFor(v) {
    const list = [];
    for (const k of CONDITION_KEYS) if (v.condition[k] < 60) list.push([SERVICE_FOR[k] || null, 3 + (60 - v.condition[k]) / 15, k]);
    return list.filter(([s]) => s);
  }

  chooseService(c) {
    const options = {};
    for (const [svc, w] of this.symptomsFor(c.vehicle).map(([s, w]) => [s, w])) if (this.equipmentOk(svc)) options[svc] = (options[svc] || 0) + w;
    if (c.vehicle.condition.battery < 70 && this.equipmentOk('battery_diag')) options.battery_diag = (options.battery_diag || 0) + 2;
    // otherwise a routine visit
    for (const k of ['general_maint', 'brake_check', 'battery_diag']) options[k] = (options[k] || 0) + (Object.keys(options).length ? 0.6 : 2);
    return { service: this.weighted(options) };
  }
  priceFor(c) {
    return this.servicePrice(c.service);
  }

  // ---------- job flow ----------
  onParked(bay) {
    const c = bay.customer;
    bay.job = { service: c.service, actual: c.service, phase: 'diagnose', price: this.servicePrice(c.service), partsUsed: false, refused: false, requirement: null };
    bay.progress = 0;
  }

  tickBays(dt) {
    for (const b of this.bays) {
      if (!b.unlocked || !b.job) continue;
      if (b.state === 'diagnosing' || b.state === 'repairing') {
        const t = this.tasks.byKey.get(b.taskKey);
        if (!t || t.state === 'open') b.state = b.state === 'diagnosing' ? 'waiting' : 'ready'; // worker left the job
      } else if (b.state === 'blocked' && this.hasParts(b.job.actual)) {
        b.state = 'ready';
        b.customer.state = 'waiting';
      }
    }
    this.restockTimer -= dt;
    if (this.autoRestock && this.emp.hasManager && this.restockTimer <= 0) { this.restockTimer = 4; this.autoRestockParts(); }
  }

  /** Manager keeps the shelves stocked: buy what is empty or needed by a blocked job. */
  autoRestockParts() {
    for (const [k, p] of Object.entries(this.cfg.parts)) {
      const needed = this.bays.some((b) => b.job && b.state === 'blocked' && this.cfg.services[b.job.actual].parts[k]);
      if ((this.stock[k] <= 0 && k !== 'battery') || needed) this.buyPart(k, Math.min(2, p.max - this.stock[k]));
    }
  }

  publishTasks() {
    if (!this.layout) return;
    for (const b of this.bays) {
      if (!b.unlocked || !b.customer || !b.job) continue;
      const c = b.customer, cid = c.id, id = b.id, j = b.job;
      const common = { dept: 'garage', priority: 10 * c.def.priority + 5, pos: this.layout.stand(id), face: this.layout.face(id) };
      if (b.state === 'waiting') {
        const svc = this.cfg.services[j.service];
        b.taskKey = `diag:${id}:${cid}`;
        this.tasks.publish({
          ...common, key: b.taskKey, type: 'diagnose', minSkill: 1,
          base: Math.max(1, svc.diag / this.scanner.diagSpeed),
          valid: () => this.bays[id].customer?.id === cid && (this.bays[id].state === 'waiting' || this.bays[id].state === 'diagnosing'),
          onStart: () => { b.state = 'diagnosing'; b.progress = 0; },
          onProgress: (p) => { b.progress = p; },
          run: () => this.afterDiagnosis(b),
        });
      } else if (b.state === 'ready') {
        const svc = this.cfg.services[j.actual];
        b.taskKey = `repair:${id}:${cid}`;
        this.tasks.publish({
          ...common, key: b.taskKey, type: 'repair', minSkill: svc.skill,
          base: Math.max(1, svc.repair / this.tools.speed),
          valid: () => this.bays[id].customer?.id === cid && (this.bays[id].state === 'ready' || this.bays[id].state === 'repairing') && (j.partsUsed || this.hasParts(j.actual)),
          onStart: () => { this.consumeParts(b); b.state = 'repairing'; b.progress = 0; },
          onProgress: (p) => { b.progress = p; },
          run: () => this.finishRepair(b),
        });
      }
    }
  }

  consumeParts(b) {
    const j = b.job;
    if (j.partsUsed) return;
    for (const [p, n] of Object.entries(this.cfg.services[j.actual].parts)) {
      this.stock[p] -= n;
      this.economy.expense(this.cfg.parts[p].cost * n, 'parts'); // parts are an expense when used
    }
    j.partsUsed = true;
    this.emit('parts-changed');
  }

  /** Diagnosis done: generate the actual repair requirement (may differ from the symptom). */
  afterDiagnosis(b) {
    const c = b.customer, j = b.job, v = c.vehicle;
    b.progress = 1;
    if (j.service === 'battery_diag') {
      // diagnostics reveal the battery state; a weak battery can be upsold into a replacement
      if (v.condition.battery < 50 && this.equipmentOk('battery_replace') && this.mechanicSkill >= this.cfg.services.battery_replace.skill
        && Math.random() < 0.6 && this.priceMult <= 1.5) {
        j.requirement = 'Weak battery found: replacement recommended';
        j.actual = 'battery_replace';
        j.price = this.servicePrice('battery_diag') + this.servicePrice('battery_replace');
        return this.queueRepair(b);
      }
      j.requirement = v.condition.battery < 50 ? 'Battery weak (replacement not available)' : 'Battery healthy';
      return this.finishDiagOnly(b);
    }
    // 20%: the mechanic finds a different, worse problem than the owner reported
    let actual = j.service;
    const worst = CONDITION_KEYS.map((k) => [k, v.condition[k]]).sort((a, z) => a[1] - z[1])[0];
    if (worst[1] < 55 && Math.random() < 0.2 && SERVICE_FOR[worst[0]]) actual = SERVICE_FOR[worst[0]];
    const svc = this.cfg.services[actual];
    j.actual = actual;
    j.price = this.servicePrice(actual);
    j.requirement = `${svc.label}${actual !== j.service ? ' (found during diagnosis)' : ''}`;
    // cannot service: missing equipment or no mechanic with the skill
    if (!this.equipmentOk(actual) || this.mechanicSkill < svc.skill) {
      j.refused = true;
      j.requirement += ' - cannot service';
      return this.refuse(b);
    }
    return this.queueRepair(b);
  }

  queueRepair(b) {
    const j = b.job;
    b.progress = 0;
    if (this.hasParts(j.actual)) b.state = 'ready';
    else {
      b.state = 'blocked';
      b.customer.state = 'blocked';
      this.emit('parts-missing', { service: j.actual });
    }
    this.emit('changed');
  }

  finishDiagOnly(b) {
    this.settle(b, { price: this.servicePrice('battery_diag'), quality: 0.75, label: 'diag' });
    this.emit('serviced', { customer: b.customer, service: 'battery_diag' });
  }

  /** Customer is told the shop cannot do the job: pays only the diagnostic fee and leaves unhappy. */
  refuse(b) {
    const fee = this.cfg.diagnosticFee;
    this.settle(b, { price: fee / b.customer.def.payMult, quality: 0.2, label: 'fee', extra: -20 });
    this.emit('refused', { customer: b.customer });
  }

  finishRepair(b) {
    const c = b.customer, j = b.job, v = c.vehicle, svc = this.cfg.services[j.actual];
    if (svc.repairs === 'general') for (const k of CONDITION_KEYS) v.condition[k] = Math.min(100, v.condition[k] + 18);
    else if (COMPONENT[svc.repairs]) v.condition[COMPONENT[svc.repairs]] = 100;
    if (j.actual === 'battery_replace') v.condition.battery = 100;
    b.progress = 1;
    this.settle(b, { price: j.price, quality: 1, label: 'repair' });
    this.emit('serviced', { customer: c, service: j.actual });
  }

  // ---------- inventory & upgrades ----------
  buyPart(key, qty = 1) {
    const p = this.cfg.parts[key];
    qty = Math.min(qty, p ? p.max - this.stock[key] : 0);
    if (!p || qty <= 0 || !this.economy.spend(p.cost * qty, 'parts')) return false;
    this.stock[key] += qty;
    this.emit('parts-changed');
    this.emit('changed');
    return true;
  }
  nextLiftCost() { return this.unlockedBays < this.cfg.maxBays ? this.cfg.bayCosts[this.unlockedBays] : null; }
  addLift() {
    const cost = this.nextLiftCost();
    if (cost === null || !this.built || !this.economy.spend(cost, 'equipment')) return false;
    this.bays[this.unlockedBays].unlocked = true;
    this.syncParking();
    this.emit('upgraded', { what: 'lift' });
    this.emit('changed');
    this.emit('bay-free');
    return true;
  }
  upgrade(kind) {
    if (!this.built) return false;
    if (kind === 'scanner') {
      const n = this.cfg.scanner[this.scannerLevel];
      if (!n || !this.economy.spend(n.cost, 'equipment')) return false;
      this.scannerLevel = n.level;
    } else if (kind === 'tools') {
      const n = this.cfg.tools[this.toolLevel];
      if (!n || !this.economy.spend(n.cost, 'equipment')) return false;
      this.toolLevel = n.level;
    } else if (kind === 'battery') {
      if (this.batteryStation || !this.economy.spend(this.cfg.batteryStationCost, 'equipment')) return false;
      this.batteryStation = true;
    } else return false;
    this.emit('upgraded', { what: kind });
    this.emit('changed');
    return true;
  }

  serialize() {
    return {
      built: this.built, scannerLevel: this.scannerLevel, toolLevel: this.toolLevel, batteryStation: this.batteryStation,
      priceMult: this.priceMult, autoRestock: this.autoRestock, stock: this.stock, lifts: this.unlockedBays, stats: this.stats,
    };
  }
}
