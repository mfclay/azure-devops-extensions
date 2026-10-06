import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'text'],
      // A few points under what the suite reaches, so a real drop fails and noise does not.
      thresholds: { lines: 97, statements: 97, branches: 92, functions: 97 },
    },
  },
});
