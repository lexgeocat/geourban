import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // `__parity__/__generator__/` se excluye: ese directorio contiene
    // tests "side-effect" que escriben a disco (generan el snapshot).
    // Solo se invocan via `npm run parity:sync` apuntando con ruta
    // explícita. `npm test` regular es solo lectura.
    exclude: [
      'node_modules',
      'dist',
      'src-tauri',
      'src/**/__parity__/__generator__/**',
    ],
    reporters: ['default'],
  },
});
