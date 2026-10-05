import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * The hub ships as static files inside the VSIX and is served from a path Azure DevOps chooses,
 * so every asset reference is relative. `scripts/package.mjs` stages `dist/hub/`.
 *
 * `--mode demo` builds the demo hub into `dist/demo-hub/`: the same page, reading the synthetic
 * contoso estate instead of the project, for screenshots. Only that build swaps `./source.js`
 * for `src/demo-source.ts`, so no other hub can reach a fixture.
 */
const src = fileURLToPath(new URL('./src/', import.meta.url));

/** In a demo build, the hub's own `./source.js` resolves to `demo-source.ts`. Nothing else moves. */
const demoSource: Plugin = {
  name: 'pipeline-insights-demo-source',
  enforce: 'pre',
  resolveId(id, importer) {
    if (id === './source.js' && importer?.startsWith(src)) return `${src}demo-source.ts`;
    return null;
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [demoSource] : [])],
  base: './',
  build: {
    outDir: mode === 'demo' ? 'dist/demo-hub' : 'dist/hub',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
}));
