/** Helpers and constants shared by UIManager and its panel modules. */
export { QUALITY } from '../core/Settings.js';
export { districtOfBlock } from '../world/DistrictManager.js';
export { icon, hydrateIcons } from './icons.js';
export { siteCounts, aggregateStats } from '../customers/SiteCounts.js';

export const $ = (id) => document.getElementById(id);
export const CONFIRM_COST = 10000; // purchases at or above this price ask for confirmation
export const NAV_MODALS = ['business', 'staff', 'finance', 'missions'];
export const MORE_MODALS = ['profile', 'settings', 'stats', 'help', 'save', 'pause'];
export const DECOR_CATS = { Greenery: ['tree', 'planter'], Seating: ['bench', 'picnic'], Lighting: ['lamp'], Signs: ['banner'] };
export const money = (n, dec = 0) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
