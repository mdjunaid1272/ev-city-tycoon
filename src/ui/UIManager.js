import { QUALITY } from '../core/Settings.js';
import { districtOfBlock } from '../world/DistrictManager.js';
import { icon, hydrateIcons } from './icons.js';
import { siteCounts } from '../customers/SiteCounts.js';
import { patchHtml } from './domPatch.js';

// panels that show continuously changing values (progress, timers) refresh a few times a second; the others refresh from events,
// with a slow safety net for values that depend only on the clock
const LIVE_MODALS = new Set(['station', 'wash', 'garage']);
const SLOW_MODALS = new Set(['finance', 'staff', 'business', 'map', 'missions', 'stats']);

const $ = (id) => document.getElementById(id);
const CONFIRM_COST = 10000; // purchases at or above this price ask for confirmation
const NAV_MODALS = ['business', 'staff', 'finance', 'missions'];
const MORE_MODALS = ['settings', 'stats', 'help', 'save', 'pause'];
const DECOR_CATS = { Greenery: ['tree', 'planter'], Seating: ['bench', 'picnic'], Lighting: ['lamp'], Signs: ['banner'] };
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
    this.decorCat = 'Greenery';
    hydrateIcons();
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
    $('btn-zoom-in').onclick = () => this.camera.onZoom(-1.5);
    $('btn-zoom-out').onclick = () => this.camera.onZoom(1.5);
    $('btn-cam-reset').onclick = () => { this.camera.reset(); this.toast('Camera reset', 'info'); };
    // bottom navigation: tapping the open section again closes it
    document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { this.closeMore(); if (this.modal === b.dataset.open) this.closeModal(); else this.open(b.dataset.open); }));
    $('btn-more').onclick = (e) => { e.stopPropagation(); this.toggleMore(); };
    document.querySelectorAll('[data-more]').forEach((b) => (b.onclick = () => this.moreAction(b.dataset.more)));
    addEventListener('pointerdown', (e) => { if (this.moreOpen && !e.target.closest('#more-menu, #btn-more')) this.closeMore(); }, true);
    const card0 = $('modal-card');
    card0.addEventListener('pointerdown', () => { this._ptrDown = true; });
    const release = () => { if (!this._ptrDown) return; this._ptrDown = false; setTimeout(() => { if (this._dirty && !this._ptrDown) { this._dirty = false; this.renderModal(); } }, 80); };
    addEventListener('pointerup', release, true); addEventListener('pointercancel', release, true);
    addEventListener('keydown', (e) => this.trapTab(e), true);
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

  rewardText(r) {
    const p = [];
    if (r.cash) p.push(`+${money(r.cash)}`);
    if (r.gems) p.push(`+${r.gems}💎`);
    if (r.reputation) p.push(`+${r.reputation}⭐`);
    return p.join(' ');
  }

  // ---------- HUD ----------
  /** Floating "Open" button above the station terminal: shown in street view when the player is near it. */
  updateTerminalButton() {
    let b = this.termBtn;
    if (!b) {
      b = this.termBtn = document.createElement('button');
      b.id = 'term-open';
      b.type = 'button';
      b.innerHTML = '<span>🖥️</span> Open';
      b.onclick = (ev) => { ev.stopPropagation(); this.open('station'); };
      // keep clicks / drags on the button from also walking the character
      for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) b.addEventListener(t, (ev) => ev.stopPropagation());
      document.body.appendChild(b);
    }
    const g = this.game, tp = g.stationView.terminalPos, pp = g.player.pos;
    const near = !g.camera.inManagement && !g.camera.transitioning && !this.modal && !g.paused && Math.hypot(tp.x - pp.x, tp.z - pp.z) < 7;
    if (!near) { if (b.style.display !== 'none') b.style.display = 'none'; return; }
    const v = tp.clone(); v.y += 2.6; v.project(g.sm.camera);
    b.style.display = 'block';
    b.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    b.style.top = `${((1 - v.y) / 2) * innerHeight - 4 + Math.sin(performance.now() / 380) * 4}px`;
  }

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

  /** Daily overview: revenue today, customers on site, satisfaction. */
  updateDaily() {
    // every customer is counted once: queued customers already live in their business's customer map (see SiteCounts)
    const c = siteCounts([this.customers, this.wash, this.garage, ...Object.values(this.hubs || {})]);
    const active = c.onSite;
    const setT = (id, v) => { const e = $(id); if (e && e.textContent !== String(v)) e.textContent = v; };
    setT('dd-queued', c.queued); setT('dd-waiting', c.waiting); setT('dd-charging', c.charging); setT('dd-service', c.service);
    const sat = this.customers.avgSatisfaction;
    $('d-rev').textContent = money(Math.round(this.economy.todayRevenue));
    setT('d-cust', active);
    { const gl = this.goals, dn = gl.daily.filter((g) => g.done).length; $('d-dm-count').textContent = `${dn}/${gl.daily.length}`; $('d-dm-fill').style.width = `${gl.daily.length ? (dn / gl.daily.length) * 100 : 0}%`; $('d-missions').classList.toggle('all', gl.daily.length > 0 && dn === gl.daily.length); }
    $('d-sat').textContent = sat === null || sat === undefined ? '—' : `${Math.round(sat)}%`;
  }

  toggleObjective(force) {
    const el = $('mission'), open = force ?? !el.classList.contains('open');
    el.classList.toggle('open', open);
    el.setAttribute('aria-expanded', String(open));
  }

  // ---------- "More" menu ----------
  toggleMore() { this.moreOpen ? this.closeMore() : this.openMore(); }
  openMore() {
    const menu = $('more-menu'), btn = $('btn-more').getBoundingClientRect();
    this.moreOpen = true;
    menu.classList.remove('hidden');
    $('btn-more').setAttribute('aria-expanded', 'true');
    if (!document.body.classList.contains('touch') && innerWidth > 760) {
      const w = menu.offsetWidth || 220;
      menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, btn.right - w))}px`;
    } else menu.style.left = '';
    this.syncNav();
  }
  closeMore() {
    if (!this.moreOpen) return;
    this.moreOpen = false;
    $('more-menu').classList.add('hidden');
    $('btn-more').setAttribute('aria-expanded', 'false');
    this.syncNav();
  }
  moreAction(a) {
    this.closeMore();
    if (a === 'tutorial') { if (this.modal) this.closeModal(); this.game.tutorial?.restart(); return; }
    this.open(a);
  }

  /** Selected state of the bottom navigation. */
  syncNav() {
    document.body.classList.toggle('nav-over', !!this.modal && !['pause', 'offline', 'login', 'stageup', 'report'].includes(this.modal));
    document.querySelectorAll('.sc[data-open]').forEach((b) => b.classList.toggle('on', this.modal === b.dataset.open));
    $('btn-more').classList.toggle('on', !!this.moreOpen || MORE_MODALS.includes(this.modal));
  }

  setLocation(name) {
    const t = `${name} · Stage ${this.progression.stage}`;
    if ($('v-loc').textContent !== t) $('v-loc').textContent = t;
  }

  setPrompt(p) {
    $('prompt').classList.toggle('hidden', !p);
    if (p) $('prompt-text').textContent = p.text;
    $('btn-interact').hidden = !p || !!p.noKey;
    const k = $('prompt').querySelector('kbd');
    if (k) k.style.display = p?.noKey ? 'none' : '';
  }

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

  refreshMission(s) {
    $('m-title').textContent = s.title;
    $('m-desc').textContent = s.desc;
    $('m-fill').style.width = `${(s.progress / s.target) * 100}%`;
    $('m-count').textContent = s.done ? '' : s.target >= 100 ? `${money(Math.floor(s.progress))} / ${money(s.target)}` : `${Math.floor(s.progress)} / ${s.target}`;
    $('m-reward').textContent = s.done ? '' : this.rewardText(s.reward);
  }

  /** Toast kinds: good (success) · warn · error · info. Untyped messages are classified from their text. */
  toastKind(text) {
    if (/not enough|insufficient|no (available|free)|\bfull\b|capacity|too expensive|limit|out of parts|left|unhappy|quit|failed|reputation −/i.test(text)) return 'warn';
    if (/cannot|can't|could not|couldn't|invalid|unavailable|refused|unlocks at|permit first|already|no .* connector|not available|missing|in the way|occupied|outside|keep driveways|you do not own/i.test(text)) return 'error';
    return 'info';
  }
  toast(text, kind = '') {
    if (!kind) kind = this.toastKind(String(text));
    const ic = { good: 'check', warn: 'warn', error: 'error', info: 'info' }[kind] || 'info';
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = `<span class="ti">${icon(ic, 18)}</span><span class="tt"></span>`;
    t.querySelector('.tt').textContent = text;
    $('toasts').appendChild(t);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
    setTimeout(() => t.remove(), 3500);
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
    this._selKey = null;
    $('selection').classList.add('hidden');
    document.body.classList.remove('sel-open');
    this.game.selectionRing.visible = false;
  }
  /** Contextual panel for the selected 3D object. Actions come from the object's real state; `kind` picks the button style. */
  refreshSelection() {
    const el = $('selection');
    if (!this.selectionFn) return;
    const info = this.selectionFn();
    if (!info) return this.clearSelection();
    const key = JSON.stringify([info.title, info.rows, info.actions.map((a) => [a.label, !!a.disabled, a.kind || ''])]);
    if (key === this._selKey) return;
    this._selKey = key;
    el.classList.remove('hidden');
    document.body.classList.add('sel-open');
    el.innerHTML = `<div class="sel-head"><div><h3>${esc(info.title)}</h3><div class="sub">${esc(info.subtitle || '')}</div></div><button class="x" data-sel-close title="Close" aria-label="Close">${icon('close', 16)}</button></div>
      ${info.rows.length ? `<div class="rows">${info.rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>` : ''}
      <div class="sel-actions">${info.actions.map((a, i) => `<button class="btn ${a.kind === 'secondary' ? 'ghost' : a.kind === 'danger' ? 'danger' : ''}" data-a="${i}" ${a.disabled ? 'disabled' : ''}>${esc(a.label)}</button>`).join('')}
        <button class="btn ghost" data-sel-close>Close</button></div>`;
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

  // ---------- keyboard focus + blocking dialogs ----------
  /** Boards that must be answered before anything behind them can be used. */
  get blocking() { return !!this.confirmOpen || ['pause', 'offline', 'login', 'stageup', 'report'].includes(this.modal) || (!!this.modal && !!this.game.paused); }

  /** While a blocking dialog is open the world UI behind it can be neither clicked nor tabbed to. */
  syncBlocking() {
    const hud = $('hud'), modal = $('modal');
    const hudOff = this.blocking, modalOff = !!this.confirmOpen;
    if (hud.inert !== hudOff) hud.inert = hudOff;
    if (modal.inert !== modalOff) modal.inert = modalOff;
  }

  focusables(root) {
    return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null && el.getAttribute('tabindex') !== '-1');
  }

  focusInto(root) {
    if (!root) return;
    root.focus({ preventScroll: true }); // the dialog itself: the next Tab lands on its first control
  }

  restoreFocus() {
    const el = this._returnFocus; this._returnFocus = null;
    if (el && el.isConnected && typeof el.focus === 'function' && el !== document.body) { try { el.focus({ preventScroll: true }); } catch (e) { /* element is gone */ } }
  }

  /** Tab / Shift+Tab never leave the open dialog. */
  trapTab(e) {
    if (e.key !== 'Tab') return;
    const root = this.confirmOpen ? $('confirm-card') : this.modal ? $('modal-card') : null;
    if (!root) return;
    const list = this.focusables(root);
    if (!list.length) { e.preventDefault(); root.focus(); return; }
    const first = list[0], last = list[list.length - 1], at = document.activeElement;
    if (!root.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (at === first || at === root)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }

  // ---------- confirmation dialog (expensive purchases, destructive actions) ----------
  /** Resolves true/false. `danger` styles the confirm button as destructive. */
  askConfirm({ title, text, yes = 'Confirm', no = 'Cancel', danger = false }) {
    if (this.confirmOpen) this.resolveConfirm(false);
    return new Promise((resolve) => {
      this._confirmReturn = document.activeElement;
      this.confirmOpen = resolve;
      $('confirm-card').innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p>
        <div class="row"><button class="btn ghost" data-cf="no">${esc(no)}</button><button class="btn ${danger ? 'danger solid' : ''}" data-cf="yes">${esc(yes)}</button></div>`;
      $('confirm').classList.remove('hidden');
      $('confirm-card').querySelector('[data-cf="no"]').onclick = () => this.resolveConfirm(false);
      $('confirm-card').querySelector('[data-cf="yes"]').onclick = () => this.resolveConfirm(true);
      $('confirm').onpointerdown = (e) => { if (e.target === $('confirm')) this.resolveConfirm(false); };
      this.syncBlocking();
      $('confirm-card').querySelector('[data-cf="no"]').focus({ preventScroll: true }); // the safe answer is focused first
    });
  }
  resolveConfirm(v) {
    const r = this.confirmOpen;
    if (!r) return;
    this.confirmOpen = null;
    $('confirm').classList.add('hidden');
    this.syncBlocking();
    const back = this._confirmReturn; this._confirmReturn = null;
    if (back && back.isConnected && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
    r(v);
  }
  /** Run `fn` straight away for cheap actions; ask first when the price reaches CONFIRM_COST. */
  guard(cost, what, fn) {
    if (cost < CONFIRM_COST) return fn();
    this.askConfirm({ title: 'Confirm purchase', text: `${what} for ${money(cost)}?`, yes: `Buy · ${money(cost)}` }).then((ok) => { if (ok) { fn(); if (this.modal) this.renderModal(); } });
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
    }
    this.renderModal();
  }

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
  }

  pauseAction(a) {
    if (a === 'resume') this.closeModal();
    else if (a === 'tutorial') { this.closeModal(); this.game.tutorial?.restart(); }
    else if (a === 'settings' || a === 'help' || a === 'save') this.open(a);
    else if (a === 'save-now') {
      this.game.save().then(() => { this.toast('Game saved', 'good'); if (this.modal === 'save') { this._pauseRendered = false; this.renderModal(); } });
    } else if (a === 'reset') {
      this.askConfirm({ title: 'Reset save?', text: 'This deletes your save and restarts the game. It cannot be undone.', yes: 'Delete & restart', danger: true }).then((ok) => { if (ok) this.game.resetSave(); });
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
      const lvl = key === 'wash' ? biz.equipLevel + 1 : Math.max(biz.scannerLevel, biz.toolLevel) + 1;
      return card(cfg.icon, esc(cfg.label), `<span class="tag on">Open</span><span class="tag">Lv ${lvl}</span>`,
        `${biz.unlockedBays} bays · queue <b>${biz.queue.length}/${biz.maxQueue}</b><br>Customers served <b>${s.served}</b> · revenue today <b>${money(rev[cfg.revenueKey] || 0, 2)}</b>`,
        `<button class="btn" data-open-biz="${key}">Manage</button>`);
    };
    return `<h2>🏢 Businesses</h2><div class="sub">Reputation ${eco.reputation} · connected services: charging customers may drive on to the wash or garage.</div>
      ${card('⚡', 'Charging Station', `<span class="tag on">Open</span><span class="tag">Lv ${st.chargerLevel}</span>`, `${st.unlockedCount} bays · ${st.charger.name} ${st.charger.kw} kW<br>Customers served today <b>${st.todayServed}</b> · revenue today <b>${money(rev.charging || 0, 2)}</b>`, '<button class="btn" data-open-biz="station">Manage</button>')}
      ${svc(this.wash, 'wash')}${svc(this.garage, 'garage')}
      ${Object.entries(this.hubs).map(([k, h]) => (h.built ? card(h.cfg.icon, esc(h.cfg.label), `<span class="tag on">Open</span><span class="tag">Lv ${(h.chargerLevel ?? 0) + 1}</span>`, `${h.unlockedBays} bays · ${h.charger.kw} kW<br>Customers served <b>${h.stats.served}</b> · revenue today <b>${money(this.economy.ledger.revenue[h.cfg.revenueKey] || 0, 2)}</b>`, `<button class="btn" data-open-biz="hub_${k}">Manage</button>`) : '')).join('')}
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
    const act = p[1], cfg = biz.cfg;
    const cost = { build: cfg.buildCost, addbay: biz.nextBayCost?.(), addlift: biz.nextLiftCost?.(), equip: biz.nextEquipment?.()?.cost, tunnel: cfg.tunnelCost,
      upgrade: p[2] === 'scanner' ? cfg.scanner?.[biz.scannerLevel]?.cost : p[2] === 'tools' ? cfg.tools?.[biz.toolLevel]?.cost : cfg.batteryStationCost }[act] || 0;
    const run = () => {
      if (act === 'build') { const r = biz.build(); this.toast(r.ok ? `${cfg.label} built! Hire staff to run it.` : r.reason, r.ok ? 'good' : 'error'); }
      else if (act === 'addbay') biz.addBay();
      else if (act === 'addlift') biz.addLift();
      else if (act === 'equip') biz.upgradeEquipment();
      else if (act === 'tunnel') biz.upgradeTunnel(+p[2]);
      else if (act === 'upgrade') biz.upgrade(p[2]);
    };
    if (['build', 'addbay', 'addlift', 'equip', 'tunnel', 'upgrade'].includes(act)) { this.guard(cost, `${{ build: 'Build', addbay: 'Build a bay at', addlift: 'Build a lift at', equip: 'Upgrade equipment at', tunnel: 'Install a tunnel at', upgrade: 'Upgrade' }[act]} the ${cfg.label}`, run); this.renderModal(); return; }
    if (act === 'part') { if (!biz.buyPart(p[2], +p[3])) this.toast('Cannot buy that part'); }
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
      const cash = x.stat === 'revenue' || x.stat === 'tips', fmt = (v) => (cash ? money(Math.floor(v)) : Math.floor(v).toLocaleString('en-US'));
      const prog = x.stat2 ? `${Math.floor(p.a)}/${x.target} · ${Math.floor(p.b)}/${x.target2}` : `${fmt(p.a)}/${fmt(x.target)}`;
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
    else if (act === 'addbay') this.guard(h.nextBayCost() || 0, `Build a bay at ${h.cfg.label}`, () => h.addBay());
    else if (act === 'charger') this.guard(h.nextCharger()?.cost || 0, `Upgrade chargers at ${h.cfg.label}`, () => h.upgradeCharger());
    this.renderModal();
  }

  mapAction(kind, v) {
    if (kind === 'cell') this.mapSel = v;
    else if (kind === 'district') { this.guard(this.districts.cfg[v]?.cost || 0, `Buy the ${this.districts.cfg[v]?.name} permit`, () => { if (!this.districts.unlock(v)) this.toast('Cannot unlock that district yet', 'error'); }); }
    else if (kind === 'prop') { const e = this.properties.list().find((p) => p.id === v); this.guard(e?.price || 0, `Buy ${e?.name}`, () => { const r = this.properties.buy(v); this.toast(r.ok ? 'Property purchased! Hire attendants and set your prices.' : r.reason, r.ok ? 'good' : 'error'); }); }
    else if (kind === 'travel') { const [x, z] = v.split(',').map(Number); this.game.travelTo(x, z); this.closeModal(); return; }
    this.renderModal();
  }

  // ----- decoration bar (management mode) -----
  /** Build-mode toolbar: categories, items with cost, info, placement feedback, rotate / undo / redo / remove / confirm / cancel. */
  decorBarHtml(st) {
    const pm = this.placement, all = pm.items;
    const cats = Object.entries(DECOR_CATS).map(([name, ids]) => [name, ids.filter((id) => all[id])]).filter(([, ids]) => ids.length);
    const known = new Set(cats.flatMap(([, ids]) => ids));
    const other = Object.keys(all).filter((id) => !known.has(id));
    if (other.length) cats.push(['Other', other]);
    const catName = cats.some(([n]) => n === this.decorCat) ? this.decorCat : cats[0][0];
    const shown = cats.find(([n]) => n === catName)[1];
    const sel = st.item ? all[st.item] : null;
    const placing = st.mode === 'place' && st.item;
    const msg = st.mode === 'remove' ? 'Click a decoration to remove it (50% refund).' : !st.item ? 'Pick something to build.' : !st.pos ? 'Move over one of your lots.' : st.valid?.ok ? `Valid spot${this.game.touch ? ': tap Confirm' : ': click or press Confirm to buy'}` : (st.valid?.reason || '');
    const cls = st.mode === 'place' && st.pos ? (st.valid?.ok ? 'ok' : 'bad') : '';
    const eff = st.pos ? pm.effects(st.pos.lot) : null;
    const info = sel && st.mode === 'place' ? `${sel.blurb} · ${money(sel.cost)}${sel.comfort ? ` · comfort +${sel.comfort}` : ''}${sel.appeal ? ` · appeal +${Math.round(sel.appeal * 1000) / 10}%` : ''}${sel.night ? ` · night +${Math.round(sel.night * 100)}%` : ''}` : '';
    const btn = (a, ic, label, extra = '', dis = false) => `<button class="btn ${extra}" data-decor="${a}" ${dis ? 'disabled' : ''}>${icon(ic, 18)}${label}</button>`;
    return `<div class="db-head"><div class="db-title">${icon('build', 18)}Build mode</div>
        <div class="db-cats">${cats.map(([n]) => `<button class="chip ${n === catName ? 'on' : ''}" data-decor="cat:${n}">${esc(n)}</button>`).join('')}</div>
        <button class="ibtn" data-decor="done" title="Exit build mode" aria-label="Exit build mode">${icon('close', 18)}</button></div>
      <div class="db-items">${shown.map((k) => { const it = all[k]; return `<button class="db-item ${st.item === k && st.mode === 'place' ? 'on' : ''} ${this.economy.canAfford(it.cost) ? '' : 'poor'}" data-decor="item:${k}" title="${esc(it.blurb)}"><span>${it.icon}</span>${esc(it.label)}<small>${money(it.cost)}</small></button>`; }).join('')}</div>
      <div class="db-info">${esc(info)}</div>
      <div class="db-ctl">
        ${btn('rotate', 'rotate', 'Rotate (T)', 'ghost', !placing)}
        ${pm.canUndo || pm.canRedo ? btn('undo', 'undo', 'Undo', 'ghost', !pm.canUndo) + btn('redo', 'redo', 'Redo', 'ghost', !pm.canRedo) : ''}
        ${btn('remove', 'trash', 'Remove', st.mode === 'remove' ? '' : 'ghost')}
        ${placing ? btn('confirm', 'check', 'Confirm', '', !st.pos || !st.valid?.ok) : ''}
        ${placing || st.mode === 'remove' ? btn('cancel', 'close', 'Cancel', 'ghost') : ''}
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
      else if (a === 'cat') { this.decorCat = v; this.renderDecorBar(); }
      else if (a === 'rotate') this.decor.rotate();
      else if (a === 'remove') this.decor.startRemove();
      else if (a === 'confirm') { const r = this.decor.confirm(); if (r?.ok) this.toast(`${this.placement.items[this.decor.item]?.label || 'Item'} built`, 'good'); }
      else if (a === 'cancel') { this.decor.cancel(); this.renderDecorBar(); }
      else if (a === 'undo' || a === 'redo') { const r = this.placement[a](); this.toast(r.ok ? r.what : r.reason, r.ok ? 'info' : 'warn'); this.renderDecorBar(); }
      else if (a === 'done') this.closeDecor();
    }));
  }

  openDecor() {
    if (this.camera.mode !== 'management') return;
    this.decorOpen = true;
    this.clearSelection();
    this.placement.clearHistory();
    this.renderDecorBar();
  }
  closeDecor() {
    this.decorOpen = false;
    this.decor.cancel();
    this.placement.clearHistory();
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
    const revEntries = Object.entries(L.revenue).sort((a, b) => b[1] - a[1]), revMax = Math.max(1, ...revEntries.map(([, v]) => v));
    const byBiz = revEntries.map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><div class="track"><i style="width:${(v / revMax) * 100}%"></i></div><b>${money(v, 2)}</b></div>`).join('') || '<div class="sub">Nothing earned yet today.</div>';
    return `<h2>Finance</h2><div class="sub">Day ${this.day.day} so far · cash on hand <b>${money(eco.cash, 2)}</b></div>
      <div class="tiles">
        <div class="tile"><small>Revenue today</small><b class="pos">${money(eco.todayRevenue, 2)}</b></div>
        <div class="tile"><small>Expenses today</small><b class="neg">${money(eco.todayExpenses, 2)}</b></div>
        <div class="tile"><small>Net profit</small><b class="${net >= 0 ? 'pos' : 'neg'}">${money(net, 2)}</b></div>
        <div class="tile"><small>Total revenue (all time)</small><b>${money(eco.totalRevenue)}</b></div>
        <div class="tile"><small>Electricity today</small><b>${money(L.expenses.electricity || 0, 2)}</b></div>
        <div class="tile"><small>Salaries (per day)</small><b>${money(this.employees.dailyPayroll, 2)}</b></div>
      </div>
      <div class="sect">Revenue by business</div>${byBiz}
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
    return `<h2>Paused</h2><div class="sub">The game is paused while this menu is open.</div>
      <button class="btn blue" data-pause="resume">Resume</button>
      <button class="btn ghost" data-pause="settings">Settings</button>
      <button class="btn ghost" data-pause="help">Help &amp; controls</button>
      <button class="btn ghost" data-pause="tutorial">Replay tutorial</button>
      <button class="btn ghost" data-pause="save">Save information</button>`;
  }

  tplSettings() {
    const s = this.settings.data;
    return `<h2>Settings</h2><div class="sub">Changes apply immediately and are remembered on this device.</div>
      <label class="opt">Graphics quality<select id="set-quality">${Object.keys(QUALITY).map((k) => `<option ${s.quality === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="opt">Camera sensitivity<input id="set-sens" type="range" min="0.4" max="2.2" step="0.1" value="${s.sensitivity}"></label>
      <label class="opt">Invert camera Y<input id="set-invert" type="checkbox" ${s.invertY ? 'checked' : ''}></label>`;
  }

  tplHelp() {
    return `<h2>Help</h2><div class="sub">How to play EV City Tycoon.</div>
      <div class="sect">Moving around</div>
      <div class="help"><kbd>WASD</kbd> / arrows, click the ground, or hold the mouse button and drag. <kbd>Shift</kbd> sprints. Touch: joystick, or tap the ground.</div>
      <div class="sect">Running the station</div>
      <div class="help">Stand beside a bay and a waiting car connects by itself. Click a charger to stop its charge and bill the customer. Open the terminal for prices and upgrades. Hire attendants in <b>Staff</b> so cars are connected and billed while you are away.</div>
      <div class="sect">Camera</div>
      <div class="help">Wheel / pinch or the zoom buttons: zoom. <kbd>M</kbd>: management view (drag to pan, <kbd>Q</kbd>/<kbd>R</kbd> rotate, click equipment to select). The target button resets the camera.</div>
      <div class="sect">Building</div>
      <div class="help">In management view press <b>Build</b> to place decorations on your lots (<kbd>T</kbd> rotates). Buy new lots and district permits on the City map.</div>
      <button class="btn ghost" data-pause="tutorial">Replay the tutorial</button>`;
  }

  tplSave() {
    const last = this.game.lastSaved ? new Date(this.game.lastSaved).toLocaleTimeString() : 'not yet this session';
    return `<h2>Save information</h2><div class="sub">Your game saves automatically every 15 seconds, when you leave the tab, and when you press Save.</div>
      <div class="kv"><span>Storage</span><b>This device (browser)</b></div>
      <div class="kv"><span>Last save</span><b>${esc(last)}</b></div>
      <div class="kv"><span>Day / Stage</span><b>Day ${this.day.day} · Stage ${this.progression.stage}</b></div>
      <button class="btn blue" data-pause="save-now">Save now</button>
      <div class="sect">Danger zone</div>
      <button class="btn danger" data-pause="reset">Reset save…</button>`;
  }

  tplStats() {
    const s = this.stats.total, eco = this.economy, cm = this.customers.stats, sat = this.customers.avgSatisfaction;
    return `<h2>Statistics</h2><div class="sub">Lifetime numbers for your business.</div>
      <div class="tiles">
        <div class="tile"><small>Customers served</small><b>${s.served}</b></div>
        <div class="tile"><small>Total revenue</small><b class="pos">${money(eco.totalRevenue)}</b></div>
        <div class="tile"><small>Satisfaction</small><b>${sat === null || sat === undefined ? '—' : Math.round(sat) + '%'}</b></div>
        <div class="tile"><small>Reputation</small><b>${eco.reputation} ★</b></div>
      </div>
      <div class="sect">Services</div>
      <div class="kv"><span>Charges</span><b>${s.charged}</b></div><div class="kv"><span>Car washes</span><b>${s.washed}</b></div><div class="kv"><span>Repairs</span><b>${s.repaired}</b></div>
      <div class="kv"><span>Contracts completed</span><b>${s.contractsDone}</b></div>
      <div class="sect">Customers</div>
      <div class="kv"><span>Happy / unhappy</span><b>${cm.happy} / ${cm.angry}</b></div>
      <div class="kv"><span>Tips earned</span><b class="pos">${money(cm.tips, 2)}</b></div>
      <div class="kv"><span>Lost customers</span><b>${cm.lost}</b></div>
      <div class="kv"><span>Properties owned</span><b>${this.properties.ownedCount}</b></div>
      ${this.tplFinance2()}`;
  }
}
