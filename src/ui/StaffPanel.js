import { esc, money } from './uiShared.js';

/**
 * Staff board and staff actions.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const StaffPanel = {
  tplStaff() {
    const m = this.employees, eco = this.economy, cfg = m.cfg;
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(cfg.maxSkill - n);
    const emps = m.employees.filter((e) => !e.leaving).map((e) => {
      const def = cfg.roles[e.role], tc = m.trainCost(e), lv = m.level(e);
      const doing = m.describe(e);
      const status = e.dept === 'off' ? '<span class="tag">Off duty</span>' : e.state === 'perform' || e.state === 'move' ? `<span class="tag busy">${esc(doing)}</span>` : `<span class="tag on">${esc(doing)}</span>`;
      const xpPct = ((e.xp % 60) / 60) * 100;
      const place = e.dept === 'off' ? 'Off duty' : (m.facilities[m.homeOf(e)]?.label || m.homeOf(e));
      return `<div class="emp ${e.dept === 'off' ? 'off' : ''}">
        <div class="emp-h"><span class="avatar">${def.icon}</span><span class="who"><b>${esc(e.name)}</b><small>${esc(def.label)}</small></span>${status}<span class="stars">${stars(e.skill)}</span></div>
        <div class="emp-grid"><div>Salary<b>${money(e.salary)}/day</b></div><div>Assignment<b>${esc(place)}</b></div><div>Productivity<b>${Math.round(m.workMult(e) * 100)}%</b></div></div>
        <div class="emp-s">Level <b>${lv}</b> · <b>${e.tasksDone}</b> tasks done${e.unpaidDays ? ' · <b style="color:var(--err)">salary unpaid!</b>' : ''}</div>
        <div class="prog" style="height:6px;margin-bottom:8px"><i style="width:${lv >= 10 ? 100 : xpPct}%"></i></div>
        <div class="emp-b">
          ${e.skill < cfg.maxSkill ? `<button class="btn" data-emp-act="train:${e.id}" ${eco.canAfford(tc) ? '' : 'disabled'}>Upgrade skill · ${money(tc)}</button>` : ''}
          ${m.eligibleDepts(e).length > 1 ? `<button class="btn ghost" data-emp-act="move:${e.id}">Change workplace</button>` : ''}
          <button class="btn ghost" data-emp-act="duty:${e.id}">${e.dept === 'off' ? 'Put on duty' : 'Off duty'}</button>
          <button class="btn danger" data-emp-act="fire:${e.id}">Fire</button>
        </div></div>`;
    }).join('') || '<div class="sub">No employees yet. You are doing everything by hand: hire an attendant below.</div>';
    const cands = m.candidates.map((c) => {
      const def = cfg.roles[c.role];
      return `<div class="emp"><div class="emp-h"><span class="avatar">${def.icon}</span><span class="who"><b>${esc(c.name)}</b><small>${esc(def.label)}</small></span><span class="stars">${stars(c.skill)}</span></div>
        <div class="emp-grid"><div>Salary<b>${money(c.salary)}/day</b></div><div>Skill<b>${c.skill}/${cfg.maxSkill}</b></div><div>Productivity<b>${Math.round(c.eff * 100)}%</b></div></div>
        <div class="emp-s">${esc(def.blurb)}</div>
        <div class="emp-b"><button class="btn" data-emp-act="hire:${c.id}" ${eco.canAfford(c.cost) && m.employees.length < m.maxStaff ? '' : 'disabled'}>Hire ${money(c.cost)}</button></div></div>`;
    }).join('');
    const locked = Object.entries(cfg.roles).filter(([k]) => !m.roleAvailable(k)).map(([, r]) => `<div class="emp locked"><div class="emp-h"><span class="ic">${r.icon}</span><b>${esc(r.label)}</b><small>🔒 ${esc(r.unlock)}</small></div></div>`).join('');
    return `<h2>👥 Staff</h2>
      <div class="sub">${m.employees.filter((e) => !e.leaving).length}/${m.maxStaff} employees · payroll <b>${money(m.dailyPayroll)}</b>/day${m.hasManager ? ` · team bonus <b>+${Math.round(m.teamBonus * 100)}%</b>` : ''}${m.satisfactionBonus ? ` · cashier <b>+${m.satisfactionBonus.toFixed(1)}</b> satisfaction` : ''}</div>
      ${this.staffOverview()}
      <div class="sect">Your team</div>${emps}
      <div class="sect">Candidates for hire</div>${cands}
      <button class="btn ghost" data-emp-act="refresh">Find new candidates · ${money(cfg.refreshCandidatesCost)}</button>
      <div class="sub" style="margin-top:6px">Staff limit grows with your bays (${m.maxStaff} now). Candidates refresh every day; better reputation brings better applicants.</div>
      <div class="sect">Coming later</div>${locked}`;
  },

  /** Workload per department, payroll by department and the team training program. */
  staffOverview() {
    const m = this.employees, eco = this.economy;
    const depts = Object.keys(m.facilities).filter((d) => m.facilityBuilt(d));
    const rows = depts.map((d) => {
      const w = m.workload(d), pay = m.employees.filter((e) => !e.leaving && m.homeOf(e) === d).reduce((s, e) => s + e.salary, 0);
      const tag = w.staff === 0 ? (w.tasks ? '<span class="tag busy">No staff</span>' : '<span class="tag">No staff</span>') : w.perStaff >= 2 ? '<span class="tag busy">Overloaded</span>' : w.tasks === 0 ? '<span class="tag">Quiet</span>' : '<span class="tag on">Balanced</span>';
      return `<div class="kv"><span>${esc(m.facilities[d].label)} ${tag}</span><b>${w.staff} staff · ${w.tasks} open task${w.tasks === 1 ? '' : 's'} · ${money(pay)}/day</b></div>`;
    }).join('');
    const n = m.nextEfficiency();
    const bonus = Math.round(m.efficiencyBonus * 100);
    const train = n
      ? `<button class="btn" data-emp-act="efficiency" ${eco.canAfford(n.cost) ? '' : 'disabled'}>Team training program · +${Math.round(n.bonus * 100)}% speed · ${money(n.cost)}</button>${eco.canAfford(n.cost) ? '' : `<div class="sub">Not enough cash: ${money(Math.max(0, Math.ceil(n.cost - eco.cash)))} more needed.</div>`}`
      : '<div class="sub">Team training program: fully trained.</div>';
    return `<div class="sect">Workload</div>${rows || '<div class="sub">No departments yet.</div>'}
      <button class="btn ghost" data-emp-act="balance">Balance the team</button>
      <div class="sect">Team training</div>
      <div class="kv"><span>Training level</span><b>${m.efficiencyLevel}/${(m.cfg.efficiencyProgram || []).length} · +${bonus}% team speed</b></div>${train}`;
  },

  empAction(a) {
    const m = this.employees, [act, id] = a.split(':');
    if (act === 'hire') {
      const r = m.hire(id);
      if (!r.ok) this.toast(r.reason);
    } else if (act === 'train') m.train(id);
    else if (act === 'move') m.transfer(id);
    else if (act === 'duty') {
      const e = m.employees.find((x) => x.id === id);
      if (e) m.assign(id, e.dept === 'off' ? m.homeOf(e) : 'off');
    } else if (act === 'fire') {
      this.confirmFire(id);
      return;
    } else if (act === 'refresh') {
      if (!m.refreshCandidates(true)) this.toast('Not enough cash', 'warn');
    } else if (act === 'balance') {
      const n = m.balance();
      this.toast(n ? `Moved ${n} employee${n > 1 ? 's' : ''} to where the work is` : 'The team is already balanced', n ? 'good' : 'info');
    } else if (act === 'efficiency') {
      const r = m.buyEfficiency();
      if (!r.ok) this.toast(r.reason, 'warn'); else this.toast('Team training complete: the whole team works faster', 'good');
    }
    this.renderModal();
  },

  /** Firing is destructive: always ask. */
  confirmFire(id) {
    const e = this.employees.employees.find((x) => x.id === id);
    if (!e) return;
    this.askConfirm({ title: `Fire ${e.name}?`, text: 'They leave the team immediately. Hiring a replacement costs money again.', yes: 'Fire', danger: true }).then((ok) => {
      if (!ok) return;
      this.employees.fire(id);
      if (this.modal === 'staff') this.renderModal();
      if (this.selectionFn) this.clearSelection();
    });
  },
};
