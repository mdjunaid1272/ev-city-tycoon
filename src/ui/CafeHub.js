import { esc, money } from './uiShared.js';

const TABS = [['play', '☕ Café'], ['recipes', '📖 Recipes'], ['customers', '🧑‍🤝‍🧑 Guests'], ['decor', '🛋️ Decorate'], ['progress', '⭐ Progress']];
const SLOT_NAMES = { table1: 'Table 1', table2: 'Table 2', table3: 'Table 3', table4: 'Table 4', table5: 'Table 5', plantL: 'Plant, left of the door', plantR: 'Plant, right of the door', cornerL: 'Left corner', cornerR: 'Back corner',
  wallW1: 'West wall, front', wallW2: 'West wall, back', wallE1: 'East wall, front', wallE2: 'East wall, back', wallBack: 'Back wall', winL: 'Left window', winR: 'Right window', rug: 'Rug', counterA: 'Counter, right', counterB: 'Counter, left', ceil1: 'Ceiling, left', ceil2: 'Ceiling, right', ceil3: 'Ceiling, counter' };
const KIND_ORDER = ['table', 'floor', 'wall', 'window', 'rug', 'counter', 'ceiling'];
const KIND_NAMES = { table: 'Tables & seating', floor: 'Plants, lamps & furniture', wall: 'Wall decorations', window: 'Windows & curtains', rug: 'Rug', counter: 'Counter decorations', ceiling: 'Lighting' };

/**
 * The café hub board (a normal UIManager modal): play, recipe book, customer collection, decoration shop and café progress.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager. Every control calls a real
 * CafeCozy / CafeDecor method (see cozyAction).
 */
export const CafeHub = {
  tplCafeHub() {
    const g = this.game, cz = g.cafeCozy;
    if (!this.cafe.built) return `<h2>☕ Café</h2><div class="sub">The café opens with the Coffee Shop (Business › Upgrades › Customer hub).</div><button class="btn" data-open-biz="upgrades">Open upgrades</button>`;
    const tab = TABS.some(([k]) => k === this.tab.cafehub) ? this.tab.cafehub : 'play';
    const body = { play: () => this.hubPlay(), recipes: () => this.hubRecipes(), customers: () => this.hubCustomers(), decor: () => this.hubDecor(), progress: () => this.hubProgress() }[tab]();
    return `<h2>☕ Café <small class="cz-hlv">Level ${cz.level} · 🪙 ${cz.coins.toFixed(0)}</small></h2>${this.tabs('cafehub', TABS)}${body}`;
  },

  hubPlay() {
    const cz = this.game.cafeCozy, st = cz.status(), pr = cz.levelProgress(), info = cz.restockInfo();
    const low = Object.entries(cz.cfg.ingredients).filter(([id]) => cz.pantry[id] <= 5).map(([id, i]) => `${i.icon} ${esc(i.label)} (${cz.pantry[id]})`);
    return `<div class="sub">Your café keeps earning with its staff. Open it yourself for a cozy, relaxed shift: meet the regulars, make drinks and desserts, decorate and unlock more. It is entirely optional.</div>
      <button class="btn blue cz-open" data-cz="open">☕ Open the café</button>
      <div class="kv"><span>Café level</span><b>${cz.level}${pr.next ? ` · ${pr.into}/${pr.need} XP` : ' (max)'}</b></div>${this.bar(pr.frac, 'var(--blue, #2f8cff)')}
      <div class="kv"><span>Café coins</span><b>🪙 ${cz.coins.toFixed(0)}</b></div>
      <div class="kv"><span>City reward today</span><b>${st.rewarded ? `+${money(st.cashLeft, 0)} possible · ${st.shiftsLeft} shifts` : esc(st.why)}</b></div>
      <div class="sect">Pantry</div>
      <div class="sub">${low.length ? `Running low: ${low.join(' · ')}` : 'The pantry is well stocked.'} It refills a little every shift; restocking everything costs ${money(info.cost, 2)} of city cash.</div>
      <button class="btn ghost" data-cz="restock" ${info.missing ? '' : 'disabled'}>Restock the pantry · ${money(info.cost, 2)}</button>
      <div class="sect">Business</div>
      <button class="btn ghost" data-cz="manage">Manage the café business (menu, stock, staff, upgrades)</button>`;
  },

  hubRecipes() {
    const cz = this.game.cafeCozy, C = cz.cfg, B = cz.book;
    const group = (kind, title) => {
      const rows = Object.entries(C.products).filter(([, p]) => p.kind === kind).map(([id, p]) => {
        const locked = p.level > cz.level, disc = cz.discovered.has(id);
        const head = `<span>${p.icon} <b>${esc(p.label)}</b></span><span>${locked ? `🔒 Level ${p.level}` : disc ? '✓ made' : 'new!'}</span>`;
        if (locked) return `<div class="cz-rec locked"><div class="cz-rh">${head}</div></div>`;
        return `<details class="cz-rec"><summary class="cz-rh">${head}</summary><ol>${B.steps(id).map((s) => `<li><span>${s.icon}</span> ${esc(s.text)}</li>`).join('')}</ol><small>Sells for about ${p.price} coins</small></details>`;
      }).join('');
      return `<div class="sect">${title}</div>${rows}`;
    };
    const mach = Object.entries(C.machines).map(([id, m]) => `<div class="kv"><span>${m.icon} ${esc(m.label)}</span><b>${m.level > cz.level ? `🔒 Level ${m.level}` : '✓'}</b></div>`).join('');
    return `<div class="sub">Every recipe you unlock appears here. Tap one to see its steps.</div>${group('drink', 'Drinks')}${group('dessert', 'Desserts')}<div class="sect">Equipment</div>${mach}`;
  },

  hubCustomers() {
    const cz = this.game.cafeCozy, R = cz.roster, C = cz.cfg;
    const met = R.ids.filter((id) => R.state[id].met).length;
    const cards = R.ids.map((id) => {
      const p = R.profile(id), def = C.customers[id], locked = !R.unlocked(id, cz.level) && !p.met;
      if (locked) return `<div class="cz-guest locked"><span class="cz-gi">❔</span><div><b>???</b><small>Visits from café level ${def.level}</small></div></div>`;
      const hearts = '♥'.repeat(p.level + 1) + '♡'.repeat(Math.max(0, C.friendLevels.length - 1 - p.level));
      const likes = (a) => a.map((x) => C.products[x].icon).join(' ');
      return `<details class="cz-guest${p.met ? '' : ' new'}"><summary><span class="cz-gi">${p.icon}</span><div><b>${esc(p.name)}</b><small>${esc(p.category)} · ${esc(p.levelName)} <span class="cz-hearts">${hearts}</span></small></div></summary>
        <p>${esc(p.bio)}</p><p><i>${esc(p.personality)}</i></p>
        <div class="kv"><span>Visits</span><b>${p.visits}</b></div>
        <div class="kv"><span>Likes</span><b>${likes(p.likes.drinks)} · ${likes(p.likes.desserts)}</b></div>
        ${this.bar(p.progress.frac, '#ff8fb1')}
        <div class="sect">Story ${p.story.done}/${p.story.total}</div>
        ${p.chapters.map((c) => `<div class="mrow ${c.done ? 'done' : c.ready ? 'cur' : ''}"><div class="chk">${c.done ? '✓' : c.ready ? '💬' : ''}</div><div style="flex:1"><b>${esc(c.title)}</b>${c.ready ? '<small>Ready to be told on their next visit</small>' : ''}</div></div>`).join('')}</details>`;
    }).join('');
    return `<div class="sub">Guests you have met: <b>${met}/${R.ids.length}</b>. Regulars return with new conversations as you become friends.</div><div class="cz-guests">${cards}</div>`;
  },

  hubDecor() {
    const cz = this.game.cafeCozy, D = cz.decor, C = cz.cfg;
    const themes = Object.entries(D.themes).map(([id, t]) => {
      const own = D.ownedThemes.has(id), on = D.theme === id, locked = t.level > cz.level && !own;
      const btn = on ? '<span class="tag on">In use</span>' : own ? `<button class="btn" data-cz="theme:${id}">Use</button>` : locked ? `<span class="tag">🔒 Level ${t.level}</span>` : `<button class="btn ghost" data-cz="buytheme:${id}" ${cz.coins < t.price ? 'disabled' : ''}>🪙 ${t.price}</button>`;
      return `<div class="cz-theme${on ? ' on' : ''}" style="--w:${t.wall};--f:${t.floor[0]};--a:${t.accent}"><i></i><span>${t.icon} <b>${esc(t.name)}</b><small>+${t.appeal} appeal</small></span>${btn}</div>`;
    }).join('');
    const floors = Object.entries(D.floors).map(([id, f]) => {
      const own = D.ownedFloors.has(id), on = D.floor === id, locked = f.level > cz.level && !own;
      const btn = on ? '<span class="tag on">In use</span>' : own ? `<button class="btn" data-cz="floor:${id}">Use</button>` : locked ? `<span class="tag">🔒 Level ${f.level}</span>` : `<button class="btn ghost" data-cz="buyfloor:${id}" ${cz.coins < f.price ? 'disabled' : ''}>🪙 ${f.price}</button>`;
      return `<div class="kv"><span>${esc(f.name)}</span>${btn}</div>`;
    }).join('');
    const slotsByKind = KIND_ORDER.map((kind) => {
      const rows = Object.entries(D.slots).filter(([, s]) => s.kind === kind).map(([slot, s]) => {
        const cur = D.placed[slot], opts = D.options(slot);
        const sel = `<select data-czslot="${slot}" aria-label="${esc(SLOT_NAMES[slot] || slot)}">${(s.kind === 'table' ? '' : '<option value="">— empty —</option>')}${cur && !opts.some((o) => o.id === cur.item) ? `<option value="${cur.item}" selected>${D.items[cur.item].icon} ${esc(D.items[cur.item].name)}</option>` : ''}${opts.map((o) => `<option value="${o.id}" ${cur?.item === o.id ? 'selected' : ''}>${o.icon} ${esc(o.name)}</option>`).join('')}</select>`;
        const rot = s.rot.length > 1 ? `<button class="btn ghost mini" data-cz="rotate:${slot}" ${cur ? '' : 'disabled'} aria-label="Turn">⟳</button>` : '';
        const rem = s.kind === 'table' ? '' : `<button class="btn ghost mini" data-cz="remove:${slot}" ${cur ? '' : 'disabled'} aria-label="Remove">✕</button>`;
        return `<div class="cz-slot"><span>${esc(SLOT_NAMES[slot] || slot)}</span>${sel}${rot}${rem}</div>`;
      }).join('');
      return `<div class="sect">${KIND_NAMES[kind]}</div>${rows}`;
    }).join('');
    const shop = D.shop(cz.level).map((it) => `<div class="cz-shopit"><span>${it.icon} <b>${esc(it.name)}</b><small>${esc(it.kind)} · +${it.appeal} appeal</small></span><button class="btn ghost" data-cz="buy:${it.id}" ${cz.coins < it.price ? 'disabled' : ''}>🪙 ${it.price}</button></div>`).join('') || '<div class="sub">Nothing new to buy right now. New furniture unlocks as your café levels up.</div>';
    const gifts = [...D.owned].filter((id) => D.items[id].gift).map((id) => `${D.items[id].icon} ${esc(D.items[id].name)}`);
    return `<div class="sub">Café appeal <b>${D.appeal()}</b> · happy decoration makes customers a little happier. Everything is placed on fixed spots, so people can always walk freely. Coins: <b>🪙 ${cz.coins.toFixed(0)}</b></div>
      <div class="sect">Themes</div>${themes}<div class="sect">Floor</div>${floors}${slotsByKind}
      <div class="sect">Shop</div>${shop}${gifts.length ? `<div class="sect">Gifts from guests</div><div class="sub">${gifts.join(' · ')}</div>` : ''}`;
  },

  hubProgress() {
    const cz = this.game.cafeCozy, C = cz.cfg, st = cz.status(), pr = cz.levelProgress();
    const rows = Array.from({ length: cz.maxLevel }, (_, i) => i + 1).map((lv) => {
      const u = cz.unlocksAt(lv), got = lv <= cz.level;
      const items = [...u.drinks.map((p) => C.products[p].label), ...u.desserts.map((p) => C.products[p].label), ...u.machines.map((m) => C.machines[m].label), ...u.customers.map((c) => C.customers[c].name), ...u.themes.map((t) => C.decor.themes[t].name + ' theme'), ...u.furniture.map((f) => C.decor.items[f].name)];
      return `<div class="mrow ${got ? 'done' : lv === cz.level + 1 ? 'cur' : ''}"><div class="chk">${got ? '✓' : lv}</div><div style="flex:1"><b>Level ${lv}</b><small>${items.length ? esc(items.join(', ')) : 'Starting café'}</small></div></div>`;
    }).join('');
    return `<h3 class="cz-big">Level ${cz.level}</h3>${this.bar(pr.frac, 'var(--blue, #2f8cff)')}<div class="sub">${pr.next ? `${pr.into} / ${pr.need} XP to level ${cz.level + 1}` : 'Maximum level reached.'}</div>
      <div class="kv"><span>Served in total</span><b>${cz.life.served}</b></div><div class="kv"><span>Perfect orders</span><b>${cz.life.perfect}</b></div><div class="kv"><span>Shifts played</span><b>${cz.life.shifts}</b></div>
      <div class="kv"><span>Recipes discovered</span><b>${cz.discovered.size}/${Object.keys(C.products).length}</b></div><div class="kv"><span>Guests met</span><b>${cz.roster.ids.filter((id) => cz.roster.state[id].met).length}/${cz.roster.ids.length}</b></div>
      <div class="sect">What unlocks</div>${rows}
      <div class="sect">Limits (so the city stays the main game)</div>
      <div class="sub">Café coins are a separate currency for decoration. Each shift can also give a small cash bonus and a little reputation to the city: today up to ${money(st.dayCashCap)} cash, ${st.dayReputationCap} reputation and ${st.shiftsPerDay} rewarded shifts, with a short rest between shifts. The café's own income is never doubled by playing.</div>
      <div class="kv"><span>Coins earned today</span><b>${(C.rewards.city.dayCoinCap - st.coinsLeft).toFixed(0)} / ${C.rewards.city.dayCoinCap}</b></div>
      <div class="kv"><span>City cash today</span><b>${money(st.dayCashCap - st.cashLeft, 2)} / ${money(st.dayCashCap)}</b></div>`;
  },

  /** Button handler for every [data-cz] control of the hub board. */
  cozyAction(a) {
    const g = this.game, cz = g.cafeCozy, [act, id] = a.split(':');
    const say = (r, ok) => { if (r && r.ok === false && r.reason) this.toast(r.reason, 'warn'); else if (r?.ok && ok) this.toast(ok, 'good'); };
    if (act === 'open') { this.closeModal(); g.startCafeShift(); return; }
    if (act === 'manage') { this.open('cafe'); return; }
    if (act === 'restock') say(cz.restock(), 'Pantry restocked');
    else if (act === 'buy') say(cz.buyDecor(id), `${cz.decor.items[id]?.name} bought`);
    else if (act === 'buytheme') say(cz.buyTheme(id), 'Theme bought');
    else if (act === 'buyfloor') say(cz.buyFloor(id), 'Floor bought');
    else if (act === 'theme') cz.decor.setTheme(id);
    else if (act === 'floor') cz.decor.setFloor(id);
    else if (act === 'rotate') say(cz.decor.rotate(id));
    else if (act === 'remove') say(cz.decor.remove(id));
    g.bus.emit('cozy:decor');
    this.renderModal();
  },

  /** A decoration <select> changed. */
  cozyPlace(slot, item) {
    const cz = this.game.cafeCozy;
    const r = item ? cz.decor.place(slot, item, cz.decor.placed[slot]?.rot ?? 0) : cz.decor.remove(slot);
    if (r.ok === false && r.reason) this.toast(r.reason, 'warn');
    this.game.bus.emit('cozy:decor');
    this.renderModal();
  },
};
