import { defineConfig } from 'vitest/config';

/**
 * Kept apart from vite.config.ts on purpose. Vitest resolves its own Vite 7
 * while the dev server runs Vite 8, and `@vitejs/plugin-react@6` peer-deps
 * `vite ^8`, so loading that config here would put two copies of Vite in one
 * process. A test run needs neither Fast Refresh nor the plugin's Babel pass.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
