/**
 * One consistent icon set: 24x24 stroke icons (currentColor), rendered inline so they follow
 * the text colour of whatever button they sit in. Usage: icon('staff') or <i data-icon="staff"></i>
 * (hydrateIcons() fills every [data-icon] placeholder in the document).
 */
const P = {
  business: '<path d="M4 21V6l8-3 8 3v15"/><path d="M9 21v-5h6v5M8 9h2M14 9h2M8 12.5h2M14 12.5h2"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.4"/><path d="M17 14.2c2.4.2 4 2 4 4.3"/>',
  finance: '<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.2c-.5-.9-1.5-1.4-2.7-1.4-1.5 0-2.5.8-2.5 1.9 0 2.6 5.4 1.3 5.4 4 0 1.2-1.1 2-2.7 2-1.3 0-2.4-.6-2.9-1.6M12 6.5v1.3M12 16.2v1.3"/>',
  missions: '<path d="M6 21V4"/><path d="M6 4.5h11l-2 3.5 2 3.5H6"/>',
  more: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.3M12 18.7V21M3 12h2.3M18.7 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5c.3-1.5 1.4-2.2 2.6-2.2 1.5 0 2.5.9 2.5 2.1 0 2-2.7 2-2.7 4M12 16.6v.1"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  tutorial: '<path d="M3 8l9-4 9 4-9 4z"/><path d="M7 10.2V15c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.8"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8.3v5.4M8.3 11h5.4"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.3 11h5.4"/>',
  rotL: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4.5h4.5"/>',
  rotR: '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4.5h-4.5"/>',
  reset: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  layers: '<path d="M12 3l9 4.8-9 4.8-9-4.8z"/><path d="M3 12.2l9 4.8 9-4.8M3 16.6l9 4.8 9-4.8"/>',
  street: '<circle cx="12" cy="6" r="2.5"/><path d="M12 9v6M12 15l-3.5 5M12 15l3.5 5M7.5 11.5L12 10l4.5 1.5"/>',
  build: '<path d="M14 6.5l3.5 3.5M4 20l9.5-9.5M13 4.5l2-2 5.5 5.5-2 2z"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 0 0-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4.5h-4.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
  warn: '<path d="M12 3.5L2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.1"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
  cash: '<rect x="3" y="6.5" width="18" height="11" rx="2.5"/><circle cx="12" cy="12" r="2.6"/>',
  gem: '<path d="M7 4h10l4 5-9 11L3 9z"/><path d="M3 9h18M9.5 4L8 9l4 11 4-11-1.5-5"/>',
  star: '<path d="M12 3.5l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.9l6.1-.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  dusk: '<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 7v2.5M5.5 11l1.6 1.2M18.5 11l-1.6 1.2"/>',
  pin: '<path d="M12 21s6-5.6 6-11a6 6 0 1 0-12 0c0 5.4 6 11 6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0zM12 17v4"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  sprint: '<path d="M6 6l6 6-6 6M12 6l6 6-6 6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>',
};

export function icon(name, size = 22) {
  const body = P[name];
  if (!body) return '';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone === el.dataset.icon) return;
    el.innerHTML = icon(el.dataset.icon, +el.dataset.size || 22);
    el.dataset.iconDone = el.dataset.icon;
  });
}

export const ICONS = Object.keys(P);
