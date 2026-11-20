import { esc, money } from './uiShared.js';
import { AVATARS, OUTFITS, NAME_MAX } from '../player/PlayerProfile.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const duration = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };

/**
 * Player profile board: identity (name, avatar, outfit) and the career summary (level, title, stats, badges).
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const ProfilePanel = {
  profileContext() {
    const s = this.stats.total;
    return { served: s.served, revenue: this.economy.totalRevenue, stage: this.progression.stage, days: this.day.day, contracts: s.contractsDone, charged: s.charged, washed: s.washed, repaired: s.repaired };
  },

  tplProfile() {
    const p = this.game.profile, sum = p.summary(this.profileContext());
    const pr = this.progression;
    const earned = sum.badges.filter((b) => b.earned).length;
    const since = new Date(p.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return `<h2>Profile</h2>
      <div class="prof-head">
        <div class="prof-ava" aria-hidden="true">${p.avatar}</div>
        <div class="prof-id">
          <label class="prof-lbl" for="prof-name">Name</label>
          <input id="prof-name" type="text" maxlength="${NAME_MAX}" value="${esc(p.name)}" autocomplete="off" spellcheck="false" enterkeyhint="done">
          <div class="prof-title"><b>${esc(sum.title)}</b> · Level ${sum.level} · Stage ${pr.stage}</div>
        </div>
      </div>
      <div class="prof-xp">${this.bar(sum.frac, 'var(--blue, #2f8cff)')}<small>${money(Math.max(0, sum.xp))} / ${money(sum.xpNeed)} earned towards level ${sum.level + 1}</small></div>
      ${this.profileStages()}
      <div class="sect">Avatar</div>
      <div class="prof-grid" role="radiogroup" aria-label="Avatar">${AVATARS.map((a) => `<button class="prof-opt${a === p.avatar ? ' on' : ''}" role="radio" aria-checked="${a === p.avatar}" data-profile="avatar:${a}" aria-label="Avatar ${a}">${a}</button>`).join('')}</div>
      <div class="sect">Outfit</div>
      <div class="prof-grid" role="radiogroup" aria-label="Outfit colour">${OUTFITS.map((o) => `<button class="prof-sw${o.id === p.outfit ? ' on' : ''}" role="radio" aria-checked="${o.id === p.outfit}" data-profile="outfit:${o.id}" aria-label="${o.name} outfit" style="--shirt:${hex(o.shirt)};--hat:${hex(o.hat)}"><i></i></button>`).join('')}</div>
      <div class="sect">Time played</div>
      <div class="kv"><span>Playtime</span><b>${duration(p.playSeconds)}</b></div>
      <div class="kv"><span>Playing since</span><b>${esc(since)}</b></div>
      <div class="sect">Badges (${earned}/${sum.badges.length})</div>
      <div class="prof-badges">${sum.badges.map((b) => `<div class="bd${b.earned ? ' on' : ''}" title="${esc(b.desc)}"><span>${b.earned ? b.icon : '🔒'}</span><small>${esc(b.name)}</small></div>`).join('')}</div>`;
  },

  /** Stage track (done / current / locked), the current stage, and the next stage's goals with live progress. */
  profileStages() {
    const pr = this.progression, nxt = pr.next;
    const track = pr.stages.map((s) => {
      const st = s.stage < pr.stage ? 'done' : s.stage === pr.stage ? 'cur' : 'lock';
      return `<li class="st ${st}"${st === 'cur' ? ' aria-current="step"' : ''}><i>${st === 'done' ? '✓' : st === 'lock' ? '🔒' : s.stage}</i><small>${esc(s.name)}</small></li>`;
    }).join('');
    let html = `<div class="sect">Stages (${pr.stage}/${pr.stages.length})</div><ol class="stage-track">${track}</ol>`;
    const future = pr.stages.filter((x) => x.stage > pr.stage);
    if (future.length) {
      this._profOpen = this._profOpen || new Map(); // the player's own expand / collapse choices survive the live refresh
      html += '<div class="sect">Stage targets</div>' + future.map((x) => {
        const goals = pr.goalsFor(x.stage), done = goals.filter((g) => g.done).length;
        const frac = goals.length ? goals.reduce((t, g) => t + Math.min(1, g.value / g.target), 0) / goals.length : 1;
        const isNext = nxt && x.stage === nxt.stage;
        const open = this._profOpen.has(x.stage) ? this._profOpen.get(x.stage) : isNext;
        return `<details class="stage-board${isNext ? ' next' : ''}" data-stage-n="${x.stage}"${open ? ' open' : ''}>
          <summary${isNext ? ' class="prof-next"' : ''}><b>${isNext ? 'Next: ' : ''}Stage ${x.stage} · ${esc(x.name)}</b><em>${done}/${goals.length} goals · ${Math.round(frac * 100)}%</em>${this.bar(frac)}</summary>
          ${goals.map((g) => `<div class="mrow ${g.done ? 'done' : 'cur'}"><div class="chk">${g.done ? '✓' : ''}</div><div style="flex:1"><b>${esc(g.label)}</b><small>${Math.floor(g.value).toLocaleString('en-US')} / ${g.target.toLocaleString('en-US')}</small>${this.bar(g.value / g.target)}</div></div>`).join('')}
          <div class="sub" style="margin-top:6px">Reward <b>${this.rewardHtml(x.reward)}</b>${x.unlocks?.length ? ` · unlocks: ${esc(x.unlocks.join(', '))}` : ''}</div>
        </details>`;
      }).join('');
    } else html += '<div class="sub">Maximum stage reached: you run a City EV Empire.</div>';
    return html;
  },

  bindProfile(card) {
    const input = card.querySelector('#prof-name');
    if (!input) return;
    const p = this.game.profile;
    const commit = () => {
      if (p.setName(input.value)) input.value = p.name;
      else { input.value = p.name; this.toast('Names need at least one letter or number', 'warn'); }
    };
    input.onchange = commit;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); return; }
      if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); // typing W A S D must never walk the player
    };
    input.onkeyup = (e) => e.stopPropagation();
    card.querySelectorAll('details[data-stage-n]').forEach((d) => (d.ontoggle = () => { (this._profOpen = this._profOpen || new Map()).set(+d.dataset.stageN, d.open); }));
    card.querySelectorAll('[data-profile]').forEach((b) => (b.onclick = () => {
      const [kind, value] = b.dataset.profile.split(':');
      const changed = kind === 'avatar' ? p.setAvatar(value) : p.setOutfit(value);
      if (changed) { this._pauseRendered = false; this.renderModal(); }
    }));
  },

  /** Keep the top-bar avatar button in step with the profile. */
  syncProfileChip() {
    const p = this.game.profile, btn = document.getElementById('btn-profile'), av = document.getElementById('v-avatar');
    if (!btn || !p) return;
    if (av && av.textContent !== p.avatar) av.textContent = p.avatar;
    btn.title = `${p.name} · Profile`;
    btn.setAttribute('aria-label', `Profile: ${p.name}`);
  },
};
