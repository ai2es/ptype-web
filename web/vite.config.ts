import { cpSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * Third-party runtime files that are served as-is from public/.
 *
 * autumnplot-gl's npm build assumes webpack (extension-less worker URLs, a
 * side-effect .wasm import), so the site uses its prebuilt browser bundle
 * instead: the files are copied to public/autumnplot and loaded by a script
 * tag in index.html. src/vendor/apgl.ts re-exports the global with types.
 *
 * MapLibre locates its worker relative to its own file at run time, which a
 * bundler cannot follow; the self-contained worker file is copied too and
 * registered with setWorkerUrl in src/map/MapView.tsx.
 */
function copyRuntimeFiles(): Plugin {
  return {
    name: 'copy-runtime-files',
    buildStart() {
      mkdirSync('public/autumnplot', { recursive: true });
      for (const f of ['autumnplot-gl.js', '812.autumnplot-gl.js', '983.autumnplot-gl.js', 'marchingsquares.wasm', 'autumnplot-gl.js.LICENSE.txt']) {
        cpSync(`node_modules/autumnplot-gl/dist/${f}`, `public/autumnplot/${f}`);
      }
      mkdirSync('public/maplibre', { recursive: true });
      cpSync('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', 'public/maplibre/maplibre-gl-worker.mjs');
    },
  };
}

// `base` defaults to a relative path so the same build works at a GitHub Pages
// project path (/ptype-web/), a custom domain root, and `vite preview`.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [copyRuntimeFiles(), react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
