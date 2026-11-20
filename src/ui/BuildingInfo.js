/**
 * Contextual panel content for the selectable buildings (read from live game state, nothing is stored here).
 * Every panel answers the same questions: what is it, what level, is it working, how full is it, what does it earn,
 * and only offers actions that really exist.
 */
const money = (n, d = 0) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;

/** Why an action is disabled: always tells the player what is missing. */
export const needCash = (economy, cost) => `Not enough cash: ${money(Math.max(0, Math.ceil(cost - economy.cash)))} more needed`;

export function stationBuildingInfo(view) {
  const st = view.station, eco = view.economy, bus = view.bus;
  const open = st.bays.filter((b) => b.unlocked);
  const busy = open.filter((b) => b.state !== 'empty').length;
  const charging = open.filter((b) => b.state === 'charging').length;
  const queue = view.customers?.queue?.length ?? 0;
  const today = eco.ledger.revenue.charging || 0;
  return {
    title: 'EV Stop · Charging Station',
    subtitle: 'Your first business',
    rows: [
      ['Level', `${st.charger.name} · ${st.charger.kw} kW`],
      ['Status', charging ? `Open · ${charging} charging` : 'Open'],
      ['Capacity', `${open.length}/${st.bays.length} bays`],
      ['Occupancy', `${busy}/${open.length} bays busy${queue ? ` · ${queue} queued` : ''}`],
      ['Revenue today', money(today, 2)],
    ],
    actions: [
      { label: 'Manage', cb: () => bus.emit('ui:open', 'station') },
      { label: 'Upgrade', kind: 'secondary', cb: () => bus.emit('ui:open', 'upgrades') },
      { label: 'Statistics', kind: 'secondary', cb: () => bus.emit('ui:open', 'stats') },
    ],
  };
}

export function serviceBuildingInfo(view) {
  const biz = view.biz, cfg = biz.cfg, bus = view.bus;
  if (!biz.built) {
    return { title: `${cfg.icon} ${cfg.label}`, subtitle: 'Not built yet', rows: [['Status', 'Closed']], actions: [{ label: 'Open Business board', cb: () => bus.emit('ui:open', 'business') }] };
  }
  const open = biz.bays.filter((b) => b.unlocked);
  const busy = open.filter((b) => b.state !== 'empty').length;
  const staff = view.employees.employees.filter((e) => !e.leaving && e.dept === cfg.dept).length;
  const level = biz.equipLevel ?? (biz.chargerLevel != null ? biz.chargerLevel + 1 : null);
  const rows = [];
  if (level != null) rows.push(['Level', `${level}${biz.charger ? ` · ${biz.charger.kw} kW` : ''}`]);
  rows.push(
    ['Status', staff ? `Open · ${staff} staff on duty` : 'Open · no staff assigned'],
    ['Capacity', `${open.length}/${biz.bays.length} bays`],
    ['Occupancy', `${busy}/${open.length} bays busy${biz.queue.length ? ` · ${biz.queue.length} queued` : ''}`],
    ['Revenue', `${money(biz.stats.revenue, 2)} total · ${biz.stats.served} served`],
  );
  return {
    title: `${cfg.icon} ${cfg.label}`, subtitle: 'Business',
    rows,
    actions: [
      { label: 'Manage', cb: () => bus.emit('ui:open', view.id) },
      { label: 'Staff', kind: 'secondary', cb: () => bus.emit('ui:open', 'staff') },
      { label: 'Upgrade', kind: 'secondary', cb: () => bus.emit('ui:open', 'upgrades') },
    ],
  };
}

export function cafeBuildingInfo(view) {
  const cafe = view.cafe, bus = view.bus;
  const rep = cafe.report();
  const staff = view.employees?.employees.filter((e) => !e.leaving && e.dept === 'cafe').length ?? 0;
  const level = 1 + Object.values(cafe.levels).reduce((a, b) => a + b, 0);
  const out = cafe.products().filter((p) => p.available && p.missing).length;
  return {
    title: 'Caf\u00e9', subtitle: 'Coffee, pastries and sandwiches',
    rows: [
      ['Level', String(level)],
      ['Status', staff ? `Open \u00b7 ${staff} barista${staff > 1 ? 's' : ''}` : 'Open \u00b7 you prepare the orders'],
      ['Capacity', `${cafe.seats} seats`],
      ['Occupancy', `${cafe.customers.size}/${cafe.seats} seats \u00b7 ${cafe.queueLength} order${cafe.queueLength === 1 ? '' : 's'} waiting`],
      ['Revenue today', money(rep.today.revenue, 2)],
      ...(out ? [['Stock', `${out} product${out > 1 ? 's' : ''} sold out`]] : []),
    ],
    actions: [
      { label: 'Manage', cb: () => bus.emit('ui:open', 'cafe') },
      { label: 'Menu & stock', kind: 'secondary', cb: () => bus.emit('ui:open', 'cafe:stock') },
      { label: 'Staff', kind: 'secondary', cb: () => bus.emit('ui:open', 'staff') },
      { label: 'Upgrade', kind: 'secondary', cb: () => bus.emit('ui:open', 'cafe:upgrades') },
    ],
  };
}
