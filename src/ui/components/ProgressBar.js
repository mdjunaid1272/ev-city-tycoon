/** Thin horizontal progress bar (HTML string). `frac` is clamped to 0..1. */
export const progressBar = (frac, color = 'var(--green)') =>
  `<div class="prog" style="height:8px;margin:4px 0"><i style="width:${Math.max(0, Math.min(1, frac)) * 100}%;background:${color}"></i></div>`;
