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
    // Fase 2.7: el motor JS (jsts/polygon-clipping) fue retirado y con él
    // los tests de parity TS↔JS y el fuzz TS (el fuzz vive en Rust,
    // tests/fuzz_degenerate_geometry.rs). Los fixtures de parity quedaron
    // congelados en src-tauri/crates/geourban-geo/tests/fixtures/.
    passWithNoTests: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
