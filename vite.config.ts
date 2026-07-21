import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.TAURI_PLATFORM ? './' : process.env.VITE_BASE_PATH || '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
        // Empaqueta el .wasm de sql.js como un asset estático servible.
        // Lo exponemos bajo `/sql.js/` para que `locateFile` lo encuentre
        // sin depender del CDN de sql.js.org.
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'sql.js/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['sql.js'],
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