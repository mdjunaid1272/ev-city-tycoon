import { QUALITY } from '../core/Settings.js';
import { districtOfBlock } from '../world/DistrictManager.js';

const $ = (id) => document.getElementById(id);
export const money = (n, dec = 0) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** HTML/CSS overlay: HUD, prompts, panels, pause menu. Reads state, never owns it. */
export class UIManager {
  constructor(ctx) {
    Object.assign(this, ctx); // bus, economy, station, missions, settings, game, camera, day
    this.modal = null;
    this.tab = { business: 'overview', missions: 'main' };
    this.selectionFn = null;
    this.shownCash = this.economy.cash;
    this.bindHud();
    this.bindEvents();
    this.refreshMission(this.missions.snapshot());
  }

  bindHud() {
    document.body.classList.toggle('touch', this.game.touch);
    $('btn-pause').onclick = () => this.togglePause();
    $('btn-mgmt').onclick = () => this.camera.toggle();
    $('btn-map').onclick = () => this.open('map');
    $('btn-decor').onclick = () => this.openDecor();
    $('btn-rot-l').onclick = () => this.camera.rotateIso(1);
    $('btn-rot-r').onclick = () => this.camera.rotateIso(-1);
    document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => this.open(b.dataset.open)));
    $('btn-interact').onclick = () => this.game.interaction.interact();
    const sp = $('btn-sprint');
    sp.onclick = () => { this.game.input.sprintToggle = !this.game.input.sprintToggle; sp.classList.toggle('on', this.game.input.sprintToggle); };
    $('modal').addEventListener('pointerdown', (e) => { if (e.target === $('modal') && !['pause', 'offline', 'login'].includes(this.modal)) this.closeModal(); });
  }

  bindEvents() {
    const b = this.bus;
    b.on('interact:target', (p) => this.setPrompt(p));
    b.on('camera:mode', (m) => this.onMode(m));
    b.on('mission:progress', (s) => this.refreshMission(s));
    b.on('mission:complete', ({ mission }) => this.toast(`Mission complete: ${mission.title}! ${this.rewardText(mission.reward)}`, 'good'));
    b.on('cash:earned', ({ amount, source }) => {
      if (source === 'charging') this.floater(`+${money(amount, 2)}`);
    });
    b.on('charging:complete', ({ vehicle, customer, kwh, revenue }) => this.toast(`${customer ? customer.def.icon + ' ' : ''}${vehicle.label} charged · ${kwh.toFixed(1)} kWh · +${money(revenue, 2)}`, 'good'));
    b.on('customer:paid', ({ customer, satisfaction, tip }) => {
      if (tip > 0) this.toast(`${customer.def.icon} Happy customer (${satisfaction}%) · tip +${money(tip, 2)}`, 'good');
      else if (satisfaction < 40) this.toast(`${customer.def.icon} Unhappy customer (${satisfaction}%) · reputation −1`);
    });
    b.on('customer:lost', ({ customer, reason, angry }) => {
      if (angry) this.toast(`${customer.def.icon} ${customer.def.label} left: ${reason} · reputation −2`);
    });
    b.on('reputation:changed', () => { if (this.modal === 'station') this.renderModal(); });
    b.on('employee:hired', ({ employee }) => this.toast(`${this.employees.cfg.roles[employee.role].icon} ${employee.name} joined as ${this.employees.cfg.roles[employee.role].label}`, 'good'));
    b.on('employee:fired', ({ employee }) => this.toast(`${employee.name} left the team`));
    b.on('employee:quit', ({ employee }) => this.toast(`${employee.name} quit: salary unpaid for 3 days`));
    b.on('employee:trained', ({ employee }) => this.toast(`${employee.name} trained to skill ${employee.skill}`, 'good'));
    b.on('employee:changed', () => { if (this.modal === 'staff') this.renderModal(); });
    b.on('district:unlocked', ({ name }) => this.toast(`🗺️ ${name} unlocked: its lots are now for sale`, 'good'));
    b.on('property:bought', ({ name }) => this.toast(`🏠 ${name} purchased!`, 'good'));
    b.on('property:changed', () => { if (this.modal === 'map' || this.modal === 'business') this.renderModal(); });
    b.on('decor:placed', ({ placement }) => this.floater(`-${money(this.placement.items[placement.item].cost)}`));
    b.on('decor:ui', (st) => { if (this.decorOpen) this.renderDecorBar(st); });
    b.on('decor:changed', () => { if (this.decorOpen) this.renderDecorBar(); });
    b.on('stage:up', (s) => { this._stageUp = s; this.open('stageup'); });
    b.on('goal:complete', ({ goal, scope }) => this.toast(`${scope === 'weekly' ? '📅' : '☀️'} ${goal.title} complete! ${this.rewardText(goal.reward)}`, 'good'));
    b.on('goal:daily-bonus', ({ reward }) => this.toast(`All daily missions done! ${this.rewardText(reward)}`, 'good'));
    b.on('achievement:unlocked', ({ achievement }) => this.toast(`🏆 ${achievement.title}! ${this.rewardText(achievement.reward)}`, 'good'));
    b.on('contract:accepted', ({ contract }) => this.toast(`Contract accepted: ${contract.label}`, 'good'));
    b.on('contract:done', ({ contract }) => this.toast(`🤝 Contract complete! +${money(contract.reward)} +${contract.rep}⭐`, 'good'));
    b.on('contract:failed', ({ contract }) => this.toast(`Contract failed: ${contract.label} (reputation −${this.contracts.cfg.failRep})`));
    b.on('contract:changed', () => { if (this.modal === 'business') this.renderModal(); });
    b.on('hub:built', ({ key }) => this.toast(`${this.hub.cfg[key].icon} ${this.hub.cfg[key].label} is open!`, 'good'));
    b.on('hub:sale', ({ key, amount }) => this.floater(`${this.hub.cfg[key].icon} +${money(amount, 2)}`));
    b.on('station:power', ({ kind }) => this.toast(`Power upgrade installed: ${kind}`, 'good'));
    b.on('goals:changed', () => { if (this.modal === 'missions') this.renderModal(); });
    b.on('svc:built', ({ biz }) => { const c = (biz === 'wash' ? this.wash : this.garage).cfg; this.toast(`${c.icon} ${c.label} is open!`, 'good'); });
    b.on('svc:paid', ({ biz, customer, satisfaction, tip, revenue }) => {
      const c = (biz === 'wash' ? this.wash : this.garage).cfg;
      if (tip > 0) this.toast(`${c.icon} ${customer.def.icon} +${money(revenue, 2)} · tip +${money(tip, 2)}`, 'good');
      else if (satisfaction < 40) this.toast(`${c.icon} Unhappy customer (${satisfaction}%) · reputation −1`);
    });
    b.on('svc:lost', ({ biz, customer, reason, angry }) => { if (angry) this.toast(`${customer.def.icon} left the ${biz === 'wash' ? 'car wash' : 'garage'}: ${reason} · reputation −2`); });
    b.on('svc:parts-missing', ({ service }) => this.toast(`⚠ Garage is out of parts for ${this.garage.cfg.services[service].label}`));
    b.on('svc:refused', () => this.toast('Garage could not do that job (equipment or mechanic skill missing)'));
    b.on('svc:changed', () => { if (['wash', 'garage', 'business'].includes(this.modal)) this.renderModal(); });
    b.on('vehicle:arrive', () => { /* quiet: label sprites show it */ });
    b.on('station:bay-unlocked', ({ id }) => this.toast(`Bay ${id + 1} built!`, 'good'));
    b.on('station:upgraded', () => this.toast(`Chargers upgraded to ${this.station.charger.name}`, 'good'));
    b.on('day:report', (r) => this.showDayReport(r));
    b.on('ui:open', (name) => this.open(name));
    b.on('station:changed', () => { if (this.modal === 'station') this.renderModal(); this.refreshSelection(); });
    b.on('economy:changed', () => { if (this.modal === 'finance') this.renderModal(); });
    b.on('toast', ({ text, kind }) => this.toast(text, kind));
    b.on('input:key', (code) => {
      if (code === 'Escape') {
        if (this.decorOpen) this.closeDecor();
        else if (this.modal && !['pause', 'offline', 'login'].includes(this.modal)) this.closeModal();
        else this.togglePause();
      }
    });
  }

  rewardText(r) {
    const p = [];
    if (r.cash) p.push(`+${money(r.cash)}`);
    if (r.gems) p.push(`+${r.gems}💎`);
    if (r.reputation) p.push(`+${r.reputation}⭐`);
    return p.join(' ');
  }

  // ---------- HUD ----------
  update(dt) {
    // animate cash counter
    const target = this.economy.cash;
    this.shownCash += (target - this.shownCash) * Math.min(1, dt * 8);
    if (Math.abs(target - this.shownCash) < 0.5) this.shownCash = target;
    $('v-cash').textContent = money(Math.round(this.shownCash));
    $('v-gems').textContent = this.economy.gems;
    $('v-rep').textContent = this.economy.reputation;
    $('v-day').textContent = `Day ${this.day.day}`;
    $('v-time').textContent = this.day.timeString;
    $('v-sun').textContent = this.day.night > 0.5 ? '🌙' : this.day.hour < 8 || this.day.hour > 17.5 ? '🌇' : '☀️';
    if (['station', 'finance', 'staff', 'wash', 'garage', 'business', 'map'].includes(this.modal) || String(this.modal).startsWith('hub_')) {
      this._mt = (this._mt || 0) + dt;
      if (this._mt > 0.4) { this._mt = 0; this.renderModal(); }
    }
    if (this.selectionFn) {
      this._st = (this._st || 0) + dt;
      if (this._st > 0.3) { this._st = 0; this.refreshSelection(); }
    }
  }

  setLocation(name) {
    const t = `${name} · Stage ${this.progression.stage}`;
    if ($('v-loc').textContent !== t) $('v-loc').textContent = t;
  }

  setPrompt(p) {
    $('prompt').classList.toggle('hidden', !p);
    if (p) $('prompt-text').textContent = p.text;
    $('btn-interact').hidden = !p;
  }

  onMode(m) {
    document.body.classList.toggle('mgmt', m === 'management');
    $('mgmt-label').textContent = m === 'management' ? 'Street' : 'Manage';
    $('mgmt-hint').classList.toggle('hidden', m !== 'management');
    if (m !== 'management') { this.clearSelection(); if (this.decorOpen) this.closeDecor(); }
  }

  refreshMission(s) {
    $('m-title').textContent = s.title;
    $('m-desc').textContent = s.desc;
    $('m-fill').style.width = `${(s.progress / s.target) * 100}%`;
    $('m-count').textContent = s.done ? '' : s.target >= 100 ? `${money(Math.floor(s.progress))} / ${money(s.target)}` : `${Math.floor(s.progress)} / ${s.target}`;
    $('m-reward').textContent = s.done ? '' : this.rewardText(s.reward);
  }

  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    $('toasts').appendChild(t);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
    setTimeout(() => t.remove(), 3100);
  }

  floater(text) {
    const f = document.createElement('div');
    f.className = 'floater';
    f.textContent = text;
    $('floaters').appendChild(f);
    setTimeout(() => f.remove(), 1700);
  }

  // ---------- selection card (management mode) ----------
  showSelection(fn) {
    this.selectionFn = fn;
    this.refreshSelection();
  }
  clearSelection() {
    this.selectionFn = null;
    $('selection').classList.add('hidden');
    this.game.selectionRing.visible = false;
  }
  refreshSelection() {
    const el = $('selection');
    if (!this.selectionFn) return;
    const info = this.selectionFn();
    if (!info) return this.clearSelection();
    const key = JSON.stringify([info.title, info.rows, info.actions.map((a) => [a.label, !!a.disabled])]);
    if (key === this._selKey) return;
    this._selKey = key;
    el.classList.remove('hidden');
    el.innerHTML = `<button class="x">✕</button><h3>${esc(info.title)}</h3><div class="sub">${esc(info.subtitle || '')}</div>
      <div class="rows">${info.rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>
      ${info.actions.map((a, i) => `<button class="btn" data-a="${i}" ${a.disabled ? 'disabled' : ''}>${esc(a.label)}</button>`).join('')}`;
    el.querySelector('.x').onclick = () => this.clearSelection();
    el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => { info.actions[b.dataset.a].cb(); this._selKey = null; this.refreshSelection(); }));
  }

  // ---------- modals ----------
  open(name) {
    this.modal = name;
    $('modal').classList.remove('hidden');
    this.game.setPaused(name === 'pause');
    this.renderModal();
  }
  closeModal() {
    if (this.modal === 'offline' && this.game.pendingOffline) { this.offline.apply(this.game.pendingOffline, 1); this.game.pendingOffline = null; this.toast('Offline earnings collected', 'good'); }
    const wasOffline = this.modal === 'offline';
    this.modal = null;
    $('modal').classList.add('hidden');
    this.game.setPaused(false);
    if (wasOffline && this.dailyReward.status()) this.open('login');
  }
  togglePause() {
    if (this.modal === 'pause') this.closeModal();
    else this.open('pause');
  }

  renderModal() {
    const card = $('modal-card');
    const m = this.modal;
    if (!m) return;
    const keepScroll = card.scrollTop;
    // avoid rebuilding while the user is dragging a slider / has a select open
    if (m === 'pause' && this._pauseRendered) return;
    card.innerHTML = `<button class="x" data-close>✕</button>` + ({
      station: () => this.tplStation(), staff: () => this.tplStaff(), finance: () => this.tplFinance(),
      business: () => this.tplBusinessTabs(), wash: () => this.tplWash(), garage: () => this.tplGarage(),
      offline: () => this.tplOffline(), login: () => this.tplLogin(), stageup: () => this.tplStageUp(), map: () => this.tplMap(), missions: () => this.tplMissionsTabs(),
      pause: () => this.tplPause(), report: () => this.tplReport(),
    }[m] || (() => (String(m).startsWith('hub_') ? this.tplHub(m.slice(4)) : '')))();
    card.scrollTop = keepScroll;
    card.querySelector('[data-close]').onclick = () => this.closeModal();
    this._pauseRendered = m === 'pause';
    this.bindModal(card);
  }

  bindModal(card) {
    const st = this.station, eco = this.economy;
    card.querySelectorAll('[data-bay-act]').forEach((b) => (b.onclick = () => {
      const [act, id] = b.dataset.bayAct.split(':'); const i = +id;
      if (act === 'start') st.startCharging(i); else if (act === 'stop') st.stopCharging(i); else if (act === 'build') st.buyBay(i);
    }));
    const pm = card.querySelector('[data-price="-"]'), pp = card.querySelector('[data-price="+"]');
    if (pm) pm.onclick = () => st.setPrice(st.pricePerKwh - 0.05);
    if (pp) pp.onclick = () => st.setPrice(st.pricePerKwh + 0.05);
    const up = card.querySelector('[data-upgrade]');
    if (up) up.onclick = () => st.upgradeChargers();
    const q = card.querySelector('#set-quality');
    if (q) q.onchange = () => { this.settings.set('quality', q.value); this.game.applyQuality(); };
    const s = card.querySelector('#set-sens');
    if (s) s.oninput = () => this.settings.set('sensitivity', +s.value);
    const iy = card.querySelector('#set-invert');
    if (iy) iy.onchange = () => this.settings.set('invertY', iy.checked);
    card.querySelectorAll('[data-emp-act]').forEach((b) => (b.onclick = () => this.empAction(b.dataset.empAct)));
    card.querySelectorAll('[data-svc]').forEach((b) => (b.onclick = () => this.svcAction(b.dataset.svc)));
    card.querySelectorAll('[data-map]').forEach((b) => (b.onclick = () => this.mapAction('cell', b.dataset.map)));
    card.querySelectorAll('[data-district]').forEach((b) => (b.onclick = () => this.mapAction('district', b.dataset.district)));
    card.querySelectorAll('[data-prop]').forEach((b) => (b.onclick = () => this.mapAction('prop', b.dataset.prop)));
    card.querySelectorAll('[data-travel]').forEach((b) => (b.onclick = () => this.mapAction('travel', b.dataset.travel)));
    card.querySelectorAll('[data-hub]').forEach((b) => (b.onclick = () => this.hubAction(b.dataset.hub)));
    card.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { const [n, t] = b.dataset.tab.split(':'); this.tab[n] = t; this.renderModal(); }));
    card.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { const r = this.upgrades.buy(b.dataset.up); if (!r.ok && r.reason) this.toast(r.reason); this.renderModal(); }));
    card.querySelectorAll('[data-contract]').forEach((b) => (b.onclick = () => { const [, id] = b.dataset.contract.split(':'); const r = this.contracts.accept(id); this.toast(r.ok ? 'Contract accepted' : r.reason, r.ok ? 'good' : ''); this.renderModal(); }));
    card.querySelectorAll('[data-ret]').forEach((b) => (b.onclick = () => this.retAction(b.dataset.ret)));
    card.querySelectorAll('[data-open-biz]').forEach((b) => (b.onclick = () => this.open(b.dataset.openBiz)));
    const ar = card.querySelector('#set-autorestock');
    if (ar) ar.onchange = () => { this.garage.autoRestock = ar.checked; };
    card.querySelectorAll('[data-pause]').forEach((b) => (b.onclick = () => this.pauseAction(b.dataset.pause)));
    void eco;
  }

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
      if (this.fireArm !== id) { this.fireArm = id; this.toast('Tap Fire again to confirm'); return; }
      this.fireArm = null;
      m.fire(id);
    } else if (act === 'refresh') {
      if (!m.refreshCandidates(true)) this.toast('Not enough cash');
    }
    this.renderModal();
  }

  pauseAction(a) {
    if (a === 'resume') this.closeModal();
    else if (a === 'tutorial') { this.closeModal(); this.game.tutorial?.restart(); }
    else if (a === 'save') { this.game.save().then(() => this.toast('Game saved', 'good')); }
    else if (a === 'reset') {
      if (confirm('Delete your save and restart? This cannot be undone.')) this.game.resetSave();
    }
  }

  tplStation() {
    const st = this.station, eco = this.economy, ch = st.charger, nx = st.nextChargerUpgrade();
    const rows = st.bays.map((b, i) => {
      let status, btn = '';
      if (!b.unlocked) {
        status = 'Not built';
        btn = `<button class="btn" data-bay-act="build:${i}" ${eco.canAfford(st.cfg.bayCost) ? '' : 'disabled'}>Build ${money(st.cfg.bayCost)}</button>`;
      } else if (b.state === 'charging') {
        status = `<b>${Math.round(b.vehicle.soc * 100)}%</b> · ${b.power.toFixed(0)} kW · ${b.vehicle.label}`;
        btn = `<button class="btn ghost" data-bay-act="stop:${i}">Stop</button>`;
      } else if (b.state === 'waiting') {
        status = `<b>${b.vehicle.label}</b> waiting (${Math.round(b.vehicle.soc * 100)}%)`;
        btn = `<button class="btn" data-bay-act="start:${i}">Charge</button>`;
      } else status = { empty: 'Free', reserved: 'Vehicle arriving…', done: 'Paid · leaving' }[b.state];
      return `<div class="bay"><span class="n">Bay ${i + 1}</span><span class="st">${status}</span>${btn}</div>`;
    }).join('');
    return `<h2>⚡ Charging Station</h2><div class="sub">${st.unlockedCount} bays · ${ch.name} ${ch.kw} kW · capacity ${st.totalCapacityKw} kW</div>
      <div class="sect">Bays</div>${rows}
      <div class="sect">Price per kWh</div>
      <div class="stepper"><button data-price="-">−</button><div class="val">${money(st.pricePerKwh, 2)}</div><button data-price="+">+</button></div>
      <div class="sub" style="margin-top:6px">Electricity is billed at a time-of-day tariff. Higher prices slow customer arrivals.</div>
      <div class="sect">Upgrade</div>
      ${nx ? `<button class="btn blue" data-upgrade ${eco.canAfford(nx.cost) ? '' : 'disabled'}>Upgrade to ${nx.name} (${nx.kw} kW) · ${money(nx.cost)}</button>` : '<div class="sub">All charger upgrades purchased.</div>'}
      ${this.tplPower()}
      ${this.tplCustomers()}
      <div class="sect">Today</div>
      <div class="kv"><span>Customers served</span><b>${st.todayServed}</b></div>
      <div class="kv"><span>Energy sold</span><b>${eco.ledger.kwh.toFixed(1)} kWh</b></div>
      <div class="kv"><span>Revenue</span><b class="pos">${money(eco.todayRevenue, 2)}</b></div>`;
  }

  tplStaff() {
    const m = this.employees, eco = this.economy, cfg = m.cfg;
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(cfg.maxSkill - n);
    const stateText = { idle: 'Waiting for work', move: 'Heading to task', perform: 'Working', complete: 'Done', recover: 'Re-planning route', arriving: 'Starting shift', return: 'Back to post', offduty: 'Off duty', leaving: 'Leaving' };
    const emps = m.employees.filter((e) => !e.leaving).map((e) => {
      const def = cfg.roles[e.role], tc = m.trainCost(e), lv = m.level(e);
      const status = e.dept === 'off' ? '<span class="tag">Off duty</span>' : e.state === 'perform' || e.state === 'move' ? `<span class="tag busy">${esc(stateText[e.state])}</span>` : `<span class="tag on">${esc(stateText[e.state] || e.state)}</span>`;
      const xpPct = ((e.xp % 60) / 60) * 100;
      return `<div class="emp ${e.dept === 'off' ? 'off' : ''}">
        <div class="emp-h"><span class="ic">${def.icon}</span><b>${esc(e.name)}</b><small>${esc(def.label)}</small>${status}<span class="stars">${stars(e.skill)}</span></div>
        <div class="emp-s">Speed <b>x${m.workMult(e).toFixed(2)}</b> · Lv <b>${lv}</b> · <b>${money(e.salary)}</b>/day · <b>${e.tasksDone}</b> tasks${e.unpaidDays ? ' · <b style="color:#d6453d">unpaid!</b>' : ''}</div>
        <div class="prog" style="height:6px;margin-bottom:8px"><i style="width:${lv >= 10 ? 100 : xpPct}%"></i></div>
        <div class="emp-b">
          ${e.skill < cfg.maxSkill ? `<button class="btn blue" data-emp-act="train:${e.id}" ${eco.canAfford(tc) ? '' : 'disabled'}>Train ${money(tc)}</button>` : ''}
          <button class="btn ghost" data-emp-act="duty:${e.id}">${e.dept === 'off' ? 'Put on duty' : 'Off duty'}</button>
          ${m.eligibleDepts(e).length > 1 ? `<button class="btn ghost" data-emp-act="move:${e.id}">📍 ${esc(m.facilities[m.homeOf(e)]?.label || m.homeOf(e))} ▸</button>` : ''}
          <button class="btn ghost" data-emp-act="fire:${e.id}">${this.fireArm === e.id ? 'Confirm fire?' : 'Fire'}</button>
        </div></div>`;
    }).join('') || '<div class="sub">No employees yet. You are doing everything by hand: hire an attendant below.</div>';
    const cands = m.candidates.map((c) => {
      const def = cfg.roles[c.role];
      return `<div class="emp"><div class="emp-h"><span class="ic">${def.icon}</span><b>${esc(c.name)}</b><small>${esc(def.label)}</small><span class="stars">${stars(c.skill)}</span></div>
        <div class="emp-s">${esc(def.blurb)}<br>Efficiency <b>${Math.round(c.eff * 100)}%</b> · <b>${money(c.salary)}</b>/day</div>
        <div class="emp-b"><button class="btn" data-emp-act="hire:${c.id}" ${eco.canAfford(c.cost) && m.employees.length < m.maxStaff ? '' : 'disabled'}>Hire ${money(c.cost)}</button></div></div>`;
    }).join('');
    const locked = Object.entries(cfg.roles).filter(([k]) => !m.roleAvailable(k)).map(([, r]) => `<div class="emp locked"><div class="emp-h"><span class="ic">${r.icon}</span><b>${esc(r.label)}</b><small>🔒 ${esc(r.unlock)}</small></div></div>`).join('');
    return `<h2>👥 Staff</h2>
      <div class="sub">${m.employees.filter((e) => !e.leaving).length}/${m.maxStaff} employees · payroll <b>${money(m.dailyPayroll)}</b>/day${m.hasManager ? ` · team bonus <b>+${Math.round(m.teamBonus * 100)}%</b>` : ''}${m.satisfactionBonus ? ` · cashier <b>+${m.satisfactionBonus.toFixed(1)}</b> satisfaction` : ''}</div>
      <div class="sect">Your team</div>${emps}
      <div class="sect">Candidates for hire</div>${cands}
      <button class="btn ghost" data-emp-act="refresh">Find new candidates · ${money(cfg.refreshCandidatesCost)}</button>
      <div class="sub" style="margin-top:6px">Staff limit grows with your bays (${m.maxStaff} now). Candidates refresh every day; better reputation brings better applicants.</div>
      <div class="sect">Coming later</div>${locked}`;
  }

  // ---------- businesses (overview, car wash, garage) ----------
  tplBusiness() {
    const eco = this.economy, st = this.station, rev = eco.ledger.revenue;
    const card = (icon, title, sub, body, btn) => `<div class="emp"><div class="emp-h"><span class="ic">${icon}</span><b>${title}</b><small>${sub}</small></div><div class="emp-s">${body}</div><div class="emp-b">${btn}</div></div>`;
    const svc = (biz, key) => {
      const cfg = biz.cfg;
      if (!biz.built) {
        const c = biz.canBuild(eco.reputation);
        return card(cfg.icon, esc(cfg.label), '<span class="tag">Not built</span>', `Build cost <b>${money(cfg.buildCost)}</b> · needs reputation <b>${cfg.minRep}</b> (you have <b>${eco.reputation}</b>)<br>Built on the ${key === 'wash' ? 'west' : 'north'} lot next to your station.`,
          `<button class="btn" data-svc="${key}:build" ${c.ok ? '' : 'disabled'}>${c.ok ? `Build · ${money(cfg.buildCost)}` : esc(c.reason)}</button>`);
      }
      const s = biz.stats;
      return card(cfg.icon, esc(cfg.label), '<span class="tag on">Open</span>',
        `${biz.unlockedBays} bays · queue <b>${biz.queue.length}/${biz.maxQueue}</b> · served <b>${s.served}</b> · revenue today <b>${money(rev[cfg.revenueKey] || 0, 2)}</b>`,
        `<button class="btn blue" data-open-biz="${key}">Open manager</button>`);
    };
    return `<h2>🏢 Businesses</h2><div class="sub">Reputation ${eco.reputation} · connected services: charging customers may drive on to the wash or garage.</div>
      ${card('⚡', 'Charging Station', '<span class="tag on">Open</span>', `${st.unlockedCount} bays · ${st.charger.name} ${st.charger.kw} kW · served today <b>${st.todayServed}</b> · revenue today <b>${money(rev.charging || 0, 2)}</b>`, '<button class="btn blue" data-open-biz="station">Open manager</button>')}
      ${svc(this.wash, 'wash')}${svc(this.garage, 'garage')}
      ${Object.entries(this.hubs).map(([k, h]) => (h.built ? card(h.cfg.icon, esc(h.cfg.label), '<span class="tag on">Open</span>', `${h.unlockedBays} bays · ${h.charger.kw} kW · served <b>${h.stats.served}</b> · revenue today <b>${money(this.economy.ledger.revenue[h.cfg.revenueKey] || 0, 2)}</b>`, `<button class="btn blue" data-open-biz="hub_${k}">Open manager</button>`) : '')).join('')}
      <button class="btn ghost" onclick="document.getElementById('btn-map').click()">🗺️ Open the city map to buy more properties</button>
      <div class="sect">Today's revenue by source</div>
      ${Object.entries(rev).map(([k, v]) => `<div class="kv"><span style="text-transform:capitalize">${esc(k)}</span><b>${money(v, 2)}</b></div>`).join('') || '<div class="sub">Nothing earned yet today.</div>'}`;
  }

  tplWash() {
    const w = this.wash, eco = this.economy, cfg = w.cfg, s = w.stats, m = this.employees;
    if (!w.built) return `<h2>🧽 Car Wash</h2><div class="sub">Not built yet. Open Businesses to build it.</div>`;
    const stateText = { empty: 'Free', reserved: 'Car arriving', waiting: 'Waiting for a washer', working: 'Washing (manual)', auto: 'Washing (tunnel)', done: 'Done' };
    const bays = w.bays.map((b, i) => {
      if (!b.unlocked) {
        const cost = w.nextBayCost();
        return `<div class="bay"><span class="n">Bay ${i + 1}</span><span class="st">Not built</span>${i === w.unlockedBays && cost !== null ? `<button class="btn" data-svc="wash:addbay" ${eco.canAfford(cost) ? '' : 'disabled'}>Build ${money(cost)}</button>` : ''}</div>`;
      }
      const pkg = b.customer ? cfg.packages[b.customer.service] : null;
      const tun = b.mode === 'manual' ? `<button class="btn ghost" data-svc="wash:tunnel:${i}" ${w.canTunnel(i) && eco.canAfford(cfg.tunnelCost) ? '' : 'disabled'}>${w.equipLevel >= cfg.tunnelMinEquipment ? `Tunnel ${money(cfg.tunnelCost)}` : `Tunnel (equip ${cfg.tunnelMinEquipment})`}</button>` : '';
      return `<div class="bay"><span class="n">Bay ${i + 1}</span><span class="st"><b>${b.mode === 'tunnel' ? 'Tunnel' : 'Manual'}</b> · ${esc(stateText[b.state] || b.state)}${pkg ? ` · ${esc(pkg.label)} ${Math.round(b.progress * 100)}%` : ''}</span>${tun}</div>`;
    }).join('');
    const pk = Object.entries(cfg.packages).map(([k, p]) => {
      const ok = w.availablePackages().includes(k);
      const price = w.packagePrice(k);
      return `<div class="bay ${ok ? '' : 'locked'}"><span class="n" style="width:30px">${p.icon}</span><span class="st"><b>${esc(p.label)}</b><br>${p.seconds}s · cleans ${Math.round(p.clean * 100)}%${ok ? '' : ' · 🔒 needs better equipment'}</span>
        ${ok ? `<button class="btn ghost" style="min-width:34px" data-svc="wash:price:${k}:-">−</button><b style="min-width:54px;text-align:center">${money(price, 2)}</b><button class="btn ghost" style="min-width:34px" data-svc="wash:price:${k}:+">+</button>` : ''}</div>`;
    }).join('');
    const ne = w.nextEquipment();
    const washers = m.employees.filter((e) => e.role === 'washer' && !e.leaving).length;
    return `<h2>🧽 Car Wash</h2><div class="sub">${w.unlockedBays} bays · ${esc(w.equipment.name)} · ${washers} washer${washers === 1 ? '' : 's'} · queue ${w.queue.length}/${w.maxQueue}</div>
      <div class="sect">Bays</div>${bays}
      <div class="sect">Service packages &amp; pricing</div>${pk}
      <div class="sub">Higher prices earn more per wash but customers with a low price tolerance stay away. Premium and Detailing need equipment upgrades.</div>
      <div class="sect">Equipment</div>
      ${ne ? `<button class="btn blue" data-svc="wash:equip" ${eco.canAfford(ne.cost) ? '' : 'disabled'}>Upgrade → ${esc(ne.name)} · ${money(ne.cost)} (speed x${ne.speed}, +${Math.round(ne.clean * 100)}% clean)</button>` : '<div class="sub">All equipment upgrades purchased.</div>'}
      <div class="sub" style="margin-top:6px">Tunnel bays only need a washer for a few seconds to start the machine, then run on their own. Daily upkeep ${money(w.unlockedBays * cfg.upkeepPerBayPerDay)}.</div>
      <div class="sect">Results</div>
      <div class="kv"><span>Washes completed</span><b>${s.served}</b></div>
      <div class="kv"><span>Revenue</span><b class="pos">${money(s.revenue, 2)}</b></div>
      <div class="kv"><span>Avg satisfaction</span><b>${w.avgSatisfaction === null ? '—' : Math.round(w.avgSatisfaction) + '%'}</b></div>
      <div class="kv"><span>Referrals from charging</span><b>${s.referrals}</b></div>
      <div class="kv"><span>Lost customers</span><b>${s.lost}</b></div>
      <div class="sub">${Object.entries(s.lostBy).map(([k, v]) => `${v}× ${esc(k)}`).join(', ') || ''}</div>`;
  }

  tplGarage() {
    const g = this.garage, eco = this.economy, cfg = g.cfg, s = g.stats, m = this.employees;
    if (!g.built) return `<h2>🔧 EV Garage</h2><div class="sub">Not built yet. Open Businesses to build it.</div>`;
    const stateText = { empty: 'Free', reserved: 'Car arriving', waiting: 'Waiting for a mechanic', diagnosing: 'Diagnosing', ready: 'Waiting for repair', blocked: 'Waiting for parts', repairing: 'Repairing', done: 'Done' };
    const lifts = g.bays.map((b, i) => {
      if (!b.unlocked) {
        const cost = g.nextLiftCost();
        return `<div class="bay"><span class="n">Lift ${i + 1}</span><span class="st">Not built</span>${i === g.unlockedBays && cost !== null ? `<button class="btn" data-svc="garage:addlift" ${eco.canAfford(cost) ? '' : 'disabled'}>Build ${money(cost)}</button>` : ''}</div>`;
      }
      const j = b.job;
      return `<div class="bay"><span class="n">Lift ${i + 1}</span><span class="st"><b>${esc(stateText[b.state] || b.state)}</b>${b.customer ? ` · ${esc(cfg.services[j?.actual || b.customer.service].label)}` : ''}${b.state === 'diagnosing' || b.state === 'repairing' ? ` ${Math.round(b.progress * 100)}%` : ''}</span></div>`;
    }).join('');
    const mech = g.mechanicSkill;
    const svc = Object.entries(cfg.services).map(([k, sv]) => {
      const eq = g.equipmentOk(k), sk = mech >= sv.skill, parts = g.hasParts(k);
      const flags = `${eq ? '' : ' · 🔒 equipment'}${sk ? '' : ` · needs mechanic skill ${sv.skill}`}${parts ? '' : ' · ⚠ parts'}`;
      return `<div class="kv"><span>${sv.icon} ${esc(sv.label)}<br><small style="color:var(--muted)">${sv.diag + sv.repair}s${esc(flags)}</small></span><b>${money(g.servicePrice(k), 2)}</b></div>`;
    }).join('');
    const parts = Object.entries(cfg.parts).map(([k, p]) => {
      const st = g.stock[k];
      return `<div class="bay"><span class="st"><b>${esc(p.label)}</b> · ${money(p.cost)} each<div class="prog" style="margin-top:4px;height:8px"><i style="width:${(st / p.max) * 100}%;background:${st === 0 ? '#d6453d' : 'var(--green)'}"></i></div></span><b style="min-width:30px;text-align:center">${st}</b>
        <button class="btn ghost" style="min-width:42px" data-svc="garage:part:${k}:1" ${eco.canAfford(p.cost) && st < p.max ? '' : 'disabled'}>+1</button><button class="btn ghost" style="min-width:42px" data-svc="garage:part:${k}:3" ${eco.canAfford(p.cost * 3) && st + 3 <= p.max ? '' : 'disabled'}>+3</button></div>`;
    }).join('');
    const ns = cfg.scanner[g.scannerLevel], nt = cfg.tools[g.toolLevel];
    const mechs = m.employees.filter((e) => e.role === 'mechanic' && !e.leaving).length;
    return `<h2>🔧 EV Garage</h2><div class="sub">${g.unlockedBays} lifts · ${mechs} mechanic${mechs === 1 ? '' : 's'} (best skill ${mech || '-'}) · queue ${g.queue.length}/${g.maxQueue}</div>
      <div class="sect">Lifts</div>${lifts}
      <div class="sect">Services</div>${svc}
      <div class="stepper" style="margin-top:8px"><button data-svc="garage:price:-">−</button><div class="val" style="font-size:18px">Prices x${g.priceMult.toFixed(2)}</div><button data-svc="garage:price:+">+</button></div>
      <div class="sect">Spare parts inventory</div>${parts}
      <label class="opt">Auto-restock ${m.hasManager ? '(manager on duty)' : '<small style="color:var(--muted)">(needs a manager)</small>'}<input id="set-autorestock" type="checkbox" ${g.autoRestock ? 'checked' : ''}></label>
      <div class="sect">Equipment</div>
      ${ns ? `<button class="btn blue" data-svc="garage:upgrade:scanner" ${eco.canAfford(ns.cost) ? '' : 'disabled'}>Scanner → ${esc(ns.name)} · ${money(ns.cost)}</button>` : '<div class="sub">Scanner fully upgraded.</div>'}
      ${nt ? `<button class="btn blue" data-svc="garage:upgrade:tools" ${eco.canAfford(nt.cost) ? '' : 'disabled'}>Tool station → ${esc(nt.name)} · ${money(nt.cost)}</button>` : '<div class="sub">Tool station fully upgraded.</div>'}
      ${g.batteryStation ? '<div class="sub">Battery service equipment installed.</div>' : `<button class="btn blue" data-svc="garage:upgrade:battery" ${eco.canAfford(cfg.batteryStationCost) ? '' : 'disabled'}>Battery service equipment · ${money(cfg.batteryStationCost)}</button>`}
      <div class="sub" style="margin-top:6px">Daily upkeep ${money(g.unlockedBays * cfg.upkeepPerBayPerDay)}. A job waits ("blocked") when parts are missing and the customer's patience keeps running.</div>
      <div class="sect">Results</div>
      <div class="kv"><span>Jobs completed</span><b>${s.served}</b></div>
      <div class="kv"><span>Revenue</span><b class="pos">${money(s.revenue, 2)}</b></div>
      <div class="kv"><span>Avg satisfaction</span><b>${g.avgSatisfaction === null ? '—' : Math.round(g.avgSatisfaction) + '%'}</b></div>
      <div class="kv"><span>Referrals from charging</span><b>${s.referrals}</b></div>
      <div class="kv"><span>Lost customers</span><b>${s.lost}</b></div>
      <div class="sub">${Object.entries(s.lostBy).map(([k, v]) => `${v}× ${esc(k)}`).join(', ') || ''}</div>`;
  }

  svcAction(a) {
    const p = a.split(':'), biz = p[0] === 'wash' ? this.wash : this.garage;
    const act = p[1];
    if (act === 'build') { const r = biz.build(); this.toast(r.ok ? `${biz.cfg.label} built! Hire staff to run it.` : r.reason, r.ok ? 'good' : ''); }
    else if (act === 'addbay') biz.addBay();
    else if (act === 'addlift') biz.addLift();
    else if (act === 'equip') biz.upgradeEquipment();
    else if (act === 'tunnel') biz.upgradeTunnel(+p[2]);
    else if (act === 'upgrade') biz.upgrade(p[2]);
    else if (act === 'part') { if (!biz.buyPart(p[2], +p[3])) this.toast('Cannot buy that part'); }
    else if (act === 'price') {
      if (biz === this.wash) biz.setPriceMult(p[2], (biz.priceMult[p[2]] ?? 1) + (p[3] === '+' ? 0.05 : -0.05));
      else biz.setPriceMult(biz.priceMult + (p[2] === '+' ? 0.05 : -0.05));
    }
    this.renderModal();
  }

  // ---------- Milestone 6 screens ----------
  tabs(name, list) {
    const cur = this.tab[name];
    return `<div class="tabs">${list.map(([k, label]) => `<button class="tab ${cur === k ? 'on' : ''}" data-tab="${name}:${k}">${label}</button>`).join('')}</div>`;
  }
  bar(frac, color = 'var(--green)') {
    return `<div class="prog" style="height:8px;margin:4px 0"><i style="width:${Math.max(0, Math.min(1, frac)) * 100}%;background:${color}"></i></div>`;
  }
  rewardHtml(r) {
    return esc(this.rewardText(r || {}));
  }

  tplBusinessTabs() {
    const t = this.tab.business;
    const body = t === 'upgrades' ? this.tplUpgrades() : t === 'contracts' ? this.tplContracts() : this.tplBusiness();
    return this.tabs('business', [['overview', 'Overview'], ['upgrades', 'Upgrades'], ['contracts', 'Contracts']]) + body;
  }

  tplUpgrades() {
    const items = this.upgrades.list();
    const groups = [...new Set(items.map((i) => i.group))];
    return `<h2>⬆️ Upgrades</h2><div class="sub">Cash ${money(this.economy.cash, 2)} · Stage ${this.progression.stage}. Every upgrade changes how the business runs.</div>` + groups.map((g) => `<div class="sect">${esc(g)}</div>` + items.filter((i) => i.group === g).map((i) => {
      const btn = i.maxed ? '<span class="tag on">Max</span>' : i.lock ? `<span class="tag">🔒 ${esc(i.lock)}</span>` : `<button class="btn ${i.can ? '' : ''}" data-up="${i.id}" ${i.can ? '' : 'disabled'}>Buy ${money(i.cost)}</button>`;
      return `<div class="emp ${i.lock && !i.maxed ? 'locked' : ''}"><div class="emp-h"><span class="ic">${i.icon}</span><b>${esc(i.name)}</b><small>Lv ${i.level}/${i.max}</small></div>
        <div class="emp-s">${esc(i.desc)}</div><div class="emp-b">${btn}</div></div>`;
    }).join('')).join('');
  }

  tplContracts() {
    const c = this.contracts, day = this.game.day.day;
    if (!c.unlocked) return `<h2>🤝 Fleet contracts</h2><div class="sub">Contracts unlock at Stage ${this.progression.unlockStage('contracts')}. Fleet operators pay a bonus when you serve their vehicles before a deadline.</div>`;
    const act = c.active.map((k) => `<div class="emp"><div class="emp-h"><span class="ic">🤝</span><b>${esc(k.label)}</b><small>${k.have}/${k.need} ${esc(k.unit)}</small></div>${this.bar(k.have / k.need)}
      <div class="emp-s">Reward <b>${money(k.reward)}</b> + ${k.rep}⭐ · <b>${Math.max(0, k.deadlineDay - day)}</b> day(s) left (fleet customers only count)</div></div>`).join('') || '<div class="sub">No active contracts.</div>';
    const off = c.offers.map((k) => `<div class="emp"><div class="emp-h"><span class="ic">📄</span><b>${esc(k.label)}</b><small>${k.need} ${esc(k.unit)} in ${k.days} days</small></div>
      <div class="emp-s">Pays <b>${money(k.reward)}</b> (${money(k.perUnit)} each) + ${k.rep}⭐ · failing costs ${c.cfg.failRep}⭐</div>
      <div class="emp-b"><button class="btn" data-contract="accept:${k.id}" ${c.active.length >= c.cfg.maxActive ? 'disabled' : ''}>Accept</button></div></div>`).join('') || '<div class="sub">No offers right now. New ones arrive every day.</div>';
    return `<h2>🤝 Fleet contracts</h2><div class="sub">${c.active.length}/${c.cfg.maxActive} active · completed ${c.done} · failed ${c.failed}. While a contract is active, fleet customers visit more often.</div>
      <div class="sect">Active</div>${act}<div class="sect">Offers</div>${off}`;
  }

  tplMissionsTabs() {
    const t = this.tab.missions;
    const tabs = this.tabs('missions', [['main', 'Main'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['ach', 'Achievements'], ['stage', 'Stage']]);
    if (t === 'daily') return tabs + this.tplGoals('daily');
    if (t === 'weekly') return tabs + this.tplGoals('weekly');
    if (t === 'ach') return tabs + this.tplAchievements();
    if (t === 'stage') return tabs + this.tplStage();
    return tabs + this.tplMissions();
  }

  tplGoals(kind) {
    const g = this.goals, list = kind === 'daily' ? g.daily : g.weekly;
    const left = kind === 'daily' ? '' : ` · resets in ${Math.max(0, g.weekStartDay + g.cfg.weeklyDays - this.game.day.day)} day(s)`;
    const rows = list.map((x) => {
      const p = g.progressOf(x);
      const prog = x.stat2 ? `${Math.floor(p.a)}/${x.target} · ${Math.floor(p.b)}/${x.target2}` : `${Math.floor(p.a).toLocaleString('en-US')}/${x.target.toLocaleString('en-US')}`;
      return `<div class="mrow ${x.done ? 'done' : 'cur'}"><div class="chk">${x.done ? '✓' : ''}</div><div style="flex:1"><b>${esc(x.title)}</b><small>${prog} · Reward ${this.rewardHtml(x.reward)}</small>${this.bar(x.done ? 1 : g.fraction(x))}</div></div>`;
    }).join('') || '<div class="sub">Nothing available yet.</div>';
    const bonus = kind === 'daily' ? `<div class="sub" style="margin-top:8px">Finish all ${g.cfg.dailyCount} for a bonus: ${this.rewardHtml(g.cfg.dailyBonus)} ${g.dailyBonusDone ? '✓ claimed' : ''}</div>` : '';
    return `<h2>${kind === 'daily' ? '☀️ Daily missions' : '📅 Weekly challenges'}</h2><div class="sub">${kind === 'daily' ? 'New missions every in-game day' : 'Multi-department goals'}${left}</div>${rows}${bonus}`;
  }

  tplAchievements() {
    const list = this.goals.achievementList();
    const done = list.filter((a) => a.done).length;
    return `<h2>🏆 Achievements</h2><div class="sub">${done}/${list.length} unlocked</div>` + list.map((a) => `<div class="mrow ${a.done ? 'done' : 'cur'}"><div class="chk">${a.done ? '✓' : ''}</div><div style="flex:1"><b>${esc(a.title)}</b><small>${esc(a.desc)}</small><small>${Math.floor(a.value).toLocaleString('en-US')}/${a.target.toLocaleString('en-US')} · ${this.rewardHtml(a.reward)}</small>${this.bar(a.value / a.target)}</div></div>`).join('');
  }

  tplStage() {
    const pr = this.progression;
    const cur = pr.current, nxt = pr.next;
    let html = `<h2>🏙️ Stage ${pr.stage}: ${esc(cur.name)}</h2><div class="sub">${esc(cur.blurb)}</div>`;
    if (nxt) {
      const goals = pr.goalsFor(nxt.stage);
      html += `<div class="sect">Next: Stage ${nxt.stage} · ${esc(nxt.name)}</div><div class="sub">${esc(nxt.blurb)}</div>` + goals.map((g) => `<div class="mrow ${g.done ? 'done' : 'cur'}"><div class="chk">${g.done ? '✓' : ''}</div><div style="flex:1"><b>${esc(g.label)}</b><small>${Math.floor(g.value).toLocaleString('en-US')} / ${g.target.toLocaleString('en-US')}</small>${this.bar(g.value / g.target)}</div></div>`).join('')
        + `<div class="sub" style="margin-top:6px">Reward <b>${this.rewardHtml(nxt.reward)}</b> · unlocks: ${esc((nxt.unlocks || []).join(', '))}</div>`;
    } else html += '<div class="sub">You run a City EV Empire. Maximum stage reached.</div>';
    html += '<div class="sect">All stages</div>' + pr.stages.map((s) => `<div class="kv"><span>${s.stage <= pr.stage ? '✅' : '🔒'} Stage ${s.stage} · ${esc(s.name)}</span><b></b></div>`).join('');
    return html;
  }

  tplPower() {
    const st = this.station, p = st.power;
    if (!p) return '';
    const l = p.live;
    const per = { offpeak: 'off-peak', normal: 'normal', peak: 'PEAK' }[p.period()];
    return `<div class="sect">Power &amp; energy</div>
      <div class="kv"><span>Grid connection</span><b>${p.gridCapacityKw} kW</b></div>
      <div class="kv"><span>Charging efficiency</span><b>${(p.efficiency * 100).toFixed(1)}%</b></div>
      <div class="kv"><span>Electricity tariff now</span><b>${money(p.tariffNow, 2)}/kWh (${per})</b></div>
      <div class="kv"><span>Solar now / peak</span><b>${p.solarNowKw.toFixed(0)} / ${p.solarPeakKw} kW</b></div>
      <div class="kv"><span>Battery</span><b>${p.stored.toFixed(0)} / ${p.storageKwh} kWh</b></div>
      <div class="kv"><span>Charging demand</span><b>${l.demandKw.toFixed(0)} kW${l.factor < 0.999 ? ` · <span style="color:#d6453d">throttled to ${Math.round(l.factor * 100)}%</span>` : ''}</b></div>
      <div class="kv"><span>Grid / solar / battery today</span><b>${p.todayStats.gridKwh.toFixed(0)} / ${p.todayStats.solarKwh.toFixed(0)} / ${p.todayStats.batteryKwh.toFixed(0)} kWh</b></div>
      <div class="sub">Buy grid, efficiency, solar and storage in Business 🏢 → Upgrades. If the bays want more power than you can supply, every charger slows down.</div>`;
  }

  tplFinance2() {
    const eco = this.economy, hist = eco.history.slice(-7);
    const max = Math.max(1, ...hist.map((h) => Math.max(h.revenue, h.expenses)));
    const chart = hist.length ? `<div class="chart">${hist.map((h) => `<div class="col"><div class="bars"><i class="r" style="height:${(h.revenue / max) * 100}%"></i><i class="e" style="height:${(h.expenses / max) * 100}%"></i></div><small>D${h.day}</small><small class="${h.net >= 0 ? 'pos' : 'neg'}">${h.net >= 0 ? '+' : '−'}${Math.abs(Math.round(h.net))}</small></div>`).join('')}</div><div class="sub"><span style="color:var(--green-d)">■</span> revenue <span style="color:#d6453d">■</span> expenses</div>` : '<div class="sub">The chart fills in after your first full day.</div>';
    const s = this.stats.total;
    return `<div class="sect">Last ${hist.length || 7} days</div>${chart}
      <div class="sect">Lifetime</div>
      <div class="kv"><span>Total revenue</span><b>${money(eco.totalRevenue)}</b></div>
      <div class="kv"><span>Customers served</span><b>${s.served}</b></div>
      <div class="kv"><span>Charges / washes / repairs</span><b>${s.charged} / ${s.washed} / ${s.repaired}</b></div>
      <div class="kv"><span>Contracts completed</span><b>${s.contractsDone}</b></div>`;
  }

  tplOffline() {
    const r = this.game.pendingOffline;
    if (!r) return '<h2>Welcome back</h2><div class="sub">Nothing to collect.</div>';
    const h = Math.floor(r.seconds / 3600), m = Math.floor((r.seconds % 3600) / 60);
    return `<h2>👋 Welcome back!</h2><div class="sub">You were away for ${h}h ${m}m${r.capped ? ' (earnings are capped at 4 hours)' : ''}. Your team kept the business running.</div>
      <div class="kv"><span>Gross earnings</span><b class="pos">${money(r.gross, 2)}</b></div>
      <div class="kv"><span>Operating costs (power, supplies, parts)</span><b class="neg">−${money(r.operating, 2)}</b></div>
      <div class="kv"><span>Salaries</span><b class="neg">−${money(r.salaries, 2)}</b></div>
      <div class="kv"><span>Equipment upkeep</span><b class="neg">−${money(r.upkeep, 2)}</b></div>
      <div class="kv" style="border-top:2px solid var(--line)"><span><b>Net</b></span><b class="${r.net >= 0 ? 'pos' : 'neg'}">${r.net >= 0 ? '' : '−'}${money(Math.abs(r.net), 2)}</b></div>
      <button class="btn" data-ret="offline:claim">Collect</button>
      <button class="btn blue" data-ret="offline:ad" ${r.net > 0 ? '' : 'disabled'}>📺 Watch an ad: double the earnings (+${money(Math.max(0, r.net), 2)})</button>
      <div class="sub" style="margin-top:6px">The ad is optional. Nothing else is locked behind it.</div>`;
  }

  tplLogin() {
    const s = this.dailyReward.status();
    if (!s) return '<h2>🎁 Daily reward</h2><div class="sub">You already collected today\'s reward. Come back tomorrow!</div>';
    const cells = s.all.map((r, i) => `<div class="day ${i === s.dayIndex ? 'now' : i < s.dayIndex ? 'past' : ''}"><small>Day ${i + 1}</small><b>${r.cash ? '$' + r.cash.toLocaleString('en-US') : ''}</b>${r.gems ? `<span>${r.gems}💎</span>` : ''}</div>`).join('');
    return `<h2>🎁 Daily reward</h2><div class="sub">Log in every day to build a streak (day ${s.dayIndex + 1} of ${s.all.length}).</div><div class="days">${cells}</div>
      <button class="btn" data-ret="login:claim">Claim ${s.reward.cash ? money(s.reward.cash) : ''}${s.reward.gems ? ` + ${s.reward.gems}💎` : ''}</button>
      <button class="btn blue" data-ret="login:ad">📺 Watch an ad: claim double</button>`;
  }

  tplStageUp() {
    const s = this._stageUp;
    if (!s) return '<h2>Stage up!</h2>';
    return `<h2>🎉 Stage ${s.stage}: ${esc(s.name)}</h2><div class="sub">Your business has grown. Reward: <b>${this.rewardHtml(s.reward)}</b></div>
      <div class="sect">New unlocks</div>${(s.unlocks || []).map((u) => `<div class="kv"><span>✨ ${esc(u)}</span><b></b></div>`).join('') || '<div class="sub">—</div>'}
      <button class="btn blue" onclick="document.querySelector('[data-close]').click()">Continue</button>`;
  }

  async retAction(a) {
    const g = this.game;
    if (a === 'offline:claim') await g.claimOffline(false);
    else if (a === 'offline:ad') await g.claimOffline(true);
    else if (a === 'login:claim') { this.dailyReward.claim(1); this.toast('Daily reward collected', 'good'); this.closeModal(); }
    else if (a === 'login:ad') {
      const ok = await this.ads.showRewarded('daily-2x');
      this.dailyReward.claim(ok ? 2 : 1); this.toast(ok ? 'Double daily reward collected' : 'Daily reward collected', 'good'); this.closeModal();
    }
  }

  // ---------- Milestone 7: city map, property shop, hub manager, decoration bar ----------
  gateOf(p) {
    // a spot on the road just outside the lot's gate (matches each lot's orientation)
    if (p.id === 'hub_industrial') return { x: p.x, z: p.z - 24 };
    if (p.id === 'hub_highway') return { x: p.x - 24, z: p.z };
    return { x: p.x, z: p.z + 24 };
  }

  tplMap() {
    const ds = this.districts, props = this.properties.list();
    const key = (ix, iz) => `${ix},${iz}`;
    const sel = this.mapSel || '0,0';
    const colors = { downtown: '#7b8794', residential: '#5fbf4a', commercial: '#2fb4dc', industrial: '#e0902f', highway: '#9a52e8', park: '#3fae7a' };
    const P = this.game.player.pos;
    let cells = '';
    for (let iz = -2; iz <= 2; iz++) for (let ix = -2; ix <= 2; ix++) {
      const d = districtOfBlock(ix, iz);
      const lot = props.find((p) => p.x === ix * 60 && p.z === iz * 60);
      const locked = !ds.isUnlocked(d);
      const icon = ix === 0 && iz === 0 ? '⚡' : lot ? (lot.status === 'owned' ? '✅' : lot.status === 'locked' ? '🔒' : '💲') : locked ? '🔒' : '';
      const sub = ix === 0 && iz === 0 ? 'Home' : lot ? esc(lot.icon) : '';
      cells += `<button class="mcell ${locked ? 'locked' : ''} ${sel === key(ix, iz) ? 'sel' : ''}" data-map="${key(ix, iz)}" style="background:${colors[d]}">${icon}<small>${sub}</small></button>`;
    }
    const dot = `<div class="pdot" style="left:${((P.x + 150) / 300) * 100}%;top:${((P.z + 150) / 300) * 100}%"></div>`;
    const [sx, sz] = sel.split(',').map(Number), sd = districtOfBlock(sx, sz);
    const slot = props.find((p) => p.x === sx * 60 && p.z === sz * 60);
    const dc = ds.cfg[sd];
    let info = '';
    if (dc) {
      const dl = ds.lock(sd);
      info += `<div class="emp"><div class="emp-h"><span class="ic">${dc.icon}</span><b>${esc(dc.name)}</b><small>${ds.isUnlocked(sd) ? 'Open' : '🔒 Locked'}</small></div><div class="emp-s">${esc(dc.blurb)}</div>
        ${ds.isUnlocked(sd) ? '' : `<div class="emp-b"><button class="btn blue" data-district="${sd}" ${ds.canUnlock(sd) ? '' : 'disabled'}>${dl ? esc(dl) : `Buy district permit · ${money(dc.cost)}`}</button></div>`}</div>`;
    } else if (sd === 'park') info += '<div class="emp"><div class="emp-h"><span class="ic">🌳</span><b>City Park</b><small>Scenery</small></div><div class="emp-s">A green space with no lots for sale.</div></div>';
    if (sx === 0 && sz === 0) info += `<div class="emp"><div class="emp-h"><span class="ic">⚡</span><b>Home charging station</b><small>Owned</small></div><div class="emp-b"><button class="btn ghost" data-travel="0,18">📍 Travel here</button> <button class="btn ghost" data-open-biz="station">Open manager</button></div></div>`;
    if (slot) {
      const stat = slot.status === 'owned' ? '<span class="tag on">Owned</span>' : slot.status === 'locked' ? '<span class="tag">🔒 Locked</span>' : '<span class="tag busy">For sale</span>';
      const g = this.gateOf(slot);
      info += `<div class="emp"><div class="emp-h"><span class="ic">${slot.icon}</span><b>${esc(slot.name)}</b>${stat}</div>
        <div class="emp-s">${esc(slot.category)} · ${esc(slot.blurb)}<br>Price <b>${money(slot.price)}</b> · upkeep <b>${money(slot.upkeep)}</b>/day · property tax <b>${money(slot.tax, 2)}</b>/day · needs Stage <b>${slot.stage}</b></div>
        <div class="emp-b">
          ${slot.owned ? `<button class="btn blue" data-open-biz="${slot.kind === 'hub' ? 'hub_' + slot.id.slice(4) : slot.id}">Open manager</button>` : `<button class="btn" data-prop="${slot.id}" ${slot.canBuy ? '' : 'disabled'}>${slot.reason ? esc(slot.reason) : `Buy · ${money(slot.price)}`}</button>`}
          <button class="btn ghost" data-travel="${g.x},${g.z}">📍 Travel</button></div></div>`;
    }
    const owned = props.filter((p) => p.owned).length;
    return `<h2>🗺️ City map</h2><div class="sub">${owned}/${props.length} lots owned · property tax ${money(props.filter((p) => p.owned).reduce((s, p) => s + p.tax, 0), 2)}/day · cash ${money(this.economy.cash)}</div>
      <div class="legend"><span>✅ owned</span><span>💲 for sale</span><span>🔒 locked</span><span style="color:#e8483f">● you</span></div>
      <div class="map">${cells}${dot}</div>${info}
      <div class="sect">Districts</div>${Object.entries(ds.cfg).filter(([k]) => k !== 'downtown').map(([k, d]) => `<div class="kv"><span>${d.icon} ${esc(d.name)}</span><b>${ds.isUnlocked(k) ? '✅ open' : `Stage ${d.stage} · ${money(d.cost)}`}</b></div>`).join('')}`;
  }

  tplHub(key) {
    const h = this.hubs[key], eco = this.economy;
    if (!h) return '<h2>Hub</h2>';
    if (!h.built) return `<h2>${h.cfg.icon} ${esc(h.cfg.label)}</h2><div class="sub">Not built yet. Buy the lot in the City Map 🗺️.</div>`;
    const s = h.stats, cfg = h.hub;
    const stateText = { empty: 'Free', reserved: 'Car arriving', waiting: 'Waiting for plug-in', charging: 'Charging', done: 'Done' };
    const bays = h.bays.map((b, i) => {
      if (!b.unlocked) {
        const cost = h.nextBayCost();
        return `<div class="bay"><span class="n">Bay ${i + 1}</span><span class="st">Not built</span>${i === h.unlockedBays && cost !== null ? `<button class="btn" data-hub="${key}:addbay" ${eco.canAfford(cost) ? '' : 'disabled'}>Build ${money(cost)}</button>` : ''}</div>`;
      }
      const c = b.customer;
      return `<div class="bay"><span class="n">Bay ${i + 1}</span><span class="st"><b>${esc(stateText[b.state] || b.state)}</b>${c ? ` · ${esc(c.def.label)} ${esc(c.vehicle.label)}` : ''}${b.state === 'charging' ? ` · ${Math.round(b.vehicle.soc * 100)}% · ${b.power.toFixed(0)} kW` : ''}</span></div>`;
    }).join('');
    const nc = h.nextCharger();
    const att = this.employees.employees.filter((e) => e.role === 'attendant' && !e.leaving && this.employees.homeOf(e) === h.id).length;
    const rev = eco.ledger.revenue[h.cfg.revenueKey] || 0;
    return `<h2>${h.cfg.icon} ${esc(h.cfg.label)}</h2><div class="sub">${esc(cfg.category)} · ${h.unlockedBays} bays · ${h.charger.name} ${h.charger.kw} kW · ${att} attendant${att === 1 ? '' : 's'} · queue ${h.queue.length}/${h.maxQueue}</div>
      <div class="sect">Bays</div>${bays}
      <div class="sect">Price per kWh</div>
      <div class="stepper"><button data-hub="${key}:price:-">−</button><div class="val">${money(h.price, 2)}</div><button data-hub="${key}:price:+">+</button></div>
      <div class="sub" style="margin-top:6px">Home station price is ${money(this.station.pricePerKwh, 2)}. Premium and VIP drivers pay more but need fast chargers; price-sensitive customers leave if you charge too much.</div>
      <div class="sect">Upgrade</div>
      ${nc ? `<button class="btn blue" data-hub="${key}:charger" ${h.chargerLock() || !eco.canAfford(nc.cost) ? 'disabled' : ''}>${h.chargerLock() ? esc(h.chargerLock()) : `Chargers → ${esc(nc.name)} (${nc.kw} kW) · ${money(nc.cost)}`}</button>` : '<div class="sub">Chargers fully upgraded.</div>'}
      <div class="sub" style="margin-top:6px">Hire attendants in Staff 👥 and move them here with 📍. Daily upkeep ${money(h.unlockedBays * cfg.upkeepPerBayPerDay)} + property tax ${money(cfg.price * cfg.taxPerDay, 2)}.</div>
      <div class="sect">Results</div>
      <div class="kv"><span>Customers served</span><b>${s.served}</b></div>
      <div class="kv"><span>Revenue (today)</span><b class="pos">${money(rev, 2)}</b></div>
      <div class="kv"><span>Revenue (all time)</span><b class="pos">${money(s.revenue, 2)}</b></div>
      <div class="kv"><span>Avg satisfaction</span><b>${h.avgSatisfaction === null ? '—' : Math.round(h.avgSatisfaction) + '%'}</b></div>
      <div class="kv"><span>Lost customers</span><b>${s.lost}</b></div>
      <div class="sub">${Object.entries(s.lostBy).map(([k, v]) => `${v}× ${esc(k)}`).join(', ') || ''}</div>
      <div class="kv"><span>Decorations here</span><b>${this.placement.countFor(h.id)} · comfort +${this.placement.effects(h.id).comfort.toFixed(1)}</b></div>`;
  }

  hubAction(a) {
    const [key, act, dir] = a.split(':'), h = this.hubs[key];
    if (!h) return;
    if (act === 'price') h.setPrice(h.price + (dir === '+' ? 0.05 : -0.05));
    else if (act === 'addbay') h.addBay();
    else if (act === 'charger') h.upgradeCharger();
    this.renderModal();
  }

  mapAction(kind, v) {
    if (kind === 'cell') this.mapSel = v;
    else if (kind === 'district') { if (!this.districts.unlock(v)) this.toast('Cannot unlock that district yet'); }
    else if (kind === 'prop') { const r = this.properties.buy(v); this.toast(r.ok ? 'Property purchased! Hire attendants and set your prices.' : r.reason, r.ok ? 'good' : ''); }
    else if (kind === 'travel') { const [x, z] = v.split(',').map(Number); this.game.travelTo(x, z); this.closeModal(); return; }
    this.renderModal();
  }

  // ----- decoration bar (management mode) -----
  decorBarHtml(st) {
    const items = Object.entries(this.placement.items);
    const msg = st.mode === 'remove' ? 'Click a decoration to remove it (50% refund).' : !st.item ? 'Pick a decoration below.' : !st.pos ? 'Move over one of your lots.' : st.valid?.ok ? `Valid spot${this.game.touch ? ': tap Place ✓' : ': click to buy'} · ${st.pos.lot}` : (st.valid?.reason || '');
    const cls = st.mode === 'place' && st.pos ? (st.valid?.ok ? 'ok' : 'bad') : '';
    const eff = st.pos ? this.placement.effects(st.pos.lot) : null;
    return `<div class="db-items">${items.map(([k, it]) => `<button class="db-item ${st.item === k && st.mode === 'place' ? 'on' : ''}" data-decor="item:${k}" title="${esc(it.blurb)}"><span>${it.icon}</span>${esc(it.label)}<small>${money(it.cost)}</small></button>`).join('')}</div>
      <div class="db-ctl">
        <button class="btn ghost" data-decor="rotate">⟳ Rotate (T)</button>
        <button class="btn ${st.mode === 'remove' ? 'blue' : 'ghost'}" data-decor="remove">🗑 Remove</button>
        ${this.game.touch ? '<button class="btn" data-decor="confirm">Place ✓</button>' : ''}
        <button class="btn ghost" data-decor="done">Done</button>
      </div>
      <div class="db-msg ${cls}">${esc(msg)}${eff ? ` · this lot: comfort +${eff.comfort.toFixed(1)}, appeal +${Math.round(eff.appeal * 100)}%` : ''}</div>`;
  }

  renderDecorBar(st = null) {
    const bar = $('decor-bar');
    const state = st || { active: this.decor.active, mode: this.decor.mode, item: this.decor.item, pos: this.decor.pos, valid: this.decor.valid };
    bar.classList.toggle('hidden', !this.decorOpen);
    document.body.classList.toggle('decor-open', !!this.decorOpen);
    if (!this.decorOpen) return;
    bar.innerHTML = this.decorBarHtml(state);
    bar.querySelectorAll('[data-decor]').forEach((b) => (b.onclick = () => {
      const [a, v] = b.dataset.decor.split(':');
      if (a === 'item') this.decor.start(v);
      else if (a === 'rotate') this.decor.rotate();
      else if (a === 'remove') this.decor.startRemove();
      else if (a === 'confirm') this.decor.confirm();
      else if (a === 'done') this.closeDecor();
    }));
  }

  openDecor() {
    if (this.camera.mode !== 'management') return;
    this.decorOpen = true;
    this.clearSelection();
    this.renderDecorBar();
  }
  closeDecor() {
    this.decorOpen = false;
    this.decor.cancel();
    this.renderDecorBar();
  }

  tplCustomers() {
    const cm = this.customers, s = cm.stats, st = this.station;
    const q = cm.queue.map((c) => {
      const pf = Math.max(0, c.patience / c.maxPatience);
      return `<div class="bay"><span class="n">${c.def.icon}</span><span class="st"><b>${esc(c.def.label)}</b> · ${esc(c.vehicle.label)} (${esc(c.vehicle.connector.toUpperCase())})
        <div class="prog" style="margin-top:4px;height:8px"><i style="width:${pf * 100}%;background:${pf > 0.6 ? 'var(--green)' : pf > 0.3 ? '#e8a21c' : '#d6453d'}"></i></div></span></div>`;
    }).join('') || '<div class="sub">Nobody is waiting.</div>';
    const lost = Object.entries(s.lostBy).map(([k, v]) => `${v}× ${esc(k)}`).join(', ') || 'none';
    const sat = cm.avgSatisfaction;
    return `<div class="sect">Customers</div>
      <div class="kv"><span>Waiting queue</span><b>${cm.queue.length}/${cm.maxQueue}</b></div>${q}
      <div class="kv"><span>Accepted connectors</span><b>${esc(st.charger.connectors.map((x) => x.toUpperCase()).join(' · '))}</b></div>
      <div class="kv"><span>Avg satisfaction</span><b>${sat === null ? '—' : Math.round(sat) + '%'}</b></div>
      <div class="kv"><span>Happy / unhappy</span><b>${s.happy} / ${s.angry}</b></div>
      <div class="kv"><span>Tips earned</span><b class="pos">${money(s.tips, 2)}</b></div>
      <div class="kv"><span>Lost customers</span><b>${s.lost}</b></div>
      <div class="sub" style="margin:2px 0 0">${lost}</div>
      <div class="sub" style="margin:6px 0 0">Reputation ${this.economy.reputation}: higher reputation brings more customers and unlocks Premium (10), Fleet (15), VIP (30).</div>`;
  }

  tplFinance() {
    const eco = this.economy, L = eco.ledger, r = eco.lastReport;
    const lines = (obj) => Object.entries(obj).map(([k, v]) => `<div class="kv"><span style="text-transform:capitalize">${esc(k)}</span><b>${money(v, 2)}</b></div>`).join('') || '<div class="sub">Nothing yet.</div>';
    const net = eco.todayRevenue - eco.todayExpenses;
    return `<h2>💰 Finance</h2><div class="sub">Day ${this.day.day} so far</div>
      <div class="kv"><span>Cash on hand</span><b>${money(eco.cash, 2)}</b></div>
      <div class="sect">Revenue today</div>${lines(L.revenue)}
      <div class="sect">Expenses today</div>${lines(L.expenses)}
      <div class="kv" style="border-top:2px solid var(--line);margin-top:6px"><span><b>Net profit</b></span><b class="${net >= 0 ? 'pos' : 'neg'}">${money(net, 2)}</b></div>
      ${this.tplFinance2()}
      ${r ? `<div class="sect">Yesterday (Day ${r.day})</div>
      <div class="kv"><span>Revenue</span><b>${money(r.revenue, 2)}</b></div><div class="kv"><span>Expenses</span><b>${money(r.expenses, 2)}</b></div>
      <div class="kv"><span>Net</span><b class="${r.net >= 0 ? 'pos' : 'neg'}">${money(r.net, 2)}</b></div>` : ''}`;
  }

  tplMissions() {
    return `<h2>🏁 Missions</h2><div class="sub">Complete them in order for cash, gems and reputation.</div>` + this.missions.list().map((m) =>
      `<div class="mrow ${m.state}"><div class="chk">${m.state === 'done' ? '✓' : ''}</div><div><b>${esc(m.title)}</b><small>${esc(m.desc)}</small><small>Reward: ${this.rewardText(m.reward)}</small></div></div>`).join('');
  }

  showDayReport(r) {
    this._report = r;
    this.open('report');
  }
  tplReport() {
    const r = this._report;
    const lines = (o) => Object.entries(o).map(([k, v]) => `<div class="kv"><span style="text-transform:capitalize">${esc(k)}</span><b>${money(v, 2)}</b></div>`).join('') || '<div class="sub">—</div>';
    return `<h2>📊 Daily Report · Day ${r.day}</h2><div class="sub">${r.kwh} kWh sold</div>
      <div class="sect">Revenue</div>${lines(r.bySource)}<div class="sect">Expenses</div>${lines(r.byCategory)}
      <div class="kv" style="border-top:2px solid var(--line);margin-top:6px"><span><b>Net profit</b></span><b class="${r.net >= 0 ? 'pos' : 'neg'}">${money(r.net, 2)}</b></div>
      <button class="btn blue" data-close2 onclick="document.querySelector('[data-close]').click()">Continue</button>`;
  }

  tplPause() {
    const s = this.settings.data;
    return `<h2>⏸ Paused</h2><div class="sub">EV City Tycoon · Milestone 1</div>
      <button class="btn blue" data-pause="resume">Resume</button>
      <button class="btn ghost" data-pause="save">Save game</button>
      <button class="btn ghost" data-pause="tutorial">Replay tutorial</button>
      <div class="sect">Settings</div>
      <label class="opt">Graphics quality<select id="set-quality">${Object.keys(QUALITY).map((k) => `<option ${s.quality === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="opt">Camera sensitivity<input id="set-sens" type="range" min="0.4" max="2.2" step="0.1" value="${s.sensitivity}"></label>
      <label class="opt">Invert camera Y<input id="set-invert" type="checkbox" ${s.invertY ? 'checked' : ''}></label>
      <div class="sect">Controls</div>
      <div class="help"><kbd>WASD</kbd>/arrows, click the ground, or hold the mouse button and drag: move · <kbd>Shift</kbd> sprint · wheel: zoom · stand at a charger to connect automatically (or <kbd>E</kbd>) · <kbd>M</kbd> isometric management view · <kbd>Esc</kbd> menu.<br>
      Management view: drag to pan, wheel to zoom, <kbd>Q</kbd>/<kbd>R</kbd> rotate 90°, click equipment to select.<br>Touch: joystick or tap the ground to move, pinch to zoom.</div>
      <div class="sect">Data</div>
      <button class="btn ghost" data-pause="reset">Reset save…</button>`;
  }
}
