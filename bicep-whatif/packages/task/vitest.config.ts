import { defineConfig } from 'vitest/config';

/**
 * `@bicep-whatif/core` resolves through the workspace symlink to its build
 * output, exactly as it does for `packages/ui` and exactly as it will inside the
 * bundled task. Testing against the same artefact the task ships means a stale
 * `core` build shows up here rather than in a pipeline.
 *
 * `npm run build` at the repo root builds `core` first, so the root
 * `npm test` always has it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
