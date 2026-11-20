/**
 * Player profile: who the boss is (name, avatar, outfit colour) plus a long-term career summary (level, title, badges,
 * playtime). Identity is stored in the save; level / title / badges are always DERIVED from the existing stats, so they
 * can never drift out of sync and old saves get them for free.
 */
export const AVATARS = ['😎', '🤠', '🦊', '🐼', '🐯', '🐸', '🚗', '⚡'];
export const OUTFITS = [
  { id: 'blue', name: 'Blue', shirt: 0x2f8cff, hat: 0xe8483f },
  { id: 'green', name: 'Green', shirt: 0x35c28a, hat: 0xffc43d },
  { id: 'orange', name: 'Orange', shirt: 0xff7a59, hat: 0x2f8cff },
  { id: 'purple', name: 'Purple', shirt: 0xb06cff, hat: 0xf4f7fa },
  { id: 'pink', name: 'Pink', shirt: 0xff8fb1, hat: 0x3a4a6b },
  { id: 'gold', name: 'Gold', shirt: 0xffc43d, hat: 0x1f8a4c },
];
/** one title per business stage (public/data/progression.json has four) */
export const TITLES = ['Rookie Operator', 'Station Owner', 'Business Boss', 'City EV Mogul'];
export const NAME_MAX = 16;
export const DEFAULT_NAME = 'Player';

export const BADGES = [
  { id: 'first', icon: '🔌', name: 'First charge', desc: 'Serve your first customer', test: (c) => c.served >= 1 },
  { id: 'c50', icon: '🚙', name: 'Busy station', desc: 'Serve 50 customers', test: (c) => c.served >= 50 },
  { id: 'c500', icon: '🚦', name: 'Rush hour', desc: 'Serve 500 customers', test: (c) => c.served >= 500 },
  { id: 'r10k', icon: '💵', name: 'Ten grand', desc: 'Earn $10,000 in total', test: (c) => c.revenue >= 10000 },
  { id: 'r250k', icon: '💰', name: 'Quarter million', desc: 'Earn $250,000 in total', test: (c) => c.revenue >= 250000 },
  { id: 's3', icon: '🏙️', name: 'Growing business', desc: 'Reach stage 3', test: (c) => c.stage >= 3 },
  { id: 'd10', icon: '📅', name: 'Ten days in', desc: 'Run the city for 10 days', test: (c) => c.days >= 10 },
  { id: 'contract', icon: '📝', name: 'Deal maker', desc: 'Complete a contract', test: (c) => c.contracts >= 1 },
  { id: 'jack', icon: '🧰', name: 'Jack of all trades', desc: 'Charge, wash and repair cars', test: (c) => c.charged > 0 && c.washed > 0 && c.repaired > 0 },
];

/** Strip control characters and markup, collapse spaces, clamp the length. Returns '' when nothing usable is left. */
export function cleanName(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

export class PlayerProfile {
  constructor({ bus = null, saved = null, now = () => Date.now() } = {}) {
    this.bus = bus;
    this.now = now;
    const s = saved && typeof saved === 'object' ? saved : {};
    this.name = cleanName(s.name) || DEFAULT_NAME;
    this.avatar = AVATARS.includes(s.avatar) ? s.avatar : AVATARS[0];
    this.outfit = OUTFITS.some((o) => o.id === s.outfit) ? s.outfit : OUTFITS[0].id;
    this.createdAt = Number.isFinite(s.createdAt) && s.createdAt > 0 ? s.createdAt : now();
    this.playSeconds = Number.isFinite(s.playSeconds) && s.playSeconds >= 0 ? s.playSeconds : 0;
  }

  get outfitDef() { return OUTFITS.find((o) => o.id === this.outfit) || OUTFITS[0]; }

  /** Counts game time only (the caller does not tick while paused). */
  update(dt) { if (dt > 0 && dt < 5) this.playSeconds += dt; }

  setName(raw) {
    const n = cleanName(raw);
    if (!n) return false;
    if (n !== this.name) { this.name = n; this.changed(); }
    return true;
  }
  setAvatar(a) { if (!AVATARS.includes(a) || a === this.avatar) return false; this.avatar = a; this.changed(); return true; }
  setOutfit(id) { if (!OUTFITS.some((o) => o.id === id) || id === this.outfit) return false; this.outfit = id; this.changed(); return true; }
  changed() { this.bus?.emit('profile:changed', this); }

  /** Career summary from the live game numbers: { served, revenue, stage, days, contracts, charged, washed, repaired }. */
  summary(c) {
    const level = 1 + Math.floor(Math.sqrt(Math.max(0, c.revenue) / 400));
    const base = (level - 1) ** 2 * 400, next = level ** 2 * 400;
    return {
      level, xp: c.revenue - base, xpNeed: next - base, frac: Math.min(1, Math.max(0, (c.revenue - base) / (next - base))),
      title: TITLES[Math.min(TITLES.length - 1, Math.max(0, (c.stage || 1) - 1))],
      badges: BADGES.map((b) => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc, earned: !!b.test(c) })),
    };
  }

  serialize() { return { v: 1, name: this.name, avatar: this.avatar, outfit: this.outfit, createdAt: this.createdAt, playSeconds: Math.round(this.playSeconds) }; }
}
