import { esc, money } from './uiShared.js';

/**
 * Missions, goals, achievements and stage boards.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const MissionPanel = {
  tplMissionsTabs() {
    const t = this.tab.missions;
    const tabs = this.tabs('missions', [['main', 'Main'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['ach', 'Achievements'], ['stage', 'Stage']]);
    if (t === 'daily') return tabs + this.tplGoals('daily');
    if (t === 'weekly') return tabs + this.tplGoals('weekly');
    if (t === 'ach') return tabs + this.tplAchievements();
    if (t === 'stage') return tabs + this.tplStage();
    return tabs + this.tplMissions();
  },

  tplMissions() {
    return `<h2>🏁 Missions</h2><div class="sub">Complete them in order for cash, gems and reputation.</div>` + this.missions.list().map((m) =>
      `<div class="mrow ${m.state}"><div class="chk">${m.state === 'done' ? '✓' : ''}</div><div><b>${esc(m.title)}</b><small>${esc(m.desc)}</small><small>Reward: ${this.rewardText(m.reward)}</small></div></div>`).join('');
  },

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
  },

  tplAchievements() {
    const list = this.goals.achievementList();
    const done = list.filter((a) => a.done).length;
    return `<h2>🏆 Achievements</h2><div class="sub">${done}/${list.length} unlocked</div>` + list.map((a) => `<div class="mrow ${a.done ? 'done' : 'cur'}"><div class="chk">${a.done ? '✓' : ''}</div><div style="flex:1"><b>${esc(a.title)}</b><small>${esc(a.desc)}</small><small>${Math.floor(a.value).toLocaleString('en-US')}/${a.target.toLocaleString('en-US')} · ${this.rewardHtml(a.reward)}</small>${this.bar(a.value / a.target)}</div></div>`).join('');
  },

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
  },
};
