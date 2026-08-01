#!/usr/bin/env node
// scripts/parity-sync.mjs
//
// Regenera los snapshots de paridad TS <-> Rust:
//   - subdivideManzanoCabeceraCuerpo (metodo 'auto')
//   - subdivideManzanoExact / subdivideManzanoAuto (metodos 'exact'/'modo2')
//   - matchFragmentsToMembers (reconciliacion de fragmentos)
//   - computeManzanos (union + diferencia de la red vial, GEOS/JSTS)
//
// Pasos: (1) corre los tests generadores via vitest.parity-sync.config.mjs,
// (2) copia cada snapshot resultante a tests/fixtures/ del crate Rust.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const VITEST_CONFIG = join(ROOT, 'vitest.parity-sync.config.mjs');
const DEST_DIR = join(ROOT, 'src-tauri', 'crates', 'geourban-geo', 'tests', 'fixtures');

const SNAPSHOTS = [
  {
    label: 'subdivideManzanoCabeceraCuerpo (auto)',
    src: join(ROOT, 'src', 'geo', 'subdivision', '__parity__', 'paritySnapshot.json'),
    dest: join(DEST_DIR, 'paritySnapshot.json'),
  },
  {
    label: 'subdivideManzanoExact/Auto (exact/modo2)',
    src: join(ROOT, 'src', 'geo', 'subdivision', '__parity__', 'paritySnapshotExactModo2.json'),
    dest: join(DEST_DIR, 'paritySnapshotExactModo2.json'),
  },
  {
    label: 'matchFragmentsToMembers',
    src: join(ROOT, 'src', 'geo', 'roads', '__parity__', 'fragRecParitySnapshot.json'),
    dest: join(DEST_DIR, 'fragRecParitySnapshot.json'),
  },
  {
    label: 'computeManzanos',
    src: join(ROOT, 'src', 'workers', '__parity__', 'computeManzanosParitySnapshot.json'),
    dest: join(DEST_DIR, 'computeManzanosParitySnapshot.json'),
  },
];

function resolveLocalBin(name) {
  const binDir = join(ROOT, 'node_modules', '.bin');
  const candidates =
    process.platform === 'win32' ? [`${name}.cmd`, `${name}.ps1`, `${name}.exe`, name] : [name];
  for (const candidate of candidates) {
    const full = join(binDir, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.error) {
    console.error(`[parity:sync] No se pudo ejecutar "${command}":`, result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function generateSnapshots() {
  console.log('[parity:sync] Generando snapshots desde el motor TS (vitest)...');
  const localVitest = resolveLocalBin('vitest');
  const args = ['run', '--config', VITEST_CONFIG];
  let exitCode;
  if (localVitest) {
    exitCode = run(localVitest, args);
  } else {
    console.warn('[parity:sync] No se encontro node_modules/.bin/vitest — intentando con npx...');
    exitCode = run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', ...args]);
  }
  if (exitCode !== 0) throw new Error(`La generacion de snapshots fallo (exit code ${exitCode}).`);
}

function syncToRustFixtures() {
  mkdirSync(DEST_DIR, { recursive: true });
  for (const { label, src, dest } of SNAPSHOTS) {
    if (!existsSync(src)) {
      throw new Error(
        `Se esperaba encontrar ${src} (${label}) despues de correr el generador, pero no esta.\n` +
          'Revisa la salida de vitest de arriba.'
      );
    }
    copyFileSync(src, dest);
    console.log(`[parity:sync] Snapshot "${label}" copiado a ${dest}`);
  }
}

try {
  generateSnapshots();
  syncToRustFixtures();
  console.log(
    '[parity:sync] Listo. Corre `npm test` y desde src-tauri/:\n' +
      '  cargo test -p geourban-geo --test parity_cabecera_cuerpo\n' +
      '  cargo test -p geourban-geo --test parity_exact_modo2\n' +
      '  cargo test -p geourban-geo --features geos-backend --test parity_fragment_reconciliation\n' +
      '  cargo test -p geourban-geo --features geos-backend --test parity_compute_manzanos'
  );
} catch (err) {
  console.error('[parity:sync] Fallo:', err instanceof Error ? err.message : err);
  process.exit(1);
}
