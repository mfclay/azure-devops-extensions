import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // A few points under what the suite reaches, so a change that drops tests fails `npm run coverage`.
      thresholds: { lines: 96, statements: 96, branches: 87, functions: 93 },
    },
  },
});
