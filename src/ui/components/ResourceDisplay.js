import { money, esc } from '../uiShared.js';

/** "+$500 +5💎 +3⭐" for a reward object {cash, gems, reputation}. */
export function rewardText(r) {
  const p = [];
  if (r.cash) p.push(`+${money(r.cash)}`);
  if (r.gems) p.push(`+${r.gems}💎`);
  if (r.reputation) p.push(`+${r.reputation}⭐`);
  return p.join(' ');
}
export const rewardHtml = (r) => esc(rewardText(r || {}));
