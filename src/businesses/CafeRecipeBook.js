/**
 * Recipes of the cozy café (pure data logic, no DOM, no Three.js).
 *
 * Raw ingredients go on the tray; machines turn tokens into new tokens (a machine may have several recipes, e.g. the drip & tea
 * machine); finally the tokens of a drink are combined (latte = espresso shot + steamed milk). Finishing touches (whipped cream,
 * cinnamon, sugar cubes, sprinkles) are add-ons: they never block a recipe, they only satisfy (or spoil) a customer's request.
 * Everything is data (public/data/cafe-cozy.json), so recipes, machines and unlock levels can be rebalanced without code.
 *
 * A token is { t: id, q: quality 0..1, raw: { ingredient: count }, proc?: true }. `raw` remembers the ingredients inside it so a
 * burnt item can give them back, `proc` marks tokens that went through a machine (only those carry timing quality).
 */
const sumRaw = (list) => { const r = {}; for (const x of list) for (const [k, n] of Object.entries(x.raw || {})) r[k] = (r[k] || 0) + n; return r; };

export class CafeRecipeBook {
  constructor(cfg) {
    this.cfg = cfg;
    this._relevant = {};
  }
  get products() { return this.cfg.products; }
  get machines() { return this.cfg.machines; }
  get ingredients() { return this.cfg.ingredients; }

  isAddon(raw) { return !!this.cfg.ingredients[raw]?.addon; }
  needs(pid) { return this.cfg.products[pid]?.needs || {}; }
  machinesFor(pid) { return this.cfg.products[pid]?.machines || []; }
  isDisplay(pid) { return !!this.cfg.products[pid]?.display; }
  tokenLabel(id) { return this.cfg.tokens[id]?.label || this.cfg.ingredients[id]?.label || id; }
  tokenIcon(id) { return this.cfg.tokens[id]?.icon || this.cfg.ingredients[id]?.icon || '•'; }

  /** Tokens on the way to the finished product (the final token, its combine parts and everything the machines must make for them). */
  relevant(pid) {
    if (this._relevant[pid]) return this._relevant[pid];
    const p = this.cfg.products[pid], set = new Set([p.final, ...(p.combine || [])]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of [...set]) {
        if (this.cfg.ingredients[t]) continue;
        for (const mid of p.machines) for (const r of this.cfg.machines[mid].recipes) if (r.makes === t) for (const x of r.takes) if (!set.has(x)) { set.add(x); grew = true; }
      }
    }
    return (this._relevant[pid] = set);
  }

  /**
   * May this raw ingredient go on the tray for this product? `used` = ingredients already put into the build.
   * Add-ons are always welcome unless the customer asked for the opposite ("no sugar").
   */
  acceptsRaw(pid, used, raw, forbid = []) {
    if (this.isAddon(raw)) return !forbid.includes(raw) && (used[raw] || 0) < 2;
    return (used[raw] || 0) < (this.needs(pid)[raw] || 0);
  }

  /** A machine recipe that fits the tray AND leads towards the product. { ok, recipe, picked: [index], missing: [labels] } */
  inputsFor(machineId, tray, pid) {
    const m = this.cfg.machines[machineId], rel = pid ? this.relevant(pid) : null;
    let best = null;
    for (const r of m.recipes) {
      if (rel && !rel.has(r.makes)) continue;
      const picked = [], missing = [];
      for (const want of r.takes) {
        const i = tray.findIndex((tk, idx) => tk.t === want && !picked.includes(idx));
        if (i < 0) missing.push(this.tokenLabel(want)); else picked.push(i);
      }
      if (!missing.length) return { ok: true, recipe: r, picked, missing: [] };
      if (!best || missing.length < best.missing.length) best = { ok: false, recipe: r, picked: [], missing };
    }
    return best || { ok: false, recipe: null, picked: [], missing: [] };
  }

  /** Apply a drink's final combine step when its tokens are all on the tray. Returns the new tray. */
  combine(pid, tray) {
    const p = this.cfg.products[pid];
    if (!p.combine) return tray;
    const idx = [];
    for (const want of p.combine) { const i = tray.findIndex((tk, k) => tk.t === want && !idx.includes(k)); if (i < 0) return tray; idx.push(i); }
    const parts = idx.map((i) => tray[i]), pr = parts.filter((x) => x.proc);
    const merged = { t: p.final, q: pr.length ? pr.reduce((s, x) => s + x.q, 0) / pr.length : 1, raw: sumRaw(parts), proc: true };
    return [...tray.filter((_, k) => !idx.includes(k)), merged];
  }

  finished(pid, tray) { return tray.length === 1 && tray[0].t === this.cfg.products[pid].final; }

  /** Short "what next" hint for the order panel. */
  hint(pid, used, tray) {
    const need = this.needs(pid), miss = Object.entries(need).filter(([k, n]) => (used[k] || 0) < n).map(([k]) => this.cfg.ingredients[k].label);
    if (miss.length) return `Add: ${miss.join(', ')}`;
    const m = this.machinesFor(pid).find((id) => this.inputsFor(id, tray, pid).ok);
    return m ? `Use the ${this.cfg.machines[m].label}` : 'Collect from the machines';
  }

  /** The recipe as readable steps (recipe book). */
  steps(pid) {
    const p = this.cfg.products[pid], out = [];
    if (p.display) return [{ icon: '🧁', text: 'Take it from the bakery display' }];
    out.push({ icon: '🧺', text: `Gather: ${Object.entries(p.needs).map(([k, n]) => `${n > 1 ? n + '× ' : ''}${this.cfg.ingredients[k].label}`).join(', ')}` });
    const rel = this.relevant(pid), seen = new Set();
    const order = [];
    const visit = (t) => {
      if (seen.has(t) || this.cfg.ingredients[t]) return; seen.add(t);
      for (const mid of p.machines) for (const r of this.cfg.machines[mid].recipes) if (r.makes === t && rel.has(t)) { for (const x of r.takes) visit(x); order.push({ mid, r }); return; }
    };
    for (const t of [p.final, ...(p.combine || [])]) visit(t);
    for (const { mid, r } of order) out.push({ icon: this.cfg.machines[mid].icon, text: `${this.cfg.machines[mid].label}: ${r.takes.map((x) => this.tokenLabel(x)).join(' + ')} → ${this.tokenLabel(r.makes)}` });
    if (p.combine) out.push({ icon: '🥄', text: `Combine: ${p.combine.map((x) => this.tokenLabel(x)).join(' + ')} → ${this.tokenLabel(p.final)}` });
    out.push({ icon: '✨', text: 'Optional: add a finishing touch (cinnamon, whipped cream…)' });
    return out;
  }
}
