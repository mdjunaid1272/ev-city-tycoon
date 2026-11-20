import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { PlayerProfile, cleanName, AVATARS, OUTFITS, NAME_MAX, DEFAULT_NAME, BADGES } from '../src/player/PlayerProfile.js';

describe('player profile', () => {
  it('starts with sensible defaults', () => {
    const p = new PlayerProfile({ now: () => 1234 });
    expect(p.name).toBe(DEFAULT_NAME); expect(p.avatar).toBe(AVATARS[0]); expect(p.outfit).toBe(OUTFITS[0].id);
    expect(p.createdAt).toBe(1234); expect(p.playSeconds).toBe(0);
  });

  it('cleans names: markup, control characters, spacing and length', () => {
    expect(cleanName('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(cleanName('<b>Hi</b>&"\'`')).toBe('bHi/b');
    expect(cleanName('a\u0000b\nc')).toBe('abc');
    expect(cleanName('x'.repeat(60))).toHaveLength(NAME_MAX);
    expect(cleanName('   ')).toBe('');
    expect(cleanName(null)).toBe('');
  });

  it('rejects empty names and keeps the old one; accepts valid changes and announces them once', () => {
    const bus = new EventBus(), seen = vi.fn(); bus.on('profile:changed', seen);
    const p = new PlayerProfile({ bus });
    expect(p.setName('   ')).toBe(false); expect(p.name).toBe(DEFAULT_NAME); expect(seen).not.toHaveBeenCalled();
    expect(p.setName('Zed')).toBe(true); expect(p.name).toBe('Zed'); expect(seen).toHaveBeenCalledTimes(1);
    expect(p.setName('Zed')).toBe(true); expect(seen).toHaveBeenCalledTimes(1); // unchanged: no event
  });

  it('only accepts known avatars and outfits', () => {
    const p = new PlayerProfile();
    expect(p.setAvatar('💥')).toBe(false); expect(p.setAvatar(AVATARS[2])).toBe(true); expect(p.avatar).toBe(AVATARS[2]);
    expect(p.setOutfit('nope')).toBe(false); expect(p.setOutfit('green')).toBe(true); expect(p.outfitDef.shirt).toBe(0x35c28a);
  });

  it('round-trips through the save, and repairs corrupt or missing data', () => {
    const p = new PlayerProfile({ now: () => 99 });
    p.setName('Mira'); p.setAvatar(AVATARS[3]); p.setOutfit('gold'); p.update(61.4);
    const q = new PlayerProfile({ saved: JSON.parse(JSON.stringify(p.serialize())) });
    expect(q.serialize()).toEqual(p.serialize());
    const bad = new PlayerProfile({ saved: { name: 42, avatar: 'x', outfit: {}, createdAt: 'yesterday', playSeconds: -5 }, now: () => 7 });
    expect(bad.name).toBe('42'); expect(bad.avatar).toBe(AVATARS[0]); expect(bad.outfit).toBe(OUTFITS[0].id); expect(bad.createdAt).toBe(7); expect(bad.playSeconds).toBe(0);
    expect(new PlayerProfile({ saved: 'garbage' }).name).toBe(DEFAULT_NAME);
  });

  it('playtime ignores absurd frame gaps', () => {
    const p = new PlayerProfile();
    p.update(0.5); p.update(-1); p.update(600);
    expect(p.playSeconds).toBeCloseTo(0.5);
  });

  it('level, title and badges are derived from live stats', () => {
    const p = new PlayerProfile();
    const base = { served: 0, revenue: 0, stage: 1, days: 1, contracts: 0, charged: 0, washed: 0, repaired: 0 };
    const a = p.summary(base);
    expect(a.level).toBe(1); expect(a.title).toBe('Rookie Operator'); expect(a.frac).toBe(0); expect(a.badges.every((b) => !b.earned)).toBe(true);
    const b = p.summary({ ...base, served: 60, revenue: 10500, stage: 3, days: 12, charged: 1, washed: 1, repaired: 1 });
    expect(b.level).toBe(6); expect(b.title).toBe('Fleet Manager'); expect(b.frac).toBeGreaterThanOrEqual(0); expect(b.frac).toBeLessThanOrEqual(1);
    const got = b.badges.filter((x) => x.earned).map((x) => x.id);
    expect(got).toEqual(expect.arrayContaining(['first', 'c50', 'r10k', 's3', 'd10', 'jack']));
    expect(got).not.toContain('c500');
    expect(b.badges).toHaveLength(BADGES.length);
    expect(p.summary({ ...base, stage: 99 }).title).toBe('Energy Tycoon'); // stages beyond the list keep the top title
  });
});