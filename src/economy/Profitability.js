/**
 * Profit per business, read from the economy ledger (nothing is stored here).
 *
 * Revenue: every ledger source belongs to one business (charging + store -> station, "car wash" -> wash, ...); sources that
 * belong to no single business (tips, contracts, offline earnings) go to "Other income".
 * Direct costs: the ledger categories that one business causes (electricity -> station, parts -> garage, supplies -> wash,
 * ingredients -> cafe). Payroll is each employee's daily salary counted for the department they work in.
 * Salaries are booked when a day ends, so mid-day the report shows the PROJECTED result "if the day ended now".
 * Shared costs (property tax, equipment, hiring, training, maintenance) are listed separately, never split by guesswork.
 */
export const DIRECT_COSTS = { station: ['electricity'], wash: ['supplies'], garage: ['parts'], cafe: ['ingredients'] };
const SHARED_COSTS = ['property', 'equipment', 'hiring', 'training', 'maintenance'];

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} p
 * @param {object} p.ledger      economy.ledger ({ revenue, expenses })
 * @param {Array}  p.businesses  [{ id, label, icon, sources: [ledger revenue keys], depts: [employee department keys], open: bool }]
 * @param {Array}  p.employees   employee list (salary, home/dept, leaving)
 * @param {Function} p.homeOf    (employee) -> department key
 */
export function businessProfits({ ledger, businesses, employees, homeOf }) {
  const claimed = new Set();
  const rows = businesses.filter((b) => b.open).map((b) => {
    let revenue = 0;
    for (const s of b.sources) { revenue += ledger.revenue[s] || 0; claimed.add(s); }
    const costs = (DIRECT_COSTS[b.id] || []).reduce((n, c) => n + (ledger.expenses[c] || 0), 0);
    const staff = employees.filter((e) => !e.leaving && b.depts.includes(homeOf(e)));
    const payroll = staff.reduce((n, e) => n + e.salary, 0);
    const profit = revenue - costs - payroll;
    return { id: b.id, label: b.label, icon: b.icon, revenue: r2(revenue), costs: r2(costs), payroll: r2(payroll), staff: staff.length, profit: r2(profit), margin: revenue > 0 ? profit / revenue : null };
  });
  const other = Object.entries(ledger.revenue).filter(([k]) => !claimed.has(k)).reduce((n, [, v]) => n + v, 0);
  const direct = new Set(Object.values(DIRECT_COSTS).flat());
  // salaries already booked today (severance pay for fired staff) are a one-off shared cost; regular payroll is the projected per-business figure above
  const shared = SHARED_COSTS.reduce((n, c) => n + (ledger.expenses[c] || 0), 0) + (ledger.expenses.salaries || 0)
    + Object.entries(ledger.expenses).filter(([k]) => !direct.has(k) && !SHARED_COSTS.includes(k) && k !== 'salaries').reduce((n, [, v]) => n + v, 0);
  const totalRevenue = rows.reduce((n, r) => n + r.revenue, 0) + other;
  const totalProfit = rows.reduce((n, r) => n + r.profit, 0) + other - shared;
  return { rows, other: r2(other), shared: r2(shared), totalRevenue: r2(totalRevenue), totalProfit: r2(totalProfit) };
}
