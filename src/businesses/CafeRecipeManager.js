/**
 * Recipes for the café mini-game (pure data logic, no DOM, no Three.js).
 *
 * Raw ingredients go on the tray, machines turn tokens into new tokens, and a few assemblies combine tokens:
 *   espresso  = cup + beans -> grinder -> ground ; cup + ground -> espresso machine -> shot
 *   latte     = shot + milk -> steamer -> steamed          (assembled)
 *   iced      = shot + ice                                  (assembled)
 *   croissant = dough -> oven
 *   sandwich  = dough + filling -> sandwich press
 * Everything is described in public/data/cafe.json ("miniGame") so it can be rebalanced without touching code.
 *
 * A token is { t: id, q: quality 0..1, raw: { ingredient: count } }; `raw` remembers which ingredients went into it so a
 * burnt item can give its ingredients back.
 */
const sumRaw = (list) => { const r = {}; for (const x of list) for (const [k, n] of Object.entries(x.raw || {})) r[k] = (r[k] || 0) + n; return r; };

export class CafeRecipeManager {
  constructor(mg) {
    this.cfg = mg;
  }
  get ingredients() { return this.cfg.ingredients; }
  get machines() { return this.cfg.machines; }
  get products() { return this.cfg.products; }

  /** Every raw ingredient the product needs (id -> count). */
  needs(pid) { return this.cfg.products[pid]?.needs || {}; }
  /** Machines the product's recipe uses. */
  machinesFor(pid) { return this.cfg.products[pid]?.machines || []; }

  /** May this raw ingredient still be added for the product? `used` = ingredients already put into this build. */
  acceptsRaw(pid, used, raw) { return (used[raw] || 0) < (this.needs(pid)[raw] || 0); }

  /** Tokens of the tray that this machine can take right now: { ok, picked:[index], missing:[label] }. */
  inputsFor(machineId, tray) {
    const m = this.cfg.machines[machineId], picked = [], missing = [];
    for (const want of m.takes) {
      const i = tray.findIndex((tk, idx) => tk.t === want && !picked.includes(idx));
      if (i < 0) missing.push(this.tokenLabel(want)); else picked.push(i);
    }
    return { ok: missing.length === 0, picked, missing };
  }

  tokenLabel(id) { return this.cfg.tokens[id]?.label || this.cfg.ingredients[id]?.label || id; }
  tokenIcon(id) { return this.cfg.tokens[id]?.icon || this.cfg.ingredients[id]?.icon || '•'; }

  /** Combine tokens that form an assembly (repeatedly). Returns the new tray. */
  assemble(tray) {
    let t = [...tray], changed = true;
    while (changed) {
      changed = false;
      for (const a of this.cfg.assemblies) {
        const idx = []; let ok = true;
        for (const want of a.in) { const i = t.findIndex((tk, k) => tk.t === want && !idx.includes(k)); if (i < 0) { ok = false; break; } idx.push(i); }
        if (!ok) continue;
        const parts = idx.map((i) => t[i]);
        const pr = parts.filter((x) => x.proc), merged = { t: a.out, q: pr.length ? pr.reduce((s, x) => s + x.q, 0) / pr.length : 1, raw: sumRaw(parts), proc: true };
        t = t.filter((_, k) => !idx.includes(k)); t.push(merged); changed = true; break;
      }
    }
    return t;
  }

  /** The tray is exactly the finished product. */
  finished(pid, tray) { return tray.length === 1 && tray[0].t === this.cfg.products[pid].token; }

  /** A short "what's still missing" hint for the UI. */
  hint(pid, used, tray) {
    const need = this.needs(pid), miss = Object.entries(need).filter(([k, n]) => (used[k] || 0) < n).map(([k]) => this.cfg.ingredients[k].label);
    if (miss.length) return `Add: ${miss.join(', ')}`;
    const m = this.machinesFor(pid).find((id) => this.inputsFor(id, tray).ok);
    return m ? `Use the ${this.cfg.machines[m].label}` : 'Collect from the machines';
  }
}
