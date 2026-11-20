/** Tab strip for a multi-tab board: `cur` is the active tab key, `list` is [[key, label], ...]. */
export const tabStrip = (name, cur, list) =>
  `<div class="tabs">${list.map(([k, label]) => `<button class="tab ${cur === k ? 'on' : ''}" data-tab="${name}:${k}">${label}</button>`).join('')}</div>`;
