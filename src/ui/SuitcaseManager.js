import { money } from './UIManager.js';

/**
 * Flying suitcase: now and then a winged suitcase drifts across the screen. Tap it, watch a (rewarded, optional)
 * ad and the cash inside is yours. The reward is paid through EconomyManager.grant; the ad goes through AdService.
 * It never appears while a board / dialog is open, the game is paused, or the tutorial is running.
 */
const FLIGHT_SECONDS = 13;
const FIRST_DELAY = 25;

export class SuitcaseManager {
  constructor({ game }) {
    this.g = game;
    this.timer = FIRST_DELAY;
    this.el = null;
    this.t = 0;
    this.dir = 1;
    this.y0 = 0.3;
    this.busy = false; // dialog / ad in progress
    this.claimed = 0;
  }

  /** Cash in the case: grows with progress and the day's takings, rounded to 50. */
  reward() {
    const g = this.g, eco = g.economy;
    const raw = 400 + g.progression.stage * 250 + Math.min(eco.todayRevenue * 0.25, 2500);
    return Math.max(500, Math.round(raw / 50) * 50);
  }

  spawn() {
    if (this.el) return false;
    const el = document.createElement('button');
    el.id = 'suitcase';
    el.type = 'button';
    el.setAttribute('aria-label', 'Flying suitcase: watch an ad for free cash');
    el.innerHTML = `<svg viewBox="0 0 96 64" width="112" height="75" aria-hidden="true">
        <path d="M8 22c10-2 18 2 22 10-8 0-18-2-22-10z" fill="#9fd8ff" stroke="#142B42" stroke-width="2" stroke-linejoin="round"/>
        <path d="M88 22c-10-2-18 2-22 10 8 0 18-2 22-10z" fill="#9fd8ff" stroke="#142B42" stroke-width="2" stroke-linejoin="round"/>
        <rect x="26" y="22" width="44" height="32" rx="6" fill="#c2763a" stroke="#142B42" stroke-width="2.5"/>
        <path d="M40 22v-5a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v5" fill="none" stroke="#142B42" stroke-width="3" stroke-linecap="round"/>
        <rect x="26" y="34" width="44" height="5" fill="#a85f2b"/>
        <rect x="43" y="32" width="10" height="9" rx="2" fill="#ffd24d" stroke="#142B42" stroke-width="2"/>
        <circle cx="12" cy="18" r="0" fill="none"/>
      </svg><span class="sc-tag">FREE $</span>`;
    el.onclick = () => this.tap();
    document.getElementById('hud').appendChild(el);
    this.el = el;
    this.t = 0;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.y0 = 0.2 + Math.random() * 0.25;
    this.place();
    return true;
  }

  place() {
    const k = this.t / FLIGHT_SECONDS;
    const w = innerWidth + 140;
    const x = (this.dir > 0 ? -70 + w * k : innerWidth + 70 - w * k);
    const y = innerHeight * this.y0 + Math.sin(this.t * 2.4) * 16;
    this.el.style.transform = `translate(${x}px, ${y}px) rotate(${Math.sin(this.t * 2.4 + 1) * 5}deg) scaleX(${this.dir > 0 ? 1 : -1})`;
    const tag = this.el.querySelector('.sc-tag');
    if (tag) tag.style.transform = `scaleX(${this.dir > 0 ? 1 : -1})`;
  }

  remove() {
    this.el?.remove();
    this.el = null;
    this.timer = 70 + Math.random() * 40;
  }

  async tap() {
    if (this.busy || !this.el) return;
    const ui = this.g.ui, amount = this.reward();
    this.busy = true;
    const yes = await ui.askConfirm({ title: 'Free cash!', text: `Watch a short ad to open the suitcase and get ${money(amount)}.`, yes: 'Watch ad', no: 'No thanks' });
    let ok = false;
    if (yes) ok = await this.g.ads.showRewarded('suitcase');
    this.busy = false;
    if (yes && ok) {
      this.g.economy.grant({ cash: amount });
      this.claimed++;
      ui.toast(`Suitcase opened: +${money(amount)}!`, 'good');
      ui.floater(`+${money(amount)}`);
      this.remove();
    } else if (yes) ui.toast('Ad not completed: no reward', 'warn');
  }

  update(dt) {
    const g = this.g;
    if (g.paused || this.busy) return;
    if (window.__NO_TUTORIAL && !this.el) return; // automated tests: no random spawns (spawn() can still be called)
    if (this.el) {
      this.t += dt;
      if (this.t >= FLIGHT_SECONDS) this.remove(); // flew away
      else this.place();
      return;
    }
    const blocked = g.ui.modal || g.ui.confirmOpen || (g.tutorial && !g.tutorial.done);
    if (blocked) return;
    this.timer -= dt;
    if (this.timer <= 0) this.spawn();
  }
}
