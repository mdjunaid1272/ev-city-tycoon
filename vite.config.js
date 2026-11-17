import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Normal setup: `npm i` then `npm run dev`.
// Fallback: if node_modules lives elsewhere (e.g. project on a cloud drive that can't hold it),
// set EVCT_DEPS to the folder containing node_modules and three is aliased from there.
const here = path.dirname(fileURLToPath(import.meta.url));
const depsRoot = process.env.EVCT_DEPS;
const localThree = path.join(here, 'node_modules', 'three');
const alias = [];
let cacheDir;
if (!fs.existsSync(localThree) && depsRoot) {
  const t = path.join(depsRoot, 'node_modules', 'three').replace(/\\/g, '/');
  alias.push({ find: /^three$/, replacement: `${t}/build/three.module.js` });
  alias.push({ find: /^three\/examples\/(.*)$/, replacement: `${t}/examples/$1` });
  cacheDir = path.join(depsRoot, '.vite-cache');
}

export default {
  root: here,
  base: './', // relative paths: works for Capacitor / Android WebView and static hosting
  cacheDir,
  resolve: { alias },
  server: { host: true, port: 5173, fs: { strict: false } },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
};
