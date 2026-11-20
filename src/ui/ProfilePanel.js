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
    const p = this.game.profile, sum = p.summary(this.profileContext()), s = this.stats.total;
    const pr = this.progression;
    const earned = sum.badges.filter((b) => b.earned).length;
    const since = new Date(p.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return `<h2>Profile</h2><div class="sub">Your boss card. Changes save automatically.</div>
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
      <div class="sect">Career</div>
      <div class="kv"><span>Playtime</span><b>${duration(p.playSeconds)}</b></div>
      <div class="kv"><span>Playing since</span><b>${esc(since)}</b></div>
      <div class="kv"><span>City day / stage</span><b>Day ${this.day.day} · Stage ${this.progression.stage}</b></div>
      <div class="kv"><span>Total revenue</span><b>${money(this.economy.totalRevenue)}</b></div>
      <div class="kv"><span>Customers served</span><b>${s.served}</b></div>
      <div class="sect">Badges (${earned}/${sum.badges.length})</div>
      <div class="prof-badges">${sum.badges.map((b) => `<div class="bd${b.earned ? ' on' : ''}" title="${esc(b.desc)}"><span>${b.earned ? b.icon : '🔒'}</span><small>${esc(b.name)}</small><em>${esc(b.desc)}</em></div>`).join('')}</div>`;
  },

  /** Stage track (done / current / locked), the current stage, and the next stage's goals with live progress. */
  profileStages() {
    const pr = this.progression, cur = pr.current, nxt = pr.next;
    const track = pr.stages.map((s) => {
      const st = s.stage < pr.stage ? 'done' : s.stage === pr.stage ? 'cur' : 'lock';
      return `<li class="st ${st}"${st === 'cur' ? ' aria-current="step"' : ''}><i>${st === 'done' ? '✓' : st === 'lock' ? '🔒' : s.stage}</i><small>${esc(s.name)}</small></li>`;
    }).join('');
    let html = `<div class="sect">Stages (${pr.stage}/${pr.stages.length})</div><ol class="stage-track">${track}</ol>
      <div class="prof-stage"><b>Stage ${pr.stage} · ${esc(cur.name)}</b><div class="sub">${esc(cur.blurb || '')}</div></div>`;
    if (nxt) {
      const goals = pr.goalsFor(nxt.stage), done = goals.filter((g) => g.done).length;
      html += `<div class="prof-next"><b>Next: Stage ${nxt.stage} · ${esc(nxt.name)}</b> <small>(${done}/${goals.length} goals)</small></div>` + goals.map((g) => `<div class="mrow ${g.done ? 'done' : 'cur'}"><div class="chk">${g.done ? '✓' : ''}</div><div style="flex:1"><b>${esc(g.label)}</b><small>${Math.floor(g.value).toLocaleString('en-US')} / ${g.target.toLocaleString('en-US')}</small>${this.bar(g.value / g.target)}</div></div>`).join('')
        + `<div class="sub" style="margin-top:6px">Reward <b>${this.rewardHtml(nxt.reward)}</b>${nxt.unlocks?.length ? ` · unlocks: ${esc(nxt.unlocks.join(', '))}` : ''}</div>`;
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
