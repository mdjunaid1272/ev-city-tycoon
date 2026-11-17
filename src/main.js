import { Game } from './core/Game.js';

const game = new Game();
game.start().catch((e) => {
  console.error('[EV City Tycoon] failed to start', e);
  const t = document.getElementById('load-text');
  if (t) t.textContent = `Failed to start: ${e.message}`;
});
