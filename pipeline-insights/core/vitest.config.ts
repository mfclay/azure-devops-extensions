import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // A few points under what the suite reaches, so a change that drops tests fails `npm run coverage`.
      thresholds: { lines: 97, statements: 97, branches: 92, functions: 96 },
    },
  },
});
