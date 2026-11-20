import { esc, money, QUALITY } from './uiShared.js';

/**
 * Pause, settings, help, save, offline-earnings, daily-login and stage-up screens.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const SystemPanels = {
  tplPause() {
    return `<h2>Paused</h2><div class="sub">The game is paused while this menu is open.</div>
      <button class="btn blue" data-pause="resume">Resume</button>
      <button class="btn ghost" data-pause="settings">Settings</button>
      <button class="btn ghost" data-pause="help">Help &amp; controls</button>
      <button class="btn ghost" data-pause="tutorial">Replay tutorial</button>
      <button class="btn ghost" data-pause="save">Save information</button>`;
  },

  tplSettings() {
    const s = this.settings.data;
    return `<h2>Settings</h2><div class="sub">Changes apply immediately and are remembered on this device.</div>
      <label class="opt">Graphics quality<select id="set-quality">${Object.keys(QUALITY).map((k) => `<option ${s.quality === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="opt">Camera sensitivity<input id="set-sens" type="range" min="0.4" max="2.2" step="0.1" value="${s.sensitivity}"></label>
      <label class="opt">Invert camera Y<input id="set-invert" type="checkbox" ${s.invertY ? 'checked' : ''}></label>`;
  },

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
  },

  tplSave() {
    const last = this.game.lastSaved ? new Date(this.game.lastSaved).toLocaleTimeString() : 'not yet this session';
    return `<h2>Save information</h2><div class="sub">Your game saves automatically every 15 seconds, when you leave the tab, and when you press Save.</div>
      <div class="kv"><span>Storage</span><b>This device (browser)</b></div>
      <div class="kv"><span>Last save</span><b>${esc(last)}</b></div>
      <div class="kv"><span>Day / Stage</span><b>Day ${this.day.day} · Stage ${this.progression.stage}</b></div>
      <button class="btn blue" data-pause="save-now">Save now</button>
      <div class="sect">Danger zone</div>
      <button class="btn danger" data-pause="reset">Reset save…</button>`;
  },

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
  },

  tplLogin() {
    const s = this.dailyReward.status();
    if (!s) return '<h2>🎁 Daily reward</h2><div class="sub">You already collected today\'s reward. Come back tomorrow!</div>';
    const cells = s.all.map((r, i) => `<div class="day ${i === s.dayIndex ? 'now' : i < s.dayIndex ? 'past' : ''}"><small>Day ${i + 1}</small><b>${r.cash ? '$' + r.cash.toLocaleString('en-US') : ''}</b>${r.gems ? `<span>${r.gems}💎</span>` : ''}</div>`).join('');
    return `<h2>🎁 Daily reward</h2><div class="sub">Log in every day to build a streak (day ${s.dayIndex + 1} of ${s.all.length}).</div><div class="days">${cells}</div>
      <button class="btn" data-ret="login:claim">Claim ${s.reward.cash ? money(s.reward.cash) : ''}${s.reward.gems ? ` + ${s.reward.gems}💎` : ''}</button>
      <button class="btn blue" data-ret="login:ad">📺 Watch an ad: claim double</button>`;
  },

  tplStageUp() {
    const s = this._stageUp;
    if (!s) return '<h2>Stage up!</h2>';
    return `<h2>🎉 Stage ${s.stage}: ${esc(s.name)}</h2><div class="sub">Your business has grown. Reward: <b>${this.rewardHtml(s.reward)}</b></div>
      <div class="sect">New unlocks</div>${(s.unlocks || []).map((u) => `<div class="kv"><span>✨ ${esc(u)}</span><b></b></div>`).join('') || '<div class="sub">—</div>'}
      <button class="btn blue" onclick="document.querySelector('[data-close]').click()">Continue</button>`;
  },

  pauseAction(a) {
    if (a === 'resume') this.closeModal();
    else if (a === 'tutorial') { this.closeModal(); this.game.tutorial?.restart(); }
    else if (a === 'settings' || a === 'help' || a === 'save') this.open(a);
    else if (a === 'save-now') {
      this.game.save().then(() => { this.toast('Game saved', 'good'); if (this.modal === 'save') { this._pauseRendered = false; this.renderModal(); } });
    } else if (a === 'reset') {
      this.askConfirm({ title: 'Reset save?', text: 'This deletes your save and restarts the game. It cannot be undone.', yes: 'Delete & restart', danger: true }).then((ok) => { if (ok) this.game.resetSave(); });
    }
  },
};
