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
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    // The committed fixtures live in packages/core, outside this package's root.
    // `?mock=1` loads them from there — see src/data/mock.ts.
    fs: { allow: ['../..'] },
  },
});
