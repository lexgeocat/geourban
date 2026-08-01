import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    include: [
      'src/geo/subdivision/__parity__/__generator__/buildSnapshot.test.ts',
      'src/geo/subdivision/__parity__/__generator__/buildSnapshotExactModo2.test.ts',
      'src/geo/roads/__parity__/__generator__/buildFragRecSnapshot.test.ts',
      'src/workers/__parity__/__generator__/buildComputeManzanosSnapshot.test.ts',
    ],
    exclude: [],
    watch: false,
  },
});
