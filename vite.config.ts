import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.TAURI_PLATFORM ? './' : process.env.VITE_BASE_PATH || '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@kernel': path.resolve(__dirname, './src/kernel'),
      '@georef-engine': path.resolve(__dirname, './src/georef-engine'),
      '@layers-engine': path.resolve(__dirname, './src/layers-engine'),
      '@selection-engine': path.resolve(__dirname, './src/selection-engine'),
      '@snap-engine': path.resolve(__dirname, './src/snap-engine'),
      '@drawing-engine': path.resolve(__dirname, './src/drawing-engine'),
      '@vias-engine': path.resolve(__dirname, './src/vias-engine'),
      '@lotificacion-engine': path.resolve(__dirname, './src/lotificacion-engine'),
      '@manzanos-engine': path.resolve(__dirname, './src/manzanos-engine'),
      '@label-engine': path.resolve(__dirname, './src/label-engine'),
      '@map-core': path.resolve(__dirname, './src/map-core'),
      '@persistence-engine': path.resolve(__dirname, './src/persistence-engine'),
      '@shared-ui': path.resolve(__dirname, './src/shared-ui'),
      '@app-shell': path.resolve(__dirname, './src/app-shell'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/target/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'sql.js/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  esbuild: {
    supported: {
      'top-level-await': true,
      'dynamic-import': true,
    },
  },
});
