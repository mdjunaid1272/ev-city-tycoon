import { $, money, siteCounts, aggregateStats, MORE_MODALS } from './uiShared.js';

/**
 * Heads-up display: daily overview, objective strip, prompt, more-menu, bottom navigation, floating terminal button.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const HUDManager = {
  // ---------- HUD ----------
  /**
   * A button that floats above a spot in the world (terminal, cafe counter) and is shown in street view when the player is near it.
   * One button per key is created once and reused; dispose() removes them.
   */
  floatingButton(key, { id, html, pos, y = 2.6, show = true, onClick }) {
    const map = (this._floatBtns ||= {});
    let b = map[key];
    if (!b) {
      b = map[key] = document.createElement('button');
      b.id = id;
      b.type = 'button';
      b.innerHTML = html;
      b.onclick = (ev) => { ev.stopPropagation(); onClick(); };
      // keep clicks / drags on the button from also walking the character
      for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) b.addEventListener(t, (ev) => ev.stopPropagation());
      document.body.appendChild(b);
    }
    const g = this.game, pp = g.player.pos;
    const near = show && !g.camera.inManagement && !g.camera.transitioning && !this.modal && !g.paused && Math.hypot(pos.x - pp.x, pos.z - pp.z) < 7;
    if (!near) { if (b.style.display !== 'none') b.style.display = 'none'; return; }
    const v = pos.clone(); v.y += y; v.project(g.sm.camera);
    b.style.display = 'block';
    b.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    b.style.top = `${((1 - v.y) / 2) * innerHeight - 4 + Math.sin(performance.now() / 380) * 4}px`;
  },

  /** Floating buttons: "Open" at the station terminal, "Cafe" at the cafe counter once the cafe exists. */
  updateTerminalButton() {
    const g = this.game;
    this.floatingButton('term', { id: 'term-open', html: '<span>🖥️</span> Open', pos: g.stationView.terminalPos, y: 2.6, onClick: () => this.open('station') });
    if (this.cafe && g.cafeView) {
      this.floatingButton('cafe', { id: 'cafe-open', html: '<span>☕</span> Caf\u00e9', pos: g.cafeView.buttonPos(), y: g.cafeView.inside ? 0.9 : 3.4, show: this.cafe.built, onClick: () => { if (!this.game.goToCafe()) this.open('cafe'); } }); // first tap: walk inside to take orders; once there: the board
    }
  },

  /** Daily overview: revenue today, customers on site, satisfaction. */
  updateDaily() {
    // every customer is counted once: queued customers already live in their business's customer map (see SiteCounts)
    const c = siteCounts([this.customers, this.wash, this.garage, ...Object.values(this.hubs || {}), this.cafe]);
    const active = c.onSite;
    const setT = (id, v) => { const e = $(id); if (e && e.textContent !== String(v)) e.textContent = v; };
    setT('dd-cafe', c.cafe); setT('dd-arriving', c.arriving); setT('dd-queued', c.queued); setT('dd-waiting', c.waiting); setT('dd-charging', c.charging); setT('dd-service', c.service);
    const sat = aggregateStats([this.customers, this.wash, this.garage, ...Object.values(this.hubs || {}), this.cafe]).avgSatisfaction; // all businesses
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
