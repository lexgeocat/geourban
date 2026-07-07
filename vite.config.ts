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
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  esbuild: {
    supported: {
      'top-level-await': true,
    'dynamic-import': true,
    'import-meta': true,
    'async-await': true,
    'async-generator': true,
    'async-iteration': true,
    'optional-chaining': true,
    'nullish-coalescing': true,
    'class-fields': true,
    'class-static-block': true,
    'class-properties': true,
    'class-private-methods': true,
    'class-private-fields': true,
    'class-public-fields': true,
    'class-public-methods': true,
    'class-constructor': true,
    'class-extends': true,
    'class-super': true,
    'class-decorators': true,
    'class-decorators-legacy': true,
    'class-methods-private': true,
    'class-methods-public': true,
    'class-methods-static': true,
    'class-methods-abstract': true,
    'class-methods-async': true,
    'class-methods-generator': true,
    'class-methods-async-generator': true,
    'class-methods-async-iteration': true,
    'class-methods-optional-chaining': true,
    'class-methods-nullish-coalescing': true,
  },
});