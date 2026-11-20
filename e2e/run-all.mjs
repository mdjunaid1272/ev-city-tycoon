// Runs every browser test in this folder one after another. Needs the dev server running (npm run dev) and a Chromium-based browser:
//   EVCT_BROWSER=path/to/chrome-or-edge  EVCT_URL=http://localhost:5173/  npm run test:e2e
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.e2e.mjs'))) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const bad = out.split('\n').filter((l) => /^FAIL/.test(l));
  console.log(`${bad.length || r.status ? 'FAIL' : 'PASS'}  ${f}`);
  for (const l of bad) console.log('   ' + l.slice(0, 200));
  if (bad.length || r.status) failed++;
}
process.exit(failed ? 1 : 0);
