import { esc, money } from './uiShared.js';

/**
 * Finance, customers, day report and statistics boards.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const FinancePanel = {
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
  },

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
  },

  showDayReport(r) {
    this._report = r;
    this.open('report');
  },

  tplReport() {
    const r = this._report;
    const lines = (o) => Object.entries(o).map(([k, v]) => `<div class="kv"><span style="text-transform:capitalize">${esc(k)}</span><b>${money(v, 2)}</b></div>`).join('') || '<div class="sub">—</div>';
    return `<h2>📊 Daily Report · Day ${r.day}</h2><div class="sub">${r.kwh} kWh sold</div>
      <div class="sect">Revenue</div>${lines(r.bySource)}<div class="sect">Expenses</div>${lines(r.byCategory)}
      <div class="kv" style="border-top:2px solid var(--line);margin-top:6px"><span><b>Net profit</b></span><b class="${r.net >= 0 ? 'pos' : 'neg'}">${money(r.net, 2)}</b></div>
      <button class="btn blue" data-close2 onclick="document.querySelector('[data-close]').click()">Continue</button>`;
  },

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
  },
};
