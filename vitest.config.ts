import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    setupFiles: ['src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@kernel': resolve(__dirname, 'src/kernel'),
      '@georef-engine': resolve(__dirname, 'src/georef-engine'),
      '@layers-engine': resolve(__dirname, 'src/layers-engine'),
      '@selection-engine': resolve(__dirname, 'src/selection-engine'),
      '@snap-engine': resolve(__dirname, 'src/snap-engine'),
      '@drawing-engine': resolve(__dirname, 'src/drawing-engine'),
      '@vias-engine': resolve(__dirname, 'src/vias-engine'),
      '@lotificacion-engine': resolve(__dirname, 'src/lotificacion-engine'),
      '@manzanos-engine': resolve(__dirname, 'src/manzanos-engine'),
      '@label-engine': resolve(__dirname, 'src/label-engine'),
      '@map-core': resolve(__dirname, 'src/map-core'),
      '@persistence-engine': resolve(__dirname, 'src/persistence-engine'),
      '@shared-ui': resolve(__dirname, 'src/shared-ui'),
      '@app-shell': resolve(__dirname, 'src/app-shell'),
    },
  },
});

