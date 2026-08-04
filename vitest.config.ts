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
    ],
    // La suite Vitest fue retirada (tests TS archivados en el branch
    // `archive/plan-fases-13`); el runner queda configurado para cuando se
    // escriban tests nuevos. La validación del motor vive en Rust (tests
    // inline de geourban-geo, corridos por parity.yml).
    passWithNoTests: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
