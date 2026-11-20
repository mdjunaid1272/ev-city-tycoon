import { mergeConfig } from 'vite';
import base from './vite.config.js';

// Unit + integration tests. Logic tests run in plain Node; files that need a DOM start with `// @vitest-environment jsdom`.
export default mergeConfig(base, {
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    restoreMocks: true,
  },
});
