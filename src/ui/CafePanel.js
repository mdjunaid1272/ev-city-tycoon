import { esc, money } from './uiShared.js';

const TABS = [['overview', 'Overview'], ['menu', 'Menu'], ['stock', 'Stock'], ['upgrades', 'Upgrades'], ['stats', 'Stats']];
const pct = (n) => `${Math.round(n * 100)}%`;

/**
 * Cafe management board. Every button here calls a real Cafe method (see cafeAction); values are read live from the Cafe.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const CafePanel = {
  tplCafe() {
    const c = this.cafe;
    if (!c.built) {
      return `<h2>☕ Café</h2><div class="sub">The café opens with the Coffee Shop (Business › Upgrades › Customer hub).</div>
        <button class="btn" data-open-biz="upgrades">Open upgrades</button>`;
    }
    const tab = TABS.some(([k]) => k === this.tab.cafe) ? this.tab.cafe : 'overview';
    const body = { overview: () => this.cafeOverview(), menu: () => this.cafeMenu(), stock: () => this.cafeStock(), upgrades: () => this.cafeUpgrades(), stats: () => this.cafeStats() }[tab]();
    return `<h2>☕ Café</h2>${this.tabs('cafe', TABS)}${body}`;
  },

  cafeOverview() {
    const c = this.cafe, rep = c.report(), t = rep.today;
    const baristas = this.employees.employees.filter((e) => !e.leaving && e.dept === 'cafe');
    const soldOut = c.products().filter((p) => p.available && p.missing);
    const sat = c.avgSatisfaction;
    const orders = c.orders.map((o) => {
      const p = c.cfg.products[o.pid];
      const state = o.state === 'preparing' ? `Preparing${o.by === 'owner' ? ' (you)' : ''}` : 'Waiting';
      return `<div class="kv"><span>${p.icon} ${esc(p.label)} <small>${esc(o.customer.def.label || o.customer.type)}${o.customer.kind === 'charging' ? ' · charging' : ''}</small></span><b>${state}</b></div>
        ${this.bar(o.state === 'preparing' ? o.progress : 0, o.state === 'preparing' ? 'var(--green)' : '#cfd8ee')}`;
    }).join('') || '<div class="sub">No orders right now.</div>';
    const prep = c.manualOrder ? { disabled: true, label: 'Preparing…' } : { disabled: !c.orders.some((o) => o.state === 'queued'), label: 'Prepare next order yourself' };
    return `<div class="tiles">
        <div class="tile"><small>Revenue today</small><b class="pos">${money(t.revenue, 2)}</b></div>
        <div class="tile"><small>Profit today</small><b class="${t.profit >= 0 ? 'pos' : 'neg'}">${money(t.profit, 2)}</b></div>
        <div class="tile"><small>Orders waiting</small><b>${c.queueLength}</b></div>
        <div class="tile"><small>Satisfaction</small><b>${sat === null ? '—' : Math.round(sat) + '%'}</b></div>
      </div>
      ${soldOut.length ? `<div class="sel-why" role="note">⚠ Sold out: ${soldOut.map((p) => `${esc(p.label)} (needs ${esc(c.cfg.ingredients[p.missing].label)})`).join(', ')}. Restock in the Stock tab.</div>` : ''}
      <div class="sect">Orders</div>${orders}
      <button class="btn" data-cafe="prep" ${prep.disabled ? 'disabled' : ''}>${prep.label}</button>
      <div class="sect">Team</div>
      <div class="kv"><span>Baristas on duty</span><b>${baristas.filter((e) => e.dept === 'cafe').length} / ${c.staffSlots} slots</b></div>
      <div class="sub">${baristas.length ? 'Baristas prepare orders automatically: higher skill means faster service.' : 'No barista yet: you prepare the orders yourself (slower). Hire one in Staff.'}</div>
      <button class="btn ghost" data-open-biz="staff">Open Staff</button>
      <div class="kv"><span>Seats used</span><b>${c.customers.size} / ${c.seats}</b></div>`;
  },

  cafeMenu() {
    const c = this.cafe;
    const rows = c.products().map((p) => {
      if (!p.unlocked) {
        return `<div class="emp locked"><div class="emp-h"><span class="ic">${p.icon}</span><b>${esc(p.label)}</b><small>🔒 Menu level ${p.unlock}</small></div><div class="emp-s">Unlock it in the Upgrades tab.</div></div>`;
      }
      const stockLine = p.missing ? `<span class="neg">Sold out: needs ${esc(c.cfg.ingredients[p.missing].label)}</span>` : 'In stock';
      return `<div class="emp ${p.enabled ? '' : 'locked'}"><div class="emp-h"><span class="ic">${p.icon}</span><b>${esc(p.label)}</b><small>${p.enabled ? 'On the menu' : 'Off the menu'}</small></div>
        <div class="emp-s">Cost <b>${money(p.unitCost, 2)}</b> · profit <b class="${p.profit >= 0 ? 'pos' : 'neg'}">${money(p.profit, 2)}</b> (${pct(p.margin)}) · prep <b>${p.prep}s</b><br>${stockLine}</div>
        <div class="stepper"><button data-cafe="price:${p.id}:-" aria-label="Lower the price of ${esc(p.label)}">−</button><div class="val">${money(p.price, 2)}</div><button data-cafe="price:${p.id}:+" aria-label="Raise the price of ${esc(p.label)}">+</button></div>
        <div class="emp-b"><button class="btn ghost" data-cafe="toggle:${p.id}">${p.enabled ? 'Take off the menu' : 'Put on the menu'}</button></div></div>`;
    }).join('');
    return `<div class="sub">Set prices and choose what you sell. Customers refuse prices above ${Math.round(c.cfg.demand.maxPriceFactor * 100)}% of the standard price.</div>${rows}`;
  },

  cafeStock() {
    const c = this.cafe;
    const rows = Object.entries(c.cfg.ingredients).map(([id, ing]) => {
      const have = c.stock[id] || 0, cap = c.cap(id), frac = cap ? have / cap : 0;
      const usedBy = Object.entries(c.cfg.products).filter(([, p]) => p.ingredients[id]).map(([, p]) => p.icon).join(' ');
      const room = cap - have;
      const q10 = Math.min(10, room);
      return `<div class="emp"><div class="emp-h"><span class="ic">${ing.icon}</span><b>${esc(ing.label)}</b><small>${have} / ${cap}</small></div>
        ${this.bar(frac, frac < 0.25 ? '#d6453d' : 'var(--green)')}
        <div class="emp-s">${money(ing.cost, 2)} each · used in ${usedBy}</div>
        <div class="emp-b"><button class="btn" data-cafe="buy:${id}:10" ${q10 <= 0 || !this.economy.canAfford(q10 * ing.cost) ? 'disabled' : ''}>+${q10 || 10} · ${money(q10 * ing.cost, 2)}</button>
        <button class="btn ghost" data-cafe="buy:${id}:max" ${room <= 0 || !this.economy.canAfford(ing.cost) ? 'disabled' : ''}>Fill · ${money(room * ing.cost, 2)}</button></div></div>`;
    }).join('');
    const a = c.cfg.service.autoRestock;
    return `<div class="sub">Every order uses ingredients. When one runs out, the products that need it are sold out.</div>${rows}
      <div class="sect">Auto-restock</div>
      <div class="sub">Buys ingredients by itself when stock falls below ${pct(a.below)} (refills to ${pct(a.refillTo)}), as long as you have the cash.</div>
      <button class="btn ${c.autoRestock ? '' : 'ghost'}" data-cafe="auto">${c.autoRestock ? 'Auto-restock: ON' : 'Auto-restock: OFF'}</button>`;
  },

  cafeUpgrades() {
    const c = this.cafe;
    // one function per upgrade kind, so only the matching numbers are ever read
    const effects = {
      machine: (cur, next) => `Preparation time x${cur.prepMult.toFixed(2)} \u2192 x${next.prepMult.toFixed(2)}`,
      storage: (cur, next) => `Storage x${cur.capMult.toFixed(1)} \u2192 x${next.capMult.toFixed(1)}`,
      seating: (cur, next) => `Seats ${cur.seats} \u2192 ${next.seats} \u00b7 walk-in demand x${cur.demand.toFixed(2)} \u2192 x${next.demand.toFixed(2)} \u00b7 barista slots ${cur.staff} \u2192 ${next.staff}`,
      menu: () => `Unlocks: ${Object.values(c.cfg.products).filter((p) => p.unlock === c.levels.menu + 1).map((p) => p.label).join(', ') || 'nothing more'}`,
    };
    const effect = (kind, cur, next) => effects[kind](cur, next);
    return `<div class="sub">Cash ${money(this.economy.cash, 2)}. Every upgrade changes how the café runs.</div>` + Object.entries(c.cfg.upgrades).map(([kind, u]) => {
      const lvl = c.levels[kind], max = u.levels.length - 1, info = c.upgradeInfo(kind);
      const cur = u.levels[lvl];
      const line = info.next ? effect(kind, cur, info.next) : 'Fully upgraded';
      const btn = info.cost === null ? '<span class="tag on">Max</span>' : `<button class="btn" data-cafe="up:${kind}" ${info.reason ? 'disabled' : ''}>Buy ${money(info.cost)}</button>`;
      return `<div class="emp"><div class="emp-h"><span class="ic">${u.icon}</span><b>${esc(u.label)}</b><small>Lv ${lvl + 1}/${max + 1}</small></div>
        <div class="emp-s">${esc(u.effect)}<br><b>${esc(line)}</b>${c.benefit(kind) ? `<br><small>${esc(c.benefit(kind))}</small>` : ''}${info.reason && info.cost !== null ? `<br><span class="neg">${esc(info.reason)}</span>` : ''}</div><div class="emp-b">${btn}</div></div>`;
    }).join('');
  },

  cafeStats() {
    const c = this.cafe, r = c.report(), t = r.total, d = r.today;
    const lostBy = Object.entries(t.lostBy).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ') || 'none';
    return `<div class="sect">Today</div>
      <div class="kv"><span>Orders served</span><b>${d.served}</b></div>
      <div class="kv"><span>Revenue</span><b class="pos">${money(d.revenue, 2)}</b></div>
      <div class="kv"><span>Ingredients bought</span><b>${money(d.spent, 2)}</b></div>
      <div class="kv"><span>Profit</span><b class="${d.profit >= 0 ? 'pos' : 'neg'}">${money(d.profit, 2)}</b></div>
      <div class="kv"><span>Customers lost</span><b>${d.lost}</b></div>
      <div class="sect">Lifetime</div>
      <div class="kv"><span>Orders taken / served</span><b>${t.orders} / ${t.served}</b></div>
      <div class="kv"><span>Revenue</span><b class="pos">${money(t.revenue, 2)}</b></div>
      <div class="kv"><span>Tips</span><b class="pos">${money(t.tips, 2)}</b></div>
      <div class="kv"><span>Ingredients bought</span><b>${money(t.spent, 2)}</b></div>
      <div class="kv"><span>Profit</span><b class="${t.profit >= 0 ? 'pos' : 'neg'}">${money(t.profit, 2)}</b></div>
      <div class="kv"><span>Average satisfaction</span><b>${t.avgSatisfaction === null ? '—' : Math.round(t.avgSatisfaction) + '%'}</b></div>
      <div class="kv"><span>Customers lost</span><b>${t.lost}</b></div>
      <div class="sub">${lostBy}</div>`;
  },

  /** Button handler for every [data-cafe] control. */
  cafeAction(a) {
    const c = this.cafe, [act, id, arg] = a.split(':');
    const say = (r) => { if (r && r.ok === false && r.reason) this.toast(r.reason, 'warn'); };
    if (act === 'price') {
      const p = c.products().find((x) => x.id === id);
      if (p) c.setPrice(id, p.price + (arg === '+' ? 0.25 : -0.25));
    } else if (act === 'toggle') {
      const p = c.products().find((x) => x.id === id);
      if (p) c.setEnabled(id, !p.enabled);
    } else if (act === 'buy') {
      const ing = c.cfg.ingredients[id];
      const qty = arg === 'max' ? Math.min(c.cap(id) - (c.stock[id] || 0), Math.floor(this.economy.cash / ing.cost)) : Number(arg); // 'Fill' buys as much as you can afford
      say(c.restock(id, qty));
    } else if (act === 'auto') {
      c.setAutoRestock(!c.autoRestock);
    } else if (act === 'prep') {
      say(c.prepareManually());
    } else if (act === 'up') {
      const info = c.upgradeInfo(id);
      this.guard(info.cost || 0, `Upgrade the ${c.cfg.upgrades[id].label.toLowerCase()}`, () => { const r = c.upgrade(id); say(r); if (r.ok) this.toast(`${c.cfg.upgrades[id].label} upgraded`, 'good'); this.renderModal(); });
    }
    this.renderModal();
  },
};
