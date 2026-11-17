/**
 * Rewarded-ad integration point. This is a simulated provider: it shows a short demo overlay and resolves
 * true when the "ad" finished. Replace `provider` with the portal / mobile SDK (Poki, CrazyGames, AdMob...)
 * without touching the callers. Ads are always optional and never interrupt play.
 */
export class AdService {
  constructor() {
    this.removeAds = false; // set by the "remove ads" purchase (Milestone 8)
    this.provider = null;
    this.shown = 0;
  }

  /** placement: 'offline-2x' | 'daily-2x' | 'upgrade-speedup' ... Resolves true if the reward should be granted. */
  async showRewarded(placement) {
    if (this.provider) return this.provider(placement);
    if (this.removeAds || window.__AD_INSTANT) { this.shown++; return true; } // purchased skip / automated tests
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.id = 'ad-overlay';
      el.innerHTML = `<div class="ad-card"><div class="ad-tag">Rewarded ad (demo)</div><div class="ad-box">🎬</div><div id="ad-count">Ad ends in 3…</div><button id="ad-close" class="btn" disabled>Claim reward</button><button id="ad-skip" class="btn ghost">No thanks</button></div>`;
      document.body.appendChild(el);
      let n = 3;
      const t = setInterval(() => {
        n--;
        el.querySelector('#ad-count').textContent = n > 0 ? `Ad ends in ${n}…` : 'Thanks for watching!';
        if (n <= 0) { clearInterval(t); el.querySelector('#ad-close').disabled = false; }
      }, 1000);
      const done = (ok) => { clearInterval(t); el.remove(); if (ok) this.shown++; resolve(ok); };
      el.querySelector('#ad-close').onclick = () => done(true);
      el.querySelector('#ad-skip').onclick = () => done(false);
    });
  }
}
