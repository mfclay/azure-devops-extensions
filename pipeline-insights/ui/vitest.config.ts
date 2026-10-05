import { defineConfig } from 'vitest/config';

/**
 * No React plugin: esbuild's automatic JSX runtime reads `jsx: react-jsx` straight
 * out of tsconfig, and Fast Refresh is no use to a test run.
 */
export default defineConfig({
  test: {
    // Pure tests run in node. Render tests opt into jsdom with a
    // `@vitest-environment` docblock.
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
