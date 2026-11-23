/**
 * The café's regular customers (pure logic): who comes when, what they like, how friendly they are and which story chapter
 * they are on. Every customer is a named character with a personality, a schedule, favourite drinks / desserts and a short
 * story told over several visits (public/data/cafe-cozy.json). Dialogue is deterministic and optional: a chapter is offered once,
 * after the customer has been served, and the player can always skip it. Nothing here is random filler text.
 *
 * Saved per customer: visits, friendship points, finished chapters, what they were served.
 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class CafeRoster {
  constructor({ cfg, saved = null, rng = Math.random }) {
    this.cfg = cfg;
    this.rng = rng;
    this.state = {};
    const s = saved && typeof saved === 'object' ? saved : {};
    for (const id of Object.keys(cfg.customers)) {
      const r = s[id] && typeof s[id] === 'object' ? s[id] : {};
      const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
      const beats = Array.isArray(r.beats) ? r.beats.filter((i) => Number.isInteger(i) && i >= 0 && i < cfg.customers[id].story.length) : [];
      const served = {};
      if (r.served && typeof r.served === 'object') for (const [k, v] of Object.entries(r.served)) if (cfg.products[k] && Number.isFinite(v) && v > 0) served[k] = Math.floor(v);
      this.state[id] = { met: !!r.met || n(r.visits) > 0, visits: n(r.visits), friend: n(r.friend), lastDay: n(r.lastDay), beats: [...new Set(beats)], served };
    }
    this.last = null; // the customer who came most recently (not picked again straight away)
  }

  get ids() { return Object.keys(this.cfg.customers); }
  def(id) { return this.cfg.customers[id]; }

  // ---------- friendship ----------
  levelOf(id) {
    const f = this.state[id].friend, L = this.cfg.friendLevels;
    let lv = 0; for (let i = 0; i < L.length; i++) if (f >= L[i]) lv = i;
    return lv; // 0 .. friendLevels.length - 1
  }
  levelName(lv) { return ['Stranger', 'Acquaintance', 'Regular', 'Friend', 'Best friend'][lv] || 'Friend'; }
  /** Progress to the next friendship level: { frac, next }. */
  friendProgress(id) {
    const f = this.state[id].friend, L = this.cfg.friendLevels, lv = this.levelOf(id);
    if (lv >= L.length - 1) return { frac: 1, next: null };
    return { frac: clamp((f - L[lv]) / (L[lv + 1] - L[lv]), 0, 1), next: L[lv + 1] };
  }

  // ---------- who comes ----------
  unlocked(id, cafeLevel) { return this.cfg.customers[id].level <= cafeLevel; }

  /** Pick the next visitor: unlocked customers whose usual hours match get a strong preference; never the same one twice in a row. */
  pick({ level = 1, hour = 12, day = 1, exclude = [] }) {
    const pool = this.ids.filter((id) => this.unlocked(id, level) && !exclude.includes(id) && id !== this.last);
    if (!pool.length) return this.ids.find((id) => this.unlocked(id, level)) || this.ids[0];
    const w = pool.map((id) => {
      const c = this.cfg.customers[id], st = this.state[id], [a, b] = c.hours;
      let x = hour >= a && hour < b ? 4 : 0.7;
      if (!st.met) x *= 1.6; // new faces are introduced quickly
      x *= 1 + Math.min(2, day - st.lastDay) * 0.15; // somebody who has not been in for a while is "due"
      if (c.vip) x *= 0.6;
      return Math.max(0.05, x);
    });
    let r = this.rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return (this.last = pool[i]); }
    return (this.last = pool[pool.length - 1]);
  }

  /** What this customer wants to order: favourites most of the time, anything unlocked otherwise. */
  chooseProducts({ id, count = 1, unlocked, kinds = ['drink'] }) {
    const c = this.cfg.customers[id], out = [];
    for (let i = 0; i < count; i++) {
      const kind = kinds[Math.min(i, kinds.length - 1)];
      const favs = (kind === 'drink' ? c.likes.drinks : c.likes.desserts).filter((p) => unlocked.includes(p));
      const any = unlocked.filter((p) => this.cfg.products[p].kind === kind);
      const pool = favs.length && this.rng() < 0.65 ? favs : any;
      out.push(pool[Math.floor(this.rng() * pool.length)] || any[0] || unlocked[0]);
    }
    return out;
  }
  likes(id, pid) { const c = this.cfg.customers[id]; return c.likes.drinks.includes(pid) || c.likes.desserts.includes(pid); }

  // ---------- visits and stories ----------
  recordVisit(id, { day = 1, happy = false, served = [] }) {
    const st = this.state[id];
    st.met = true; st.visits++; st.lastDay = day;
    st.friend += 1 + (happy ? 1 : 0);
    for (const p of served) st.served[p] = (st.served[p] || 0) + 1;
  }

  /** The next unfinished chapter this customer is ready to tell (needs enough visits), or null. */
  nextBeat(id, extraVisits = 0) {
    const c = this.cfg.customers[id], st = this.state[id], v = st.visits + extraVisits;
    for (let i = 0; i < c.story.length; i++) {
      if (st.beats.includes(i)) continue;
      return v >= c.story[i].at && v > 0 ? { index: i, ...c.story[i] } : null; // chapters are told in order
    }
    return null;
  }
  storyProgress(id) { const c = this.cfg.customers[id]; return { done: this.state[id].beats.length, total: c.story.length }; }

  /** Finish a chapter (optionally with the chosen answer). Returns { friend, reply, reward, repeated }. */
  completeBeat(id, index, choice = null) {
    const c = this.cfg.customers[id], st = this.state[id], beat = c.story[index];
    if (!beat || st.beats.includes(index)) return { friend: 0, reply: '', reward: null, repeated: true };
    st.beats.push(index);
    const ch = choice !== null && beat.choices?.[choice] ? beat.choices[choice] : null;
    const friend = 2 + (ch?.friend || 0);
    st.friend += friend;
    return { friend, reply: ch?.reply || '', reward: beat.reward || null, repeated: false };
  }

  /** Everything the collection screen shows for one customer. */
  profile(id) {
    const c = this.cfg.customers[id], st = this.state[id], lv = this.levelOf(id);
    return {
      id, name: st.met ? c.name : '???', category: c.category, icon: c.icon, met: st.met, personality: st.met ? c.personality : 'Not met yet', bio: st.met ? c.bio : 'Visits the café once it reaches a higher level.',
      visits: st.visits, friend: st.friend, level: lv, levelName: this.levelName(lv), progress: this.friendProgress(id), likes: c.likes, story: this.storyProgress(id),
      chapters: c.story.map((b, i) => ({ index: i, title: st.beats.includes(i) ? b.title : '???', done: st.beats.includes(i), ready: this.nextBeat(id)?.index === i })), served: { ...st.served },
    };
  }

  serialize() {
    const out = {};
    for (const [id, st] of Object.entries(this.state)) if (st.met || st.visits || st.beats.length) out[id] = { met: st.met, visits: st.visits, friend: st.friend, lastDay: st.lastDay, beats: [...st.beats], served: { ...st.served } };
    return out;
  }
}
