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
    exclude: ['node_modules', 'dist', 'src-tauri', 'src/**/__parity__/__generator__/**'],
    reporters: ['default'],
    // pool 'forks' corre cada archivo en un proceso hijo real: si un test
    // síncrono se cuelga (p.ej. un overlay JSTS pesado), el proceso padre
    // puede matarlo desde afuera al vencer testTimeout. Con el pool
    // 'threads' por defecto, un bloqueo síncrono del hilo puede impedir
    // que el propio timer de timeout dispare.
    pool: 'forks',
    testTimeout: 10000,
  },
});
