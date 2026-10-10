import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The tab ships as static files inside a VSIX and is served from a path the
 * extension host chooses, so every asset reference has to be relative.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    // Nothing in the VSIX reads them, and the source is public anyway.
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    // The committed fixtures live in packages/core, outside this package's root.
    // `?mock=1`, which only the dev server serves, loads them from there — see src/data/mock.ts.
    fs: { allow: ['../..'] },
  },
});
