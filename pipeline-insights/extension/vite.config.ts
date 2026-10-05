import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The hub ships as static files inside the VSIX and is served from a path Azure DevOps chooses,
 * so every asset reference is relative. `scripts/package.mjs` stages `dist/hub/`.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/hub',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});
