import { $, money, siteCounts, MORE_MODALS } from './uiShared.js';

/**
 * Heads-up display: daily overview, objective strip, prompt, more-menu, bottom navigation, floating terminal button.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const HUDManager = {
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
  },

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
  },

  toggleObjective(force) {
    const el = $('mission'), open = force ?? !el.classList.contains('open');
    el.classList.toggle('open', open);
    el.setAttribute('aria-expanded', String(open));
  },

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
  },

  closeMore() {
    if (!this.moreOpen) return;
    this.moreOpen = false;
    $('more-menu').classList.add('hidden');
    $('btn-more').setAttribute('aria-expanded', 'false');
    this.syncNav();
  },

  moreAction(a) {
    this.closeMore();
    if (a === 'tutorial') { if (this.modal) this.closeModal(); this.game.tutorial?.restart(); return; }
    this.open(a);
  },

  /** Selected state of the bottom navigation. */
  syncNav() {
    document.body.classList.toggle('nav-over', !!this.modal && !['pause', 'offline', 'login', 'stageup', 'report'].includes(this.modal));
    document.querySelectorAll('.sc[data-open]').forEach((b) => b.classList.toggle('on', this.modal === b.dataset.open));
    $('btn-more').classList.toggle('on', !!this.moreOpen || MORE_MODALS.includes(this.modal));
  },

  setLocation(name) {
    const t = `${name} · Stage ${this.progression.stage}`;
    if ($('v-loc').textContent !== t) $('v-loc').textContent = t;
  },

  setPrompt(p) {
    $('prompt').classList.toggle('hidden', !p);
    if (p) $('prompt-text').textContent = p.text;
    $('btn-interact').hidden = !p || !!p.noKey;
    const k = $('prompt').querySelector('kbd');
    if (k) k.style.display = p?.noKey ? 'none' : '';
  },

  refreshMission(s) {
    $('m-title').textContent = s.title;
    $('m-desc').textContent = s.desc;
    $('m-fill').style.width = `${(s.progress / s.target) * 100}%`;
    $('m-count').textContent = s.done ? '' : s.target >= 100 ? `${money(Math.floor(s.progress))} / ${money(s.target)}` : `${Math.floor(s.progress)} / ${s.target}`;
    $('m-reward').textContent = s.done ? '' : this.rewardText(s.reward);
  },
};
