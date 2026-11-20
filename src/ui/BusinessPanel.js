import { esc, money, districtOfBlock } from './uiShared.js';

/**
 * Business boards: overview, upgrades, contracts, station, car wash, garage, charging hubs and the city map.
 * Methods are mixed into UIManager's prototype (see UIManager.js), so `this` is the UIManager.
 */
export const BusinessPanel = {
  tplBusinessTabs() {
    const t = this.tab.business;
    const body = t === 'upgrades' ? this.tplUpgrades() : t === 'contracts' ? this.tplContracts() : this.tplBusiness();
    return this.tabs('business', [['overview', 'Overview'], ['upgrades', 'Upgrades'], ['contracts', 'Contracts']]) + body;
  },

  // ---------- businesses (overview, car wash, garage) ----------
  tplBusiness() {
    const eco = this.economy, st = this.station, rev = eco.ledger.revenue;
    const card = (icon, title, sub, body, btn) => `<div class="emp"><div class="emp-h"><span class="ic">${icon}</span><b>${title}</b><small>${sub}</small></div><div class="emp-s">${body}</div><div class="emp-b">${btn}</div></div>`;
    const svc = (biz, key) => {
      const cfg = biz.cfg;
      if (!biz.built) {
        const c = biz.canBuild(eco.reputation);
        return card(cfg.icon, esc(cfg.label), '<span class="tag">Not built</span>', `Build cost <b>${money(cfg.buildCost)}</b> · needs reputation <b>${cfg.minRep}</b> (you have <b>${eco.reputation}</b>)<br>Built on the ${key === 'wash' ? 'west' : 'north'} lot next to your station.`,
          `<button class="btn" data-svc="${key}:build" ${c.ok ? '' : 'disabled'}>${c.ok ? `Build · ${money(cfg.buildCost)}` : esc(c.reason)}</button>`);
      }
      const s = biz.stats;
      const lvl = key === 'wash' ? biz.equipLevel + 1 : Math.max(biz.scannerLevel, biz.toolLevel) + 1;
      return card(cfg.icon, esc(cfg.label), `<span class="tag on">Open</span><span class="tag">Lv ${lvl}</span>`,
        `${biz.unlockedBays} bays · queue <b>${biz.queue.length}/${biz.maxQueue}</b><br>Customers served <b>${s.served}</b> · revenue today <b>${money(rev[cfg.revenueKey] || 0, 2)}</b>`,
        `<button class="btn" data-open-biz="${key}">Manage</button>`);
    };
    return `<h2>🏢 Businesses</h2><div class="sub">Reputation ${eco.reputation} · connected services: charging customers may drive on to the wash or garage.</div>
      ${card('⚡', 'Charging Station', `<span class="tag on">Open</span><span class="tag">Lv ${st.chargerLevel}</span>`, `${st.unlockedCount} bays · ${st.charger.name} ${st.charger.kw} kW<br>Customers served today <b>${st.todayServed}</b> · revenue today <b>${money(rev.charging || 0, 2)}</b>`, '<button class="btn" data-open-biz="station">Manage</button>')}
      ${svc(this.wash, 'wash')}${svc(this.garage, 'garage')}
      ${Object.entries(this.hubs).map(([k, h]) => (h.built ? card(h.cfg.icon, esc(h.cfg.label), `<span class="tag on">Open</span><span class="tag">Lv ${(h.chargerLevel ?? 0) + 1}</span>`, `${h.unlockedBays} bays · ${h.charger.kw} kW<br>Customers served <b>${h.stats.served}</b> · revenue today <b>${money(this.economy.ledger.revenue[h.cfg.revenueKey] || 0, 2)}</b>`, `<button class="btn" data-open-biz="hub_${k}">Manage</button>`) : '')).join('')}
      ${this.cafe?.built ? card('\u2615', 'Caf\u00e9', `<span class="tag on">Open</span><span class="tag">Lv ${1 + Object.values(this.cafe.levels).reduce((a, b) => a + b, 0)}</span>`, `${this.cafe.seats} seats \u00b7 ${this.cafe.queueLength} order(s) waiting<br>Orders served <b>${this.cafe.stats.served}</b> \u00b7 revenue today <b>${money(rev.cafe || 0, 2)}</b>`, '<button class="btn" data-open-biz="cafe">Manage</button>') : ''}
      <button class="btn ghost" onclick="document.getElementById('btn-map').click()">🗺️ Open the city map to buy more properties</button>
      <div class="sect">Today's revenue by source</div>
      ${Object.entries(rev).map(([k, v]) => `<div class="kv"><span style="text-transform:capitalize">${esc(k)}</span><b>${money(v, 2)}</b></div>`).join('') || '<div class="sub">Nothing earned yet today.</div>'}`;
  },

  tplUpgrades() {
    const items = this.upgrades.list();
    const groups = [...new Set(items.map((i) => i.group))];
    return `<h2>⬆️ Upgrades</h2><div class="sub">Cash ${money(this.economy.cash, 2)} · Stage ${this.progression.stage}. Every upgrade changes how the business runs.</div>` + groups.map((g) => `<div class="sect">${esc(g)}</div>` + items.filter((i) => i.group === g).map((i) => {
      const btn = i.maxed ? '<span class="tag on">Max</span>' : i.lock ? `<span class="tag">🔒 ${esc(i.lock)}</span>` : `<button class="btn ${i.can ? '' : ''}" data-up="${i.id}" ${i.can ? '' : 'disabled'}>Buy ${money(i.cost)}</button>`;
      return `<div class="emp ${i.lock && !i.maxed ? 'locked' : ''}"><div class="emp-h"><span class="ic">${i.icon}</span><b>${esc(i.name)}</b><small>Lv ${i.level}/${i.max}</small></div>
        <div class="emp-s">${esc(i.desc)}</div><div class="emp-b">${btn}</div></div>`;
    }).join('')).join('');
  },

  tplContracts() {
    const c = this.contracts, day = this.game.day.day;
    if (!c.unlocked) return `<h2>🤝 Fleet contracts</h2><div class="sub">Contracts unlock at Stage ${this.progression.unlockStage('contracts')}. Fleet operators pay a bonus when you serve their vehicles before a deadline.</div>`;
    const act = c.active.map((k) => `<div class="emp"><div class="emp-h"><span class="ic">🤝</span><b>${esc(k.label)}</b><small>${k.have}/${k.need} ${esc(k.unit)}</small></div>${this.bar(k.have / k.need)}
      <div class="emp-s">Reward <b>${money(k.reward)}</b> + ${k.rep}⭐ · <b>${Math.max(0, k.deadlineDay - day)}</b> day(s) left (fleet customers only count)</div></div>`).join('') || '<div class="sub">No active contracts.</div>';
    const off = c.offers.map((k) => `<div class="emp"><div class="emp-h"><span class="ic">📄</span><b>${esc(k.label)}</b><small>${k.need} ${esc(k.unit)} in ${k.days} days</small></div>
      <div class="emp-s">Pays <b>${money(k.reward)}</b> (${money(k.perUnit)} each) + ${k.rep}⭐ · failing costs ${c.cfg.failRep}⭐</div>
      <div class="emp-b"><button class="btn" data-contract="accept:${k.id}" ${c.active.length >= c.cfg.maxActive ? 'disabled' : ''}>Accept</button></div></div>`).join('') || '<div class="sub">No offers right now. New ones arrive every day.</div>';
    return `<h2>🤝 Fleet contracts</h2><div class="sub">${c.active.length}/${c.cfg.maxActive} active · completed ${c.done} · failed ${c.failed}. While a contract is active, fleet customers visit more often.</div>
      <div class="sect">Active</div>${act}<div class="sect">Offers</div>${off}`;
  },

  async retAction(a) {
    const g = this.game;
    if (a === 'offline:claim') await g.claimOffline(false);
    else if (a === 'offline:ad') await g.claimOffline(true);
    else if (a === 'login:claim') { this.dailyReward.claim(1); this.toast('Daily reward collected', 'good'); this.closeModal(); }
    else if (a === 'login:ad') {
      const ok = await this.ads.showRewarded('daily-2x');
      this.dailyReward.claim(ok ? 2 : 1); this.toast(ok ? 'Double daily reward collected' : 'Daily reward collected', 'good'); this.closeModal();
    }
  },

  tplStation() {
    const st = this.station, eco = this.economy, ch = st.charger, nx = st.nextChargerUpgrade();
    const rows = st.bays.map((b, i) => {
      let status, btn = '';
      if (!b.unlocked) {
        status = 'Not built';
        btn = `<button class="btn" data-bay-act="build:${i}" ${eco.canAfford(st.cfg.bayCost) ? '' : 'disabled'}>Build ${money(st.cfg.bayCost)}</button>`;
      } else if (b.state === 'charging') {
        status = `<b>${Math.round(b.vehicle.soc * 100)}%</b> · ${b.power.toFixed(0)} kW · ${b.vehicle.label}`;
        btn = `<button class="btn ghost" data-bay-act="stop:${i}">Stop</button>`;
      } else if (b.state === 'waiting') {
        status = `<b>${b.vehicle.label}</b> waiting (${Math.round(b.vehicle.soc * 100)}%)`;
        btn = `<button class="btn" data-bay-act="start:${i}">Charge</button>`;
      } else status = { empty: 'Free', reserved: 'Vehicle arriving…', done: 'Paid · leaving' }[b.state];
      return `<div class="bay"><span class="n">Bay ${i + 1}</span><span class="st">${status}</span>${btn}</div>`;
    }).join('');
    return `<h2>⚡ Charging Station</h2><div class="sub">${st.unlockedCount} bays · ${ch.name} ${ch.kw} kW · capacity ${st.totalCapacityKw} kW</div>
      <div class="sect">Bays</div>${rows}
      <div class="sect">Price per kWh</div>
      <div class="stepper"><button data-price="-">−</button><div class="val">${money(st.pricePerKwh, 2)}</div><button data-price="+">+</button></div>
      <div class="sub" style="margin-top:6px">Electricity is billed at a time-of-day tariff. Higher prices slow customer arrivals.</div>
      <div class="sect">Upgrade</div>
      ${nx ? `<button class="btn blue" data-upgrade ${eco.canAfford(nx.cost) ? '' : 'disabled'}>Upgrade to ${nx.name} (${nx.kw} kW) · ${money(nx.cost)}</button>` : '<div class="sub">All charger upgrades purchased.</div>'}
      ${this.tplPower()}
      ${this.tplCustomers()}
      <div class="sect">Today</div>
      <div class="kv"><span>Customers served</span><b>${st.todayServed}</b></div>
      <div class="kv"><span>Energy sold</span><b>${eco.ledger.kwh.toFixed(1)} kWh</b></div>
      <div class="kv"><span>Revenue</span><b class="pos">${money(eco.todayRevenue, 2)}</b></div>`;
  },

  tplPower() {
    const st = this.station, p = st.power;
    if (!p) return '';
    const l = p.live;
    const per = { offpeak: 'off-peak', normal: 'normal', peak: 'PEAK' }[p.period()];
    return `<div class="sect">Power &amp; energy</div>
      <div class="kv"><span>Grid connection</span><b>${p.gridCapacityKw} kW</b></div>
      <div class="kv"><span>Charging efficiency</span><b>${(p.efficiency * 100).toFixed(1)}%</b></div>
      <div class="kv"><span>Electricity tariff now</span><b>${money(p.tariffNow, 2)}/kWh (${per})</b></div>
      <div class="kv"><span>Solar now / peak</span><b>${p.solarNowKw.toFixed(0)} / ${p.solarPeakKw} kW</b></div>
      <div class="kv"><span>Battery</span><b>${p.stored.toFixed(0)} / ${p.storageKwh} kWh</b></div>
      <div class="kv"><span>Charging demand</span><b>${l.demandKw.toFixed(0)} kW${l.factor < 0.999 ? ` · <span style="color:#d6453d">throttled to ${Math.round(l.factor * 100)}%</span>` : ''}</b></div>
      <div class="kv"><span>Grid / solar / battery today</span><b>${p.todayStats.gridKwh.toFixed(0)} / ${p.todayStats.solarKwh.toFixed(0)} / ${p.todayStats.batteryKwh.toFixed(0)} kWh</b></div>
      <div class="sub">Buy grid, efficiency, solar and storage in Business 🏢 → Upgrades. If the bays want more power than you can supply, every charger slows down.</div>`;
  },

  tplWash() {
    const w = this.wash, eco = this.economy, cfg = w.cfg, s = w.stats, m = this.employees;
    if (!w.built) return `<h2>🧽 Car Wash</h2><div class="sub">Not built yet. Open Businesses to build it.</div>`;
    const stateText = { empty: 'Free', reserved: 'Car arriving', waiting: 'Waiting for a washer', working: 'Washing (manual)', auto: 'Washing (tunnel)', done: 'Done' };
    const bays = w.bays.map((b, i) => {
      if (!b.unlocked) {
        const cost = w.nextBayCost();
        return `<div class="bay"><span class="n">Bay ${i + 1}</span><span class="st">Not built</span>${i === w.unlockedBays && cost !== null ? `<button class="btn" data-svc="wash:addbay" ${eco.canAfford(cost) ? '' : 'disabled'}>Build ${money(cost)}</button>` : ''}</div>`;
      }
      const pkg = b.customer ? cfg.packages[b.customer.service] : null;
      const tun = b.mode === 'manual' ? `<button class="btn ghost" data-svc="wash:tunnel:${i}" ${w.canTunnel(i) && eco.canAfford(cfg.tunnelCost) ? '' : 'disabled'}>${w.equipLevel >= cfg.tunnelMinEquipment ? `Tunnel ${money(cfg.tunnelCost)}` : `Tunnel (equip ${cfg.tunnelMinEquipment})`}</button>` : '';
      return `<div class="bay"><span class="n">Bay ${i + 1}</span><span class="st"><b>${b.mode === 'tunnel' ? 'Tunnel' : 'Manual'}</b> · ${esc(stateText[b.state] || b.state)}${pkg ? ` · ${esc(pkg.label)} ${Math.round(b.progress * 100)}%` : ''}</span>${tun}</div>`;
    }).join('');
    const pk = Object.entries(cfg.packages).map(([k, p]) => {
      const ok = w.availablePackages().includes(k);
      const price = w.packagePrice(k);
      return `<div class="bay ${ok ? '' : 'locked'}"><span class="n" style="width:30px">${p.icon}</span><span class="st"><b>${esc(p.label)}</b><br>${p.seconds}s · cleans ${Math.round(p.clean * 100)}%${ok ? '' : ' · 🔒 needs better equipment'}</span>
        ${ok ? `<button class="btn ghost" style="min-width:34px" data-svc="wash:price:${k}:-">−</button><b style="min-width:54px;text-align:center">${money(price, 2)}</b><button class="btn ghost" style="min-width:34px" data-svc="wash:price:${k}:+">+</button>` : ''}</div>`;
    }).join('');
    const ne = w.nextEquipment();
    const washers = m.employees.filter((e) => e.role === 'washer' && !e.leaving).length;
    return `<h2>🧽 Car Wash</h2><div class="sub">${w.unlockedBays} bays · ${esc(w.equipment.name)} · ${washers} washer${washers === 1 ? '' : 's'} · queue ${w.queue.length}/${w.maxQueue}</div>
      <div class="sect">Bays</div>${bays}
      <div class="sect">Service packages &amp; pricing</div>${pk}
      <div class="sub">Higher prices earn more per wash but customers with a low price tolerance stay away. Premium and Detailing need equipment upgrades.</div>
      <div class="sect">Equipment</div>
      ${ne ? `<button class="btn blue" data-svc="wash:equip" ${eco.canAfford(ne.cost) ? '' : 'disabled'}>Upgrade → ${esc(ne.name)} · ${money(ne.cost)} (speed x${ne.speed}, +${Math.round(ne.clean * 100)}% clean)</button>` : '<div class="sub">All equipment upgrades purchased.</div>'}
      <div class="sub" style="margin-top:6px">Tunnel bays only need a washer for a few seconds to start the machine, then run on their own. Daily upkeep ${money(w.unlockedBays * cfg.upkeepPerBayPerDay)}.</div>
      <div class="sect">Results</div>
      <div class="kv"><span>Washes completed</span><b>${s.served}</b></div>
      <div class="kv"><span>Revenue</span><b class="pos">${money(s.revenue, 2)}</b></div>
      <div class="kv"><span>Avg satisfaction</span><b>${w.avgSatisfaction === null ? '—' : Math.round(w.avgSatisfaction) + '%'}</b></div>
      <div class="kv"><span>Referrals from charging</span><b>${s.referrals}</b></div>
      <div class="kv"><span>Lost customers</span><b>${s.lost}</b></div>
      <div class="sub">${Object.entries(s.lostBy).map(([k, v]) => `${v}× ${esc(k)}`).join(', ') || ''}</div>`;
  },

  tplGarage() {
    const g = this.garage, eco = this.economy, cfg = g.cfg, s = g.stats, m = this.employees;
    if (!g.built) return `<h2>🔧 EV Garage</h2><div class="sub">Not built yet. Open Businesses to build it.</div>`;
    const stateText = { empty: 'Free', reserved: 'Car arriving', waiting: 'Waiting for a mechanic', diagnosing: 'Diagnosing', ready: 'Waiting for repair', blocked: 'Waiting for parts', repairing: 'Repairing', done: 'Done' };
    const lifts = g.bays.map((b, i) => {
      if (!b.unlocked) {
        const cost = g.nextLiftCost();
        return `<div class="bay"><span class="n">Lift ${i + 1}</span><span class="st">Not built</span>${i === g.unlockedBays && cost !== null ? `<button class="btn" data-svc="garage:addlift" ${eco.canAfford(cost) ? '' : 'disabled'}>Build ${money(cost)}</button>` : ''}</div>`;
      }
      const j = b.job;
      return `<div class="bay"><span class="n">Lift ${i + 1}</span><span class="st"><b>${esc(stateText[b.state] || b.state)}</b>${b.customer ? ` · ${esc(cfg.services[j?.actual || b.customer.service].label)}` : ''}${b.state === 'diagnosing' || b.state === 'repairing' ? ` ${Math.round(b.progress * 100)}%` : ''}</span></div>`;
    }).join('');
    const mech = g.mechanicSkill;
    const svc = Object.entries(cfg.services).map(([k, sv]) => {
      const eq = g.equipmentOk(k), sk = mech >= sv.skill, parts = g.hasParts(k);
      const flags = `${eq ? '' : ' · 🔒 equipment'}${sk ? '' : ` · needs mechanic skill ${sv.skill}`}${parts ? '' : ' · ⚠ parts'}`;
      return `<div class="kv"><span>${sv.icon} ${esc(sv.label)}<br><small style="color:var(--muted)">${sv.diag + sv.repair}s${esc(flags)}</small></span><b>${money(g.servicePrice(k), 2)}</b></div>`;
    }).join('');
    const parts = Object.entries(cfg.parts).map(([k, p]) => {
      const st = g.stock[k];
      return `<div class="bay"><span class="st"><b>${esc(p.label)}</b> · ${money(p.cost)} each<div class="prog" style="margin-top:4px;height:8px"><i style="width:${(st / p.max) * 100}%;background:${st === 0 ? '#d6453d' : 'var(--green)'}"></i></div></span><b style="min-width:30px;text-align:center">${st}</b>
        <button class="btn ghost" style="min-width:42px" data-svc="garage:part:${k}:1" ${eco.canAfford(p.cost) && st < p.max ? '' : 'disabled'}>+1</button><button class="btn ghost" style="min-width:42px" data-svc="garage:part:${k}:3" ${eco.canAfford(p.cost * 3) && st + 3 <= p.max ? '' : 'disabled'}>+3</button></div>`;
    }).join('');
    const ns = cfg.scanner[g.scannerLevel], nt = cfg.tools[g.toolLevel];
    const mechs = m.employees.filter((e) => e.role === 'mechanic' && !e.leaving).length;
    return `<h2>🔧 EV Garage</h2><div class="sub">${g.unlockedBays} lifts · ${mechs} mechanic${mechs === 1 ? '' : 's'} (best skill ${mech || '-'}) · queue ${g.queue.length}/${g.maxQueue}</div>
      <div class="sect">Lifts</div>${lifts}
      <div class="sect">Services</div>${svc}
      <div class="stepper" style="margin-top:8px"><button data-svc="garage:price:-">−</button><div class="val" style="font-size:18px">Prices x${g.priceMult.toFixed(2)}</div><button data-svc="garage:price:+">+</button></div>
      <div class="sect">Spare parts inventory</div>${parts}
      <label class="opt">Auto-restock ${m.hasManager ? '(manager on duty)' : '<small style="color:var(--muted)">(needs a manager)</small>'}<input id="set-autorestock" type="checkbox" ${g.autoRestock ? 'checked' : ''}></label>
      <div class="sect">Equipment</div>
      ${ns ? `<button class="btn blue" data-svc="garage:upgrade:scanner" ${eco.canAfford(ns.cost) ? '' : 'disabled'}>Scanner → ${esc(ns.name)} · ${money(ns.cost)}</button>` : '<div class="sub">Scanner fully upgraded.</div>'}
      ${nt ? `<button class="btn blue" data-svc="garage:upgrade:tools" ${eco.canAfford(nt.cost) ? '' : 'disabled'}>Tool station → ${esc(nt.name)} · ${money(nt.cost)}</button>` : '<div class="sub">Tool station fully upgraded.</div>'}
      ${g.batteryStation ? '<div class="sub">Battery service equipment installed.</div>' : `<button class="btn blue" data-svc="garage:upgrade:battery" ${eco.canAfford(cfg.batteryStationCost) ? '' : 'disabled'}>Battery service equipment · ${money(cfg.batteryStationCost)}</button>`}
      <div class="sub" style="margin-top:6px">Daily upkeep ${money(g.unlockedBays * cfg.upkeepPerBayPerDay)}. A job waits ("blocked") when parts are missing and the customer's patience keeps running.</div>
      <div class="sect">Results</div>
      <div class="kv"><span>Jobs completed</span><b>${s.served}</b></div>
      <div class="kv"><span>Revenue</span><b class="pos">${money(s.revenue, 2)}</b></div>
      <div class="kv"><span>Avg satisfaction</span><b>${g.avgSatisfaction === null ? '—' : Math.round(g.avgSatisfaction) + '%'}</b></div>
      <div class="kv"><span>Referrals from charging</span><b>${s.referrals}</b></div>
      <div class="kv"><span>Lost customers</span><b>${s.lost}</b></div>
      <div class="sub">${Object.entries(s.lostBy).map(([k, v]) => `${v}× ${esc(k)}`).join(', ') || ''}</div>`;
  },

  svcAction(a) {
    const p = a.split(':'), biz = p[0] === 'wash' ? this.wash : this.garage;
    const act = p[1], cfg = biz.cfg;
    const cost = { build: cfg.buildCost, addbay: biz.nextBayCost?.(), addlift: biz.nextLiftCost?.(), equip: biz.nextEquipment?.()?.cost, tunnel: cfg.tunnelCost,
      upgrade: p[2] === 'scanner' ? cfg.scanner?.[biz.scannerLevel]?.cost : p[2] === 'tools' ? cfg.tools?.[biz.toolLevel]?.cost : cfg.batteryStationCost }[act] || 0;
    const run = () => {
      if (act === 'build') { const r = biz.build(); this.toast(r.ok ? `${cfg.label} built! Hire staff to run it.` : r.reason, r.ok ? 'good' : 'error'); }
      else if (act === 'addbay') biz.addBay();
      else if (act === 'addlift') biz.addLift();
      else if (act === 'equip') biz.upgradeEquipment();
      else if (act === 'tunnel') biz.upgradeTunnel(+p[2]);
      else if (act === 'upgrade') biz.upgrade(p[2]);
    };
    if (['build', 'addbay', 'addlift', 'equip', 'tunnel', 'upgrade'].includes(act)) { this.guard(cost, `${{ build: 'Build', addbay: 'Build a bay at', addlift: 'Build a lift at', equip: 'Upgrade equipment at', tunnel: 'Install a tunnel at', upgrade: 'Upgrade' }[act]} the ${cfg.label}`, run); this.renderModal(); return; }
    if (act === 'part') { if (!biz.buyPart(p[2], +p[3])) this.toast('Cannot buy that part'); }
    else if (act === 'price') {
      if (biz === this.wash) biz.setPriceMult(p[2], (biz.priceMult[p[2]] ?? 1) + (p[3] === '+' ? 0.05 : -0.05));
      else biz.setPriceMult(biz.priceMult + (p[2] === '+' ? 0.05 : -0.05));
    }
    this.renderModal();
  },

  tplHub(key) {
    const h = this.hubs[key], eco = this.economy;
    if (!h) return '<h2>Hub</h2>';
    if (!h.built) return `<h2>${h.cfg.icon} ${esc(h.cfg.label)}</h2><div class="sub">Not built yet. Buy the lot in the City Map 🗺️.</div>`;
    const s = h.stats, cfg = h.hub;
    const stateText = { empty: 'Free', reserved: 'Car arriving', waiting: 'Waiting for plug-in', charging: 'Charging', done: 'Done' };
    const bays = h.bays.map((b, i) => {
      if (!b.unlocked) {
        const cost = h.nextBayCost();
        return `<div class="bay"><span class="n">Bay ${i + 1}</span><span class="st">Not built</span>${i === h.unlockedBays && cost !== null ? `<button class="btn" data-hub="${key}:addbay" ${eco.canAfford(cost) ? '' : 'disabled'}>Build ${money(cost)}</button>` : ''}</div>`;
      }
      const c = b.customer;
      return `<div class="bay"><span class="n">Bay ${i + 1}</span><span class="st"><b>${esc(stateText[b.state] || b.state)}</b>${c ? ` · ${esc(c.def.label)} ${esc(c.vehicle.label)}` : ''}${b.state === 'charging' ? ` · ${Math.round(b.vehicle.soc * 100)}% · ${b.power.toFixed(0)} kW` : ''}</span></div>`;
    }).join('');
    const nc = h.nextCharger();
    const att = this.employees.employees.filter((e) => e.role === 'attendant' && !e.leaving && this.employees.homeOf(e) === h.id).length;
    const rev = eco.ledger.revenue[h.cfg.revenueKey] || 0;
    return `<h2>${h.cfg.icon} ${esc(h.cfg.label)}</h2><div class="sub">${esc(cfg.category)} · ${h.unlockedBays} bays · ${h.charger.name} ${h.charger.kw} kW · ${att} attendant${att === 1 ? '' : 's'} · queue ${h.queue.length}/${h.maxQueue}</div>
      <div class="sect">Bays</div>${bays}
      <div class="sect">Price per kWh</div>
      <div class="stepper"><button data-hub="${key}:price:-">−</button><div class="val">${money(h.price, 2)}</div><button data-hub="${key}:price:+">+</button></div>
      <div class="sub" style="margin-top:6px">Home station price is ${money(this.station.pricePerKwh, 2)}. Premium and VIP drivers pay more but need fast chargers; price-sensitive customers leave if you charge too much.</div>
      <div class="sect">Upgrade</div>
      ${nc ? `<button class="btn blue" data-hub="${key}:charger" ${h.chargerLock() || !eco.canAfford(nc.cost) ? 'disabled' : ''}>${h.chargerLock() ? esc(h.chargerLock()) : `Chargers → ${esc(nc.name)} (${nc.kw} kW) · ${money(nc.cost)}`}</button>` : '<div class="sub">Chargers fully upgraded.</div>'}
      <div class="sub" style="margin-top:6px">Hire attendants in Staff 👥 and move them here with 📍. Daily upkeep ${money(h.unlockedBays * cfg.upkeepPerBayPerDay)} + property tax ${money(cfg.price * cfg.taxPerDay, 2)}.</div>
      <div class="sect">Results</div>
      <div class="kv"><span>Customers served</span><b>${s.served}</b></div>
      <div class="kv"><span>Revenue (today)</span><b class="pos">${money(rev, 2)}</b></div>
      <div class="kv"><span>Revenue (all time)</span><b class="pos">${money(s.revenue, 2)}</b></div>
      <div class="kv"><span>Avg satisfaction</span><b>${h.avgSatisfaction === null ? '—' : Math.round(h.avgSatisfaction) + '%'}</b></div>
      <div class="kv"><span>Lost customers</span><b>${s.lost}</b></div>
      <div class="sub">${Object.entries(s.lostBy).map(([k, v]) => `${v}× ${esc(k)}`).join(', ') || ''}</div>
      <div class="kv"><span>Decorations here</span><b>${this.placement.countFor(h.id)} · comfort +${this.placement.effects(h.id).comfort.toFixed(1)}</b></div>`;
  },

  hubAction(a) {
    const [key, act, dir] = a.split(':'), h = this.hubs[key];
    if (!h) return;
    if (act === 'price') h.setPrice(h.price + (dir === '+' ? 0.05 : -0.05));
    else if (act === 'addbay') this.guard(h.nextBayCost() || 0, `Build a bay at ${h.cfg.label}`, () => h.addBay());
    else if (act === 'charger') this.guard(h.nextCharger()?.cost || 0, `Upgrade chargers at ${h.cfg.label}`, () => h.upgradeCharger());
    this.renderModal();
  },

  tplMap() {
    const ds = this.districts, props = this.properties.list();
    const key = (ix, iz) => `${ix},${iz}`;
    const sel = this.mapSel || '0,0';
    const colors = { downtown: '#7b8794', residential: '#5fbf4a', commercial: '#2fb4dc', industrial: '#e0902f', highway: '#9a52e8', park: '#3fae7a' };
    const P = this.game.player.pos;
    let cells = '';
    for (let iz = -2; iz <= 2; iz++) for (let ix = -2; ix <= 2; ix++) {
      const d = districtOfBlock(ix, iz);
      const lot = props.find((p) => p.x === ix * 60 && p.z === iz * 60);
      const locked = !ds.isUnlocked(d);
      const icon = ix === 0 && iz === 0 ? '⚡' : lot ? (lot.status === 'owned' ? '✅' : lot.status === 'locked' ? '🔒' : '💲') : locked ? '🔒' : '';
      const sub = ix === 0 && iz === 0 ? 'Home' : lot ? esc(lot.icon) : '';
      cells += `<button class="mcell ${locked ? 'locked' : ''} ${sel === key(ix, iz) ? 'sel' : ''}" data-map="${key(ix, iz)}" style="background:${colors[d]}">${icon}<small>${sub}</small></button>`;
    }
    const dot = `<div class="pdot" style="left:${((P.x + 150) / 300) * 100}%;top:${((P.z + 150) / 300) * 100}%"></div>`;
    const [sx, sz] = sel.split(',').map(Number), sd = districtOfBlock(sx, sz);
    const slot = props.find((p) => p.x === sx * 60 && p.z === sz * 60);
    const dc = ds.cfg[sd];
    let info = '';
    if (dc) {
      const dl = ds.lock(sd);
      info += `<div class="emp"><div class="emp-h"><span class="ic">${dc.icon}</span><b>${esc(dc.name)}</b><small>${ds.isUnlocked(sd) ? 'Open' : '🔒 Locked'}</small></div><div class="emp-s">${esc(dc.blurb)}</div>
        ${ds.isUnlocked(sd) ? '' : `<div class="emp-b"><button class="btn blue" data-district="${sd}" ${ds.canUnlock(sd) ? '' : 'disabled'}>${dl ? esc(dl) : `Buy district permit · ${money(dc.cost)}`}</button></div>`}</div>`;
    } else if (sd === 'park') info += '<div class="emp"><div class="emp-h"><span class="ic">🌳</span><b>City Park</b><small>Scenery</small></div><div class="emp-s">A green space with no lots for sale.</div></div>';
    if (sx === 0 && sz === 0) info += `<div class="emp"><div class="emp-h"><span class="ic">⚡</span><b>Home charging station</b><small>Owned</small></div><div class="emp-b"><button class="btn ghost" data-travel="0,18">📍 Travel here</button> <button class="btn ghost" data-open-biz="station">Open manager</button></div></div>`;
    if (slot) {
      const stat = slot.status === 'owned' ? '<span class="tag on">Owned</span>' : slot.status === 'locked' ? '<span class="tag">🔒 Locked</span>' : '<span class="tag busy">For sale</span>';
      const g = this.gateOf(slot);
      info += `<div class="emp"><div class="emp-h"><span class="ic">${slot.icon}</span><b>${esc(slot.name)}</b>${stat}</div>
        <div class="emp-s">${esc(slot.category)} · ${esc(slot.blurb)}<br>Price <b>${money(slot.price)}</b> · upkeep <b>${money(slot.upkeep)}</b>/day · property tax <b>${money(slot.tax, 2)}</b>/day · needs Stage <b>${slot.stage}</b></div>
        <div class="emp-b">
          ${slot.owned ? `<button class="btn blue" data-open-biz="${slot.kind === 'hub' ? 'hub_' + slot.id.slice(4) : slot.id}">Open manager</button>` : `<button class="btn" data-prop="${slot.id}" ${slot.canBuy ? '' : 'disabled'}>${slot.reason ? esc(slot.reason) : `Buy · ${money(slot.price)}`}</button>`}
          <button class="btn ghost" data-travel="${g.x},${g.z}">📍 Travel</button></div></div>`;
    }
    const owned = props.filter((p) => p.owned).length;
    return `<h2>🗺️ City map</h2><div class="sub">${owned}/${props.length} lots owned · property tax ${money(props.filter((p) => p.owned).reduce((s, p) => s + p.tax, 0), 2)}/day · cash ${money(this.economy.cash)}</div>
      <div class="legend"><span>✅ owned</span><span>💲 for sale</span><span>🔒 locked</span><span style="color:#e8483f">● you</span></div>
      <div class="map">${cells}${dot}</div>${info}
      <div class="sect">Districts</div>${Object.entries(ds.cfg).filter(([k]) => k !== 'downtown').map(([k, d]) => `<div class="kv"><span>${d.icon} ${esc(d.name)}</span><b>${ds.isUnlocked(k) ? '✅ open' : `Stage ${d.stage} · ${money(d.cost)}`}</b></div>`).join('')}`;
  },

  // ---------- Milestone 7: city map, property shop, hub manager, decoration bar ----------
  gateOf(p) {
    // a spot on the road just outside the lot's gate (matches each lot's orientation)
    if (p.id === 'hub_industrial') return { x: p.x, z: p.z - 24 };
    if (p.id === 'hub_highway') return { x: p.x - 24, z: p.z };
    return { x: p.x, z: p.z + 24 };
  },

  mapAction(kind, v) {
    if (kind === 'cell') this.mapSel = v;
    else if (kind === 'district') { this.guard(this.districts.cfg[v]?.cost || 0, `Buy the ${this.districts.cfg[v]?.name} permit`, () => { if (!this.districts.unlock(v)) this.toast('Cannot unlock that district yet', 'error'); }); }
    else if (kind === 'prop') { const e = this.properties.list().find((p) => p.id === v); this.guard(e?.price || 0, `Buy ${e?.name}`, () => { const r = this.properties.buy(v); this.toast(r.ok ? 'Property purchased! Hire attendants and set your prices.' : r.reason, r.ok ? 'good' : 'error'); }); }
    else if (kind === 'travel') { const [x, z] = v.split(',').map(Number); this.game.travelTo(x, z); this.closeModal(); return; }
    this.renderModal();
  },
};
