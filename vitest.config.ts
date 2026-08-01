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
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/__generator__/**',
      // Fase 2.6 — fuzzing: puede tardar mucho y, en el peor caso, colgarse
      // por robustez de JSTS ante geometría patológica. No corre en
      // `npm test`; se corre a demanda con `npm run test:fuzz`, que además
      // usa el watchdog de proceso (ver script abajo).
      'src/geo/__fuzz__/**',
    ],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});