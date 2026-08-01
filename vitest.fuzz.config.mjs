import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config dedicado a la suite de fuzz (Fase 2.6). A diferencia de
// vitest.config.ts, este NO excluye src/geo/__fuzz__ — es su único
// propósito. vitest.config.ts sigue excluyéndolo incondicionalmente
// (a nivel de config, independiente de cualquier filtro posicional de
// CLI), así que un `vitest run src/geo/__fuzz__` contra el config
// default siempre da "No test files found". Este config resuelve eso
// sin tocar el comportamiento de `npm test`.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/geo/__fuzz__/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    watch: false,
  },
});
