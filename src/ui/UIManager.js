import { $, esc, money, icon, hydrateIcons, siteCounts, MORE_MODALS } from './uiShared.js';
import { patchHtml } from './domPatch.js';
import { progressBar } from './components/ProgressBar.js';
import { tabStrip } from './components/Panel.js';
import { rewardText as rewardTextOf, rewardHtml as rewardHtmlOf } from './components/ResourceDisplay.js';
import { NotificationManager } from './NotificationManager.js';
import { ModalManager } from './ModalManager.js';
import { HUDManager } from './HUDManager.js';
import { StaffPanel } from './StaffPanel.js';
import { FinancePanel } from './FinancePanel.js';
import { MissionPanel } from './MissionPanel.js';
import { BusinessPanel } from './BusinessPanel.js';
import { BuildPanel } from './BuildPanel.js';
import { SystemPanels } from './SystemPanels.js';

export { money };

// panels that show continuously changing values (progress, timers) refresh a few times a second; the others refresh from events,
// with a slow safety net for values that depend only on the clock
const LIVE_MODALS = new Set(['station', 'wash', 'garage']);
const SLOW_MODALS = new Set(['finance', 'staff', 'business', 'map', 'missions', 'stats']);

/** HTML/CSS overlay: HUD, prompts, panels, pause menu. Reads state, never owns it. */
export class UIManager {
  constructor(ctx) {
    Object.assign(this, ctx); // bus, economy, station, missions, settings, game, camera, day
    this.modal = null;
    this.tab = { business: 'overview', missions: 'main' };
    this.selectionFn = null;
    this.shownCash = this.economy.cash;
    this.decorCat = 'Greenery';
    this._offs = []; // unsubscribe functions of every EventBus handler this UI registered
    this._listeners = []; // [target, type, fn, opts] of every global DOM listener
    hydrateIcons();
    this.bindHud();
    this.bindEvents();
    this.refreshMission(this.missions.snapshot());
  }

  /** Register a global DOM listener that dispose() can remove again. */
  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  /** Remove every listener and timer this UI created (the UI can be torn down and rebuilt without leaks). */
  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    for (const [t, type, fn, opts] of this._listeners) t.removeEventListener(type, fn, opts);
    this._listeners.length = 0;
    clearTimeout(this._rq); this._rq = null;
    this.termBtn?.remove(); this.termBtn = null;
    this.clearSelection();
    for (const id of ['hud', 'modal']) { const e = document.getElementById(id); if (e) e.inert = false; }
  }

  bindHud() {
    document.body.classList.toggle('touch', this.game.touch);
    $('btn-pause').onclick = () => this.togglePause();
    $('btn-mgmt').onclick = () => this.camera.toggle();
    $('btn-map').onclick = () => this.open('map');
    $('btn-decor').onclick = () => this.openDecor();
    $('btn-rot-l').onclick = () => this.camera.rotateIso(1);
    $('btn-rot-r').onclick = () => this.camera.rotateIso(-1);
    $('btn-zoom-in').onclick = () => this.camera.onZoom(-1.5);
    $('btn-zoom-out').onclick = () => this.camera.onZoom(1.5);
    $('btn-cam-reset').onclick = () => { this.camera.reset(); this.toast('Camera reset', 'info'); };
    // bottom navigation: tapping the open section again closes it
    document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { this.closeMore(); if (this.modal === b.dataset.open) this.closeModal(); else this.open(b.dataset.open); }));
    $('btn-more').onclick = (e) => { e.stopPropagation(); this.toggleMore(); };
    document.querySelectorAll('[data-more]').forEach((b) => (b.onclick = () => this.moreAction(b.dataset.more)));
    this.listen(window, 'pointerdown', (e) => { if (this.moreOpen && !e.target.closest('#more-menu, #btn-more')) this.closeMore(); }, true);
    const card0 = $('modal-card');
    card0.addEventListener('pointerdown', () => { this._ptrDown = true; });
    const release = () => { if (!this._ptrDown) return; this._ptrDown = false; setTimeout(() => { if (this._dirty && !this._ptrDown) { this._dirty = false; this.renderModal(); } }, 80); };
    this.listen(window, 'pointerup', release, true); this.listen(window, 'pointercancel', release, true);
    this.listen(window, 'keydown', (e) => this.trapTab(e), true);
    $('d-missions').onclick = () => { this.tab.missions = 'daily'; this.open('missions'); };
    // expandable overview: tap the stats row for the customer breakdown (state is remembered)
    const ds = $('d-stats'); let open = false; try { open = localStorage.getItem('evct.overview') === '1'; } catch (e) {}
    const setOv = (v) => { $('d-detail').hidden = !v; ds.setAttribute('aria-expanded', String(v)); $('daily').classList.toggle('ov-open', v); try { localStorage.setItem('evct.overview', v ? '1' : '0'); } catch (e) {} };
    ds.onclick = () => setOv($('d-detail').hidden);
    ds.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOv($('d-detail').hidden); } };
    setOv(open);
    $('mission').onclick = () => this.toggleObjective();
    $('mission').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleObjective(); } };
    $('btn-interact').onclick = () => this.game.interaction.interact();
    const sp = $('btn-sprint');
    sp.onclick = () => { this.game.input.sprintToggle = !this.game.input.sprintToggle; sp.classList.toggle('on', this.game.input.sprintToggle); };
    $('modal').addEventListener('pointerdown', (e) => { if (e.target === $('modal') && !['pause', 'offline', 'login'].includes(this.modal)) this.closeModal(); });
  }

  bindEvents() {
    const b = { on: (evt, fn) => { this._offs.push(this.bus.on(evt, fn)); } }; // tracked, so dispose() can unsubscribe
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
    b.on('ui:fire', (id) => this.confirmFire(id));
    b.on('station:changed', () => { if (this.modal === 'station') this.renderModal(); this.refreshSelection(); });
    b.on('economy:changed', () => { if (this.modal === 'finance') this.renderModal(); });
    // Statistics: refresh the moment anything it shows changes (coalesced, so a burst of events renders once)
    for (const ev of ['customer:paid', 'customer:lost', 'svc:paid', 'svc:lost', 'charging:complete', 'cash:earned', 'reputation:changed', 'contract:done', 'property:changed', 'economy:changed', 'employee:task-complete']) {
      b.on(ev, () => { if (this.modal === 'stats') this.scheduleRender(); });
    }
    b.on('toast', ({ text, kind }) => this.toast(text, kind));
    b.on('input:key', (code) => {
      if (code === 'Escape') {
        if (this.confirmOpen) this.resolveConfirm(false);
        else if (this.moreOpen) this.closeMore();
        else if (this.modal && !['pause', 'offline', 'login'].includes(this.modal)) this.closeModal();
        else if (this.selectionFn) this.clearSelection();
        else if (this.decorOpen) this.closeDecor();
        else this.togglePause();
      }
    });
  }

  rewardText(r) { return rewardTextOf(r); }

  update(dt) {
    this.updateTerminalButton();
    // animate cash counter
    const target = this.economy.cash;
    this.shownCash += (target - this.shownCash) * Math.min(1, dt * 8);
    if (Math.abs(target - this.shownCash) < 0.5) this.shownCash = target;
    $('v-cash').textContent = money(Math.round(this.shownCash));
    $('v-gems').textContent = this.economy.gems;
    $('v-rep').textContent = this.economy.reputation;
    $('v-day').textContent = `Day ${this.day.day}`;
    $('v-time').textContent = this.day.timeString;
    const sun = this.day.night > 0.5 ? 'moon' : this.day.hour < 8 || this.day.hour > 17.5 ? 'dusk' : 'sun';
    if ($('v-sun').dataset.icon !== sun) { $('v-sun').dataset.icon = sun; hydrateIcons($('topbar')); }
    this._dt = (this._dt || 0) + dt;
    if (this._dt > 0.4) { this._dt = 0; this.updateDaily(); }
    const live = LIVE_MODALS.has(this.modal) || String(this.modal).startsWith('hub_');
    if (live || SLOW_MODALS.has(this.modal)) {
      this._mt = (this._mt || 0) + dt;
      if (this._mt > (live ? 0.4 : 2)) { this._mt = 0; this.renderModal(); }
    }
    if (this.selectionFn) {
      this._st = (this._st || 0) + dt;
      if (this._st > 0.3) { this._st = 0; this.refreshSelection(); }
    }
  }

  // ---------- "More" menu ----------
  toggleMore() { this.moreOpen ? this.closeMore() : this.openMore(); }

  onMode(m) {
    const mg = m === 'management';
    document.body.classList.toggle('mgmt', mg);
    $('mgmt-label').textContent = mg ? 'Street' : 'Manage';
    $('btn-mgmt').setAttribute('aria-pressed', String(mg));
    $('btn-mgmt').title = mg ? 'Back to street view (M)' : 'Management camera (M)';
    const mi = $('btn-mgmt').querySelector('[data-icon]'); mi.dataset.icon = mg ? 'street' : 'layers'; hydrateIcons($('btn-mgmt'));
    $('mgmt-hint').classList.toggle('hidden', !mg);
    if (m !== 'management') { this.clearSelection(); if (this.decorOpen) this.closeDecor(); }
  }

  // ---------- selection card (management mode) ----------
  showSelection(fn) {
    this.selectionFn = fn;
    this.refreshSelection();
  }
  clearSelection() {
    this.selectionFn = null;
    this._selKey = null;
    $('selection').classList.add('hidden');
    document.body.classList.remove('sel-open');
    this.game.selectionRing.visible = false;
    this.game.setSelectionOutline(null);
  }
  /** Contextual panel for the selected 3D object. Actions come from the object's real state; `kind` picks the button style. */
  refreshSelection() {
    const el = $('selection');
    if (!this.selectionFn) return;
    const info = this.selectionFn();
    if (!info) return this.clearSelection();
    // management view: every selected object can be centred with one tap
    if (this.camera.inManagement && this.game.selectionRing.visible) {
      const at = this.game.selectionRing.position;
      info.actions = [...info.actions, { label: 'Focus camera', kind: 'secondary', cb: () => this.camera.focusOn(at) }];
    }
    const key = JSON.stringify([info.title, info.rows, info.actions.map((a) => [a.label, !!a.disabled, a.kind || '', a.reason || ''])]);
    if (key === this._selKey) return;
    this._selKey = key;
    el.classList.remove('hidden');
    document.body.classList.add('sel-open');
    el.innerHTML = `<div class="sel-head"><div><h3>${esc(info.title)}</h3><div class="sub">${esc(info.subtitle || '')}</div></div><button class="x" data-sel-close title="Close" aria-label="Close">${icon('close', 16)}</button></div>
      ${info.rows.length ? `<div class="rows">${info.rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>` : ''}
      <div class="sel-actions">${info.actions.map((a, i) => `<button class="btn ${a.kind === 'secondary' ? 'ghost' : a.kind === 'danger' ? 'danger' : ''}" data-a="${i}" ${a.disabled ? 'disabled' : ''}>${esc(a.label)}</button>`).join('')}
        <button class="btn ghost" data-sel-close>Close</button></div>
      ${info.actions.some((a) => a.disabled) ? `<div class="sel-why" role="note">${info.actions.filter((a) => a.disabled).map((a) => `<div><b>${esc(a.label.split(' · ')[0])}</b>: ${esc(a.reason || 'Not available right now')}</div>`).join('')}</div>` : ''}`;
    el.onpointerdown = el.onpointerup = el.onclick = (e) => e.stopPropagation(); // never reaches the 3D scene underneath
    el.querySelectorAll('[data-sel-close]').forEach((b) => (b.onclick = () => this.clearSelection()));
    el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => { info.actions[b.dataset.a].cb(); this._selKey = null; if (this.selectionFn) this.refreshSelection(); }));
  }

  // ---------- modals ----------
  /** Opens one management board at a time (opening another replaces it). 'upgrades' is the Business board's Upgrades tab. */
  open(name) {
    if (name === 'upgrades') { this.tab.business = 'upgrades'; name = 'business'; }
    this.closeMore();
    if (this.confirmOpen) this.resolveConfirm(false);
    if (this.selectionFn) this.clearSelection(); // one panel at a time
    const keepPaused = this.modal === 'pause' && MORE_MODALS.includes(name); // pause -> settings / help / save stays paused
    if (!this.modal) this._returnFocus = document.activeElement; // where focus goes back to when the board closes
    this.modal = name;
    this._pauseRendered = false; this._modalHtml = null; this._dirty = false;
    $('modal').classList.remove('hidden');
    this.game.setPaused(name === 'pause' || keepPaused);
    this.renderModal();
    this.syncNav();
    this.syncBlocking();
    this.focusInto($('modal-card'));
  }
  closeModal() {
    if (this.modal === 'offline' && this.game.pendingOffline) { this.offline.apply(this.game.pendingOffline, 1); this.game.pendingOffline = null; this.toast('Offline earnings collected', 'good'); }
    const wasOffline = this.modal === 'offline';
    this.modal = null;
    $('modal').classList.add('hidden');
    this.game.setPaused(false);
    this.syncNav();
    this.syncBlocking();
    this.restoreFocus();
    if (wasOffline && this.dailyReward.status()) this.open('login');
  }

  togglePause() {
    if (this.modal === 'pause') this.closeModal();
    else this.open('pause');
  }

  /** Render the open panel soon (events can arrive in bursts: they share one render). */
  scheduleRender() {
    if (this._rq) return;
    this._rq = setTimeout(() => { this._rq = null; this.renderModal(); }, 120);
  }

  renderModal() {
    const card = $('modal-card');
    const m = this.modal;
    if (!m) return;
    // never swap the buttons out from under a press: a periodic refresh between pointer-down and click would eat the click
    if (this._ptrDown) { this._dirty = true; return; }
    // avoid rebuilding while the user is dragging a slider / has a select open
    if ((m === 'pause' || m === 'settings') && this._pauseRendered) return;
    const body = ({
      settings: () => this.tplSettings(), stats: () => this.tplStats(), help: () => this.tplHelp(), save: () => this.tplSave(),
      station: () => this.tplStation(), staff: () => this.tplStaff(), finance: () => this.tplFinance(),
      business: () => this.tplBusinessTabs(), wash: () => this.tplWash(), garage: () => this.tplGarage(),
      offline: () => this.tplOffline(), login: () => this.tplLogin(), stageup: () => this.tplStageUp(), map: () => this.tplMap(), missions: () => this.tplMissionsTabs(),
      pause: () => this.tplPause(), report: () => this.tplReport(),
    }[m] || (() => (String(m).startsWith('hub_') ? this.tplHub(m.slice(4)) : '')))();
    // the system uses SVG icons in navigation and controls: decorative emoji are dropped from board titles
    const html = (`<button class="x" data-close title="Close" aria-label="Close">${icon('close', 16)}</button>` + body).replace(/(<h2[^>]*>)(?:\p{Extended_Pictographic}️?\s*)+/u, '$1');
    if (html === this._modalHtml && m === this._modalName) return; // nothing changed: keep the live DOM (and any press in progress)
    const same = m === this._modalName && card.firstElementChild; // same panel, new values: patch in place (keeps scroll, focus, selection)
    this._modalHtml = html; this._modalName = m;
    const keepScroll = card.scrollTop;
    if (same) patchHtml(card, html); else card.innerHTML = html;
    card.scrollTop = keepScroll;
    card.querySelector('[data-close]').onclick = () => this.closeModal();
    this._pauseRendered = m === 'pause' || m === 'settings';
    this.bindModal(card);
  }

  bindModal(card) {
    const st = this.station, eco = this.economy;
    card.querySelectorAll('[data-bay-act]').forEach((b) => (b.onclick = () => {
      const [act, id] = b.dataset.bayAct.split(':'); const i = +id;
      if (act === 'start') st.startCharging(i); else if (act === 'stop') st.stopCharging(i); else if (act === 'build') this.guard(st.cfg.bayCost, `Build bay ${i + 1}`, () => st.buyBay(i));
    }));
    const pm = card.querySelector('[data-price="-"]'), pp = card.querySelector('[data-price="+"]');
    if (pm) pm.onclick = () => st.setPrice(st.pricePerKwh - 0.05);
    if (pp) pp.onclick = () => st.setPrice(st.pricePerKwh + 0.05);
    const up = card.querySelector('[data-upgrade]');
    if (up) up.onclick = () => { const nx = st.nextChargerUpgrade(); this.guard(nx ? nx.cost : 0, `Upgrade chargers to ${nx?.name}`, () => st.upgradeChargers()); };
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
    card.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => {
      const it = this.upgrades.list().find((i) => i.id === b.dataset.up);
      this.guard(it ? it.cost : 0, `Buy ${it?.name}`, () => { const r = this.upgrades.buy(b.dataset.up); if (!r.ok && r.reason) this.toast(r.reason, 'warn'); else if (r.ok && !/^(bay|chargers|power:)/.test(it.id)) this.toast(`${it?.name} upgraded`, 'good'); this.renderModal(); });
    }));
    card.querySelectorAll('[data-contract]').forEach((b) => (b.onclick = () => { const [, id] = b.dataset.contract.split(':'); const r = this.contracts.accept(id); this.toast(r.ok ? 'Contract accepted' : r.reason, r.ok ? 'good' : ''); this.renderModal(); }));
    card.querySelectorAll('[data-ret]').forEach((b) => (b.onclick = () => this.retAction(b.dataset.ret)));
    card.querySelectorAll('[data-open-biz]').forEach((b) => (b.onclick = () => this.open(b.dataset.openBiz)));
    const ar = card.querySelector('#set-autorestock');
    if (ar) ar.onchange = () => { this.garage.autoRestock = ar.checked; };
    card.querySelectorAll('[data-pause]').forEach((b) => (b.onclick = () => this.pauseAction(b.dataset.pause)));
    void eco;
  }

  // ---------- small helpers shared by the panel modules ----------
  tabs(name, list) { return tabStrip(name, this.tab[name], list); }
  bar(frac, color = 'var(--green)') { return progressBar(frac, color); }
  rewardHtml(r) { return rewardHtmlOf(r); }

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

}

// the panel modules own their methods; copy them (getters included) onto the UIManager prototype
for (const mixin of [NotificationManager, ModalManager, HUDManager, StaffPanel, FinancePanel, MissionPanel, BusinessPanel, BuildPanel, SystemPanels]) {
  Object.defineProperties(UIManager.prototype, Object.getOwnPropertyDescriptors(mixin));
}
