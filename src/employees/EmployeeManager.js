/**
 * Employees (pure simulation, no Three.js).
 *
 * Roster: hire / fire / train / assign / pay salaries.
 * AI (per employee state machine):
 *   idle -> find task -> move -> perform -> complete -> idle        (+ recover when blocked / task invalid)
 *   arriving (walks in after hiring), return (walks back to its post), leaving (fired), offduty
 * Tasks come from the central TaskManager; reservation prevents duplicate work.
 *
 * Departments: charging (attendants), wash (washers), garage (mechanics). Managers and cashiers are
 * business-wide bonuses and can be stationed in any built facility. Each facility registers its own
 * walkable grid, posts, door and break spot with registerFacility().
 */
let seq = 0;
const rnd = (a, b) => a + Math.random() * (b - a);
const BODY_R = 0.28; // staff body radius (smaller than the nav grid's 0.5 clearance, so planned paths are never pushed)
const TASK_DEPT = { attendant: 'charging', washer: 'wash', mechanic: 'garage', barista: 'cafe' };

export class EmployeeManager {
  constructor({ bus, economy, tasks, config, getReputation, getCapacity, saved = null }) {
    this.bus = bus;
    this.economy = economy;
    this.tasks = tasks;
    this.cfg = config;
    this.getReputation = getReputation || (() => 0);
    this.getCapacity = getCapacity || (() => 2);
    this.facilities = {}; // dept -> {nav, posts, door, breakSpot, built():bool, label}
    this.employees = [];
    this.candidates = [];
    this.pendingSave = saved;
    this.stats = { hired: 0, fired: 0, quit: 0, payroll: 0 };
    this.efficiencyLevel = Math.max(0, Math.min((config.efficiencyProgram || []).length, Math.floor(Number(saved?.efficiencyLevel) || 0))); // team training program (see efficiencyBonus)
    if (saved?.stats) Object.assign(this.stats, saved.stats);
  }

  /** Called by each facility view when its lot exists (charging at start, wash/garage when built). */
  registerFacility(dept, f) {
    this.facilities[dept] = f;
    // restore employees that belong to this facility
    const saved = this.pendingSave?.employees?.filter((d) => (d.home || TASK_DEPT[d.role] || 'charging') === dept && !this.employees.some((e) => e.id === d.id));
    for (const d of saved || []) this.employees.push(this.fromSave(d, dept));
    if (!this.candidates.length) this.refreshCandidates();
  }
  facilityBuilt(dept) {
    return !!this.facilities[dept] && this.facilities[dept].built();
  }
  roleAvailable(role) {
    const def = this.cfg.roles[role];
    return def.available || (!!def.facility && this.facilityBuilt(def.facility));
  }
  deptAvailable(dept) {
    if (dept === 'off') return true;
    return this.facilityBuilt(dept);
  }
  homeOf(e) {
    return e.home || TASK_DEPT[e.role] || 'charging';
  }
  /** Charging locations: the home station and every charging hub. Attendants can work at any of them. */
  isChargingDept(k) {
    return k === 'charging' || String(k).startsWith('hub_');
  }
  /** Department whose tasks this employee picks up. */
  taskDept(e) {
    return e.role === 'attendant' ? this.homeOf(e) : TASK_DEPT[e.role];
  }
  /** Facilities this employee could be stationed at (built ones only). */
  eligibleDepts(e) {
    const built = Object.keys(this.facilities).filter((k) => this.facilityBuilt(k));
    if (e.role === 'attendant') return built.filter((k) => this.isChargingDept(k));
    if (TASK_DEPT[e.role]) return built.filter((k) => k === TASK_DEPT[e.role]);
    return built; // managers and cashiers help anywhere
  }
  /** Move to the next eligible facility. */
  transfer(id) {
    const e = this.employees.find((x) => x.id === id);
    if (!e || e.leaving) return false;
    const list = this.eligibleDepts(e);
    if (list.length < 2) return false;
    const cur = this.homeOf(e);
    const next = list[(list.indexOf(cur) + 1) % list.length];
    return this.assign(id, next);
  }
  fac(e) {
    return this.facilities[this.homeOf(e)];
  }

  // ---------- derived values ----------
  get maxStaff() {
    return Math.max(this.cfg.minStaff, this.getCapacity());
  }
  onDuty(e) {
    return e.dept !== 'off' && !e.leaving;
  }
  /** Experience: +2% speed per 60 xp, max +20%. */
  level(e) {
    return Math.min(10, Math.floor(e.xp / 60));
  }
  speed(e) {
    return (0.7 + 0.15 * e.skill) * (1 + this.level(e) * 0.02) * e.eff * (1 + this.efficiencyBonus) * (e.unpaidDays ? 0.6 : 1);
  }
  // ---------- team training program ----------
  /** Speed bonus of the whole team from the training program (0 .. 0.15). */
  get efficiencyBonus() {
    const lv = this.cfg.efficiencyProgram || [];
    return this.efficiencyLevel > 0 ? lv[this.efficiencyLevel - 1].bonus : 0;
  }
  nextEfficiency() { return (this.cfg.efficiencyProgram || [])[this.efficiencyLevel] || null; }
  buyEfficiency() {
    const n = this.nextEfficiency();
    if (!n) return { ok: false, reason: 'Fully trained' };
    if (!this.economy.spend(n.cost, 'training')) return { ok: false, reason: 'Not enough cash' };
    this.efficiencyLevel++;
    this.bus.emit('employee:changed');
    return { ok: true };
  }

  // ---------- workload ----------
  /** Open work in one department: tasks that are waiting, taken or being worked on, against the staff that can do them. */
  workload(dept) {
    let tasks = 0;
    for (const t of this.tasks.tasks.values()) if (t.dept === dept && t.state !== 'done' && t.state !== 'cancelled') tasks++;
    const staff = this.employees.filter((e) => !e.leaving && e.dept !== 'off' && this.taskDept(e) === dept).length;
    return { dept, tasks, staff, perStaff: staff ? tasks / staff : tasks * 2 };
  }

  /** Department with the highest work per employee among those an employee of this role may work in (built ones). */
  busiestDept(role, fallback) {
    const probe = { role, home: fallback, dept: fallback, leaving: false };
    const list = this.eligibleDepts(probe);
    if (list.length < 2) return fallback;
    let best = fallback, score = -1;
    for (const d of list) {
      const w = this.workload(d);
      const s = w.tasks / (w.staff + 1); // load per employee once the new one has joined
      if (s > score + 1e-9) { best = d; score = s; }
    }
    return best;
  }

  /**
   * Move idle, flexible staff (attendants, managers, cashiers) to where the work is. An employee only moves when the other
   * place is clearly busier, and never leaves a department that still has open work empty. Returns how many moved.
   */
  balance() {
    let moved = 0;
    for (const e of [...this.employees]) {
      if (e.leaving || e.dept === 'off' || e.state !== 'idle' || e.task) continue;
      if (!['attendant', 'manager', 'cashier'].includes(e.role)) continue;
      const list = this.eligibleDepts(e);
      if (list.length < 2) continue;
      const cur = this.homeOf(e), here = this.workload(cur);
      const others = list.filter((d) => d !== cur).map((d) => this.workload(d)).sort((a, b) => b.perStaff - a.perStaff);
      const best = others[0];
      if (!best || best.tasks === 0) continue;
      const stays = here.staff - 1;
      if (stays <= 0 && here.tasks > 0) continue; // do not abandon a department that has work
      const loadHere = stays > 0 ? here.tasks / stays : 0;
      if (best.perStaff < loadHere + 1) continue; // not clearly busier
      if (this.assign(e.id, best.dept)) moved++;
    }
    return moved;
  }

  /** What an employee is doing right now, in words (for the Staff board). */
  describe(e) {
    if (e.leaving) return 'Leaving';
    if (e.dept === 'off') return 'Off duty';
    const t = e.task;
    const what = t ? ({ connect: 'Connecting a car', unplug: 'Unplugging a car', wash: 'Washing a car', 'wash-start': 'Starting the tunnel', diagnose: 'Diagnosing a car', repair: 'Repairing a car', 'cafe-order': 'Preparing an order' }[t.type] || 'Working') : null;
    if (e.state === 'perform') return what || 'Working';
    if (e.state === 'move') return 'Heading to task' + (what ? ': ' + what.toLowerCase() : '');
    if (e.state === 'idle') return 'Waiting for work';
    return ({ complete: 'Finishing', recover: 'Re-planning route', arriving: 'Starting shift', return: 'Back to post', offduty: 'Going on break' }[e.state]) || e.state;
  }

  /** Best on-duty manager's team bonus (0 if none). */
  get teamBonus() {
    const m = this.employees.filter((e) => e.role === 'manager' && this.onDuty(e)).sort((a, b) => b.skill - a.skill)[0];
    return m ? this.cfg.managerBonusBase + this.cfg.managerBonusPerSkill * m.skill : 0;
  }
  get hasManager() {
    return this.teamBonus > 0;
  }
  workMult(e) {
    return this.speed(e) * (1 + this.teamBonus);
  }
  /** Cashier adds satisfaction to every customer. */
  get satisfactionBonus() {
    const c = this.employees.filter((e) => e.role === 'cashier' && this.onDuty(e)).sort((a, b) => b.skill - a.skill)[0];
    return c ? this.cfg.cashierSatisfactionBase + this.cfg.cashierSatisfactionPerSkill * c.skill : 0;
  }
  get dailyPayroll() {
    return this.employees.filter((e) => !e.leaving).reduce((s, e) => s + e.salary, 0);
  }
  trainCost(e) {
    return this.cfg.trainCostPerSkill * e.skill;
  }
  hireCost(skill) {
    return this.cfg.hireCostBase + (skill - 1) * this.cfg.hireCostPerSkill;
  }
  countByDept(dept) {
    return this.employees.filter((e) => !e.leaving && this.homeOf(e) === dept).length;
  }

  // ---------- candidates & hiring ----------
  makeCandidate() {
    const roles = Object.entries(this.cfg.roles).filter(([k]) => this.roleAvailable(k));
    let r = Math.random() * roles.reduce((s, [, d]) => s + d.weight, 0);
    let role = roles[0][0];
    for (const [k, d] of roles) if ((r -= d.weight) <= 0) { role = k; break; }
    const def = this.cfg.roles[role];
    const maxSkill = Math.min(this.cfg.maxSkill, 2 + Math.floor(this.getReputation() / 25));
    const minSkill = Math.min(maxSkill, def.minSkill || 1);
    const skill = Math.min(maxSkill, minSkill + Math.floor(Math.random() * (maxSkill - minSkill + 1)));
    const taken = new Set([...this.employees, ...this.candidates].map((e) => e.name));
    const names = this.cfg.firstNames.filter((n) => !taken.has(n));
    const pool = names.length ? names : this.cfg.firstNames;
    return {
      id: `cand${++seq}`, name: pool[Math.floor(Math.random() * pool.length)],
      role, skill, eff: Math.round(rnd(0.9, 1.15) * 100) / 100,
      salary: Math.round(this.cfg.salaryBase + this.cfg.salaryPerSkill * skill + rnd(0, 20)),
      cost: this.hireCost(skill),
    };
  }

  refreshCandidates(paid = false) {
    if (paid && !this.economy.spend(this.cfg.refreshCandidatesCost, 'hiring')) return false;
    this.candidates = [];
    for (let i = 0; i < this.cfg.candidateCount; i++) this.candidates.push(this.makeCandidate());
    // make sure unlocked specialist roles can actually be found
    for (const role of ['washer', 'mechanic']) {
      if (this.roleAvailable(role) && !this.candidates.some((c) => c.role === role)) {
        const c = this.makeCandidate(); c.role = role;
        c.skill = Math.max(c.skill, this.cfg.roles[role].minSkill || 1);
        c.cost = this.hireCost(c.skill);
        this.candidates[this.candidates.length - 1] = c;
      }
    }
    this.bus.emit('employee:changed');
    return true;
  }

  /** Which department a new hire starts in. */
  startDept(role) {
    const d = TASK_DEPT[role];
    if (d && role !== 'attendant') return d;
    const first = d || ['charging', 'wash', 'garage'].find((x) => this.facilityBuilt(x)) || 'charging';
    return this.busiestDept(role, first); // attendants / managers / cashiers start where the workload is highest
  }

  hire(candId) {
    const c = this.candidates.find((x) => x.id === candId);
    if (!c) return { ok: false, reason: 'Candidate no longer available' };
    if (this.employees.filter((e) => !e.leaving).length >= this.maxStaff) return { ok: false, reason: `Staff limit reached (${this.maxStaff}). Build more bays to grow your team.` };
    if (!this.roleAvailable(c.role)) return { ok: false, reason: 'Role not unlocked yet' };
    const home = this.startDept(c.role);
    if (!this.facilityBuilt(home)) return { ok: false, reason: 'That facility is not built yet' };
    if (!this.economy.spend(c.cost, 'hiring')) return { ok: false, reason: 'Not enough cash' };
    this.candidates.splice(this.candidates.indexOf(c), 1);
    const e = {
      id: `e${++seq}`, name: c.name, role: c.role, skill: c.skill, eff: c.eff, salary: c.salary, xp: 0, tasksDone: 0, unpaidDays: 0,
      dept: home, home, leaving: false, ...this.runtime(home),
    };
    this.employees.push(e);
    this.stats.hired++;
    this.walkTo(e, this.postFor(e), 'arriving', { x: this.facilities[home].door.x, z: this.facilities[home].door.z });
    this.bus.emit('employee:hired', { employee: e });
    this.bus.emit('employee:changed');
    return { ok: true, employee: e };
  }

  runtime(home) {
    const door = this.facilities[home]?.door || { x: 0, z: 0 };
    return { pos: { x: door.x, z: door.z }, yaw: 0, state: 'idle', path: [], pi: 0, task: null, timer: 0, duration: 0, idleT: 0, findT: 0, stuckT: 0, lastX: 0, lastZ: 0, fails: 0, post: null, gone: false };
  }

  fromSave(d, home) {
    const e = { ...d, home, ...this.runtime(home), leaving: false };
    const p = this.postFor(e);
    e.pos = { x: p.x, z: p.z };
    e.post = p;
    return e;
  }

  postFor(e) {
    const f = this.fac(e);
    const mine = this.employees.filter((x) => x !== e && this.homeOf(x) === this.homeOf(e));
    const used = new Set(mine.map((x) => x.post && `${x.post.x},${x.post.z}`));
    return f.posts.find((p) => !used.has(`${p.x},${p.z}`)) || f.posts[0];
  }

  fire(id) {
    const e = this.employees.find((x) => x.id === id);
    if (!e || e.leaving) return false;
    if (e.task) this.tasks.release(e.task, 'fired');
    e.task = null;
    this.economy.spend(e.salary, 'salaries'); // one day severance, only if affordable
    e.leaving = true;
    this.stats.fired++;
    this.walkTo(e, this.fac(e).door, 'leaving');
    this.bus.emit('employee:fired', { employee: e });
    this.bus.emit('employee:changed');
    return true;
  }

  assign(id, dept) {
    const e = this.employees.find((x) => x.id === id);
    if (!e || e.leaving) return false;
    if (dept !== 'off') {
      if (!this.deptAvailable(dept)) return false;
      const fixed = TASK_DEPT[e.role];
      if (e.role === 'attendant') { if (!this.isChargingDept(dept)) return false; } // attendants work at charging locations
      else if (fixed && dept !== fixed) return false; // washers / mechanics stay in their own department
    }
    if (e.task) { this.tasks.release(e.task, 'reassigned'); e.task = null; }
    if (dept === 'off') {
      e.dept = 'off';
      this.walkTo(e, this.fac(e).breakSpot, 'offduty');
    } else {
      const moving = dept !== this.homeOf(e);
      e.dept = dept;
      if (moving) { // managers / cashiers commute to the other facility
        e.home = dept;
        const door = this.facilities[dept].door;
        e.pos = { x: door.x, z: door.z };
        e.post = null;
        e.post = this.postFor(e);
        this.walkTo(e, e.post, 'arriving', door);
      } else this.walkTo(e, e.post || this.postFor(e), 'return');
    }
    this.bus.emit('employee:changed');
    return true;
  }

  train(id) {
    const e = this.employees.find((x) => x.id === id);
    if (!e || e.skill >= this.cfg.maxSkill) return false;
    if (!this.economy.spend(this.trainCost(e), 'training')) return false;
    e.skill++;
    e.salary = Math.round(e.salary + this.cfg.salaryPerSkill * 0.7);
    this.bus.emit('employee:trained', { employee: e });
    this.bus.emit('employee:changed');
    return true;
  }

  /** Daily settlement: salaries (booked through the economy) + fresh candidates. */
  paySalaries() {
    for (const e of [...this.employees]) {
      if (e.leaving) continue;
      if (this.economy.canAfford(e.salary)) { this.economy.spend(e.salary, 'salaries'); e.unpaidDays = 0; }
      else {
        this.economy.expense(e.salary, 'salaries'); // always booked; cash is floored at 0
        e.unpaidDays++;
        if (e.unpaidDays >= 3) { this.bus.emit('employee:quit', { employee: e }); this.fire(e.id); this.stats.quit++; }
      }
    }
    this.stats.payroll = this.dailyPayroll;
    this.refreshCandidates();
  }

  // ---------- AI ----------
  walkTo(e, goal, state, from = null) {
    if (from) { e.pos.x = from.x; e.pos.z = from.z; }
    const path = this.fac(e).nav.findPath(e.pos, goal);
    e.path = path || [{ x: goal.x, z: goal.z }];
    e.pi = 0;
    e.state = state;
    e.goal = goal;
    e.stuckT = 0; e.lastX = e.pos.x; e.lastZ = e.pos.z;
    if (state === 'arriving' || state === 'return') e.post = goal;
  }

  /** Move along e.path. Returns true when the end is reached. */
  follow(e, dt, speedMult = 1) {
    const wp = e.path[e.pi];
    if (!wp) return true;
    const dx = wp.x - e.pos.x, dz = wp.z - e.pos.z, d = Math.hypot(dx, dz);
    const step = this.cfg.walkSpeed * speedMult * dt;
    e.yaw = Math.atan2(-dx, -dz);
    e.moving = true;
    // a body that was pushed off its path by a solid object counts as arrived when it is close enough
    if (d <= step || (e.pushed && d <= 0.45 && e.pi >= e.path.length - 1)) {
      e.pos.x = wp.x; e.pos.z = wp.z; e.pi++;
      return e.pi >= e.path.length;
    }
    e.pos.x += (dx / d) * step;
    e.pos.z += (dz / d) * step;
    return false;
  }

  update(dt) {
    this.tasks.validate();
    for (const e of [...this.employees]) {
      e.moving = false;
      this.step(e, dt);
      if (e.gone) { this.employees.splice(this.employees.indexOf(e), 1); continue; }
      this.collide(e);
    }
    this.separate();
  }

  /** Staff are solid: they cannot stand inside buildings, props, chargers, cars or the player. */
  collide(e) {
    const c = this.colliders;
    if (!c) return;
    const x0 = e.pos.x, z0 = e.pos.z;
    const p = this.tmp || (this.tmp = { x: 0, z: 0 });
    p.x = x0; p.z = z0;
    c.resolveCircle(p, BODY_R);
    c.resolveVehicles(p, BODY_R);
    if (this.player && !e.leaving) {
      const dx = p.x - this.player.x, dz = p.z - this.player.z, d = Math.hypot(dx, dz), m = BODY_R + 0.42;
      if (d < m && d > 1e-4) { p.x = this.player.x + (dx / d) * m; p.z = this.player.z + (dz / d) * m; }
    }
    e.pushed = Math.hypot(p.x - x0, p.z - z0) > 1e-4;
    if (e.pushed) { c.resolveCircle(p, BODY_R); e.pos.x = p.x; e.pos.z = p.z; }
  }

  /** Two staff members never overlap: they push each other apart. */
  separate() {
    const list = this.employees;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz, m = BODY_R * 2;
        if (d2 >= m * m) continue;
        const d = Math.sqrt(d2) || 1e-4, push = (m - d) / 2;
        const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
        if (this.colliders) { this.colliders.resolveCircle(a.pos, BODY_R); this.colliders.resolveCircle(b.pos, BODY_R); }
        a.pushed = b.pushed = true;
      }
    }
  }

  step(e, dt) {
    switch (e.state) {
      case 'arriving': case 'return':
        if (this.follow(e, dt)) { e.state = 'idle'; e.idleT = 0; }
        break;
      case 'offduty':
        if (e.dept !== 'off') this.walkTo(e, e.post || this.postFor(e), 'return');
        else this.follow(e, dt);
        break;
      case 'leaving':
        if (this.follow(e, dt)) { e.gone = true; this.bus.emit('employee:changed'); }
        break;
      case 'idle':
        e.idleT += dt;
        if (e.dept === 'off') { this.walkTo(e, this.fac(e).breakSpot, 'offduty'); break; }
        if (TASK_DEPT[e.role]) {
          e.findT -= dt;
          if (e.findT <= 0) { e.findT = 0.4; this.findTask(e); }
        }
        // go back to the post if standing somewhere else
        if (e.state === 'idle' && e.idleT > 1.5 && e.post && Math.hypot(e.pos.x - e.post.x, e.pos.z - e.post.z) > 0.6) this.walkTo(e, e.post, 'return');
        break;
      case 'move': {
        const t = e.task;
        if (!t || !t.valid()) { this.recover(e, 'task invalid'); break; }
        const done = this.follow(e, dt);
        // blocked detection
        e.stuckT += dt;
        if (e.stuckT > 1.2) {
          if (Math.hypot(e.pos.x - e.lastX, e.pos.z - e.lastZ) < 0.25) { this.recover(e, 'blocked'); break; }
          e.stuckT = 0; e.lastX = e.pos.x; e.lastZ = e.pos.z;
        }
        if (done) {
          this.tasks.start(t);
          e.state = 'perform'; e.timer = 0; e.duration = t.base;
          if (t.face) e.yaw = Math.atan2(-(t.face.x - e.pos.x), -(t.face.z - e.pos.z));
          t.onStart?.(e);
        }
        break;
      }
      case 'perform': {
        const t = e.task;
        if (!t || !t.valid() || e.dept === 'off') { this.recover(e, 'task invalid'); break; }
        e.timer += dt * this.workMult(e);
        t.onProgress?.(Math.min(1, e.timer / e.duration));
        if (e.timer >= e.duration) e.state = 'complete';
        break;
      }
      case 'complete': {
        const t = e.task;
        if (t && t.valid()) {
          t.run();
          e.tasksDone++;
          e.xp += 12;
          this.bus.emit('employee:task-complete', { employee: e, task: t });
        }
        if (t) this.tasks.complete(t);
        e.task = null;
        e.state = 'idle';
        e.idleT = 0;
        e.fails = 0;
        break;
      }
      case 'recover':
        // path was blocked / task vanished: give the task back and re-plan from here
        e.fails++;
        if (e.task && e.task.valid() && e.fails <= 3) {
          const path = this.fac(e).nav.findPath(e.pos, e.task.pos);
          if (path) { e.path = path; e.pi = 0; e.state = 'move'; e.stuckT = 0; e.lastX = e.pos.x; e.lastZ = e.pos.z; break; }
        }
        if (e.task) { this.tasks.release(e.task, 'recover'); e.task = null; }
        e.state = 'idle'; e.idleT = 0; e.fails = 0;
        break;
      default: e.state = 'idle';
    }
  }

  findTask(e) {
    const dept = this.taskDept(e);
    const t = this.tasks.request({ id: e.id, dept, pos: e.pos, canDo: (task) => e.skill >= (task.minSkill || 1) });
    if (!t) return;
    e.task = t;
    const path = this.fac(e).nav.findPath(e.pos, t.pos);
    if (!path) { this.tasks.release(t, 'no path'); e.task = null; return; }
    e.path = path; e.pi = 0; e.state = 'move'; e.stuckT = 0; e.lastX = e.pos.x; e.lastZ = e.pos.z;
  }

  recover(e) {
    e.state = 'recover';
  }

  serialize() {
    const live = this.employees.filter((e) => !e.leaving);
    // employees of facilities that are not registered yet must not be lost
    const keep = (this.pendingSave?.employees || []).filter((d) => !this.facilities[d.home || TASK_DEPT[d.role] || 'charging']);
    return {
      employees: [...live.map((e) => ({ id: e.id, name: e.name, role: e.role, skill: e.skill, eff: e.eff, salary: e.salary, xp: e.xp, tasksDone: e.tasksDone, unpaidDays: e.unpaidDays, dept: e.dept, home: this.homeOf(e) })), ...keep],
      stats: this.stats,
      efficiencyLevel: this.efficiencyLevel,
    };
  }
}
