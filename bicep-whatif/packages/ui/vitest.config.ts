import { defineConfig } from 'vitest/config';

/**
 * Deliberately without `@vitejs/plugin-react`.
 *
 * Vitest resolves its own Vite 7 while the dev/build config runs Vite 8, and
 * `@vitejs/plugin-react@6` peer-deps `vite ^8` — loading it here would put two
 * copies of Vite in one process. The plugin only adds Fast Refresh and the Babel
 * pipeline, neither of which a test run needs: esbuild's automatic JSX runtime
 * reads `jsx: react-jsx` straight out of tsconfig.
 */
export default defineConfig({
  test: {
    // Pure model/join tests run in node. The one render test opts into jsdom
    // with a `@vitest-environment` docblock.
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
