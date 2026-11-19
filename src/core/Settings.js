const KEY = 'evct.settings.v1';

export const isMobile = () =>
  (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) ||
  /Android|iPhone|iPad/i.test(navigator.userAgent);

export const QUALITY = {
  low: { detail: 0.6, pixelRatio: 1, shadows: false, shadowMap: 512, treeShadows: false, traffic: 10, peds: 6, cullDist: 110, antialias: false },
  medium: { detail: 0.85, pixelRatio: 1.5, shadows: true, shadowMap: 1024, treeShadows: false, traffic: 18, peds: 12, cullDist: 150, antialias: true },
  high: { detail: 1, pixelRatio: 2, shadows: true, shadowMap: 2048, treeShadows: true, traffic: 28, peds: 20, cullDist: 220, antialias: true },
};

export class Settings {
  constructor() {
    const mobile = isMobile();
    this.data = {
      quality: mobile ? 'low' : 'high',
      sensitivity: 1,
      invertY: false,
      volume: 0.7,
    };
    try {
      Object.assign(this.data, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (_) {
      /* ignore corrupt settings */
    }
    if (!QUALITY[this.data.quality]) this.data.quality = 'medium';
  }
  get quality() {
    return QUALITY[this.data.quality];
  }
  set(k, v) {
    this.data[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (_) {
      /* storage may be blocked */
    }
  }
}
