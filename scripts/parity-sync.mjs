#!/usr/bin/env node
// scripts/parity-sync.mjs
//
// Regenera los snapshots de paridad TS <-> Rust usados por:
//   - src/geo/subdivision/__parity__/subdivisionCabeceraCuerpo.parity.test.ts
//   - src-tauri/crates/geourban-geo/tests/parity_cabecera_cuerpo.rs
//   - src/geo/roads/__parity__/fragmentReconciliation.parity.test.ts
//   - src-tauri/crates/geourban-geo/tests/parity_fragment_reconciliation.rs
//
// Pasos:
//   1. Corre el test generador (buildSnapshot.test.ts) con una config de
//      vitest dedicada (vitest.parity-sync.config.mjs), que lo incluye
//      explícitamente sin depender del `exclude` del vitest.config.ts
//      principal.
//   2. Copia el `paritySnapshot.json` resultante a
//      src-tauri/crates/geourban-geo/tests/fixtures/, donde lo lee
//      `cargo test -p geourban-geo --test parity_cabecera_cuerpo`.
//
// ─── Sobre el bug que este archivo reemplaza ───────────────────────────
// La versión anterior invocaba `spawn('npx', [...])` directo. En Windows
// esto revienta con `Error: spawn npx ENOENT` porque ahí `npx` no es un
// ejecutable nativo sino un shim `npx.cmd`/`npx.ps1`, y
// `child_process.spawn()` SIN `shell: true` no lo resuelve vía PATHEXT
// (comportamiento documentado de Node en Windows — el mismo patrón de bug
// afecta a cualquier spawn directo de `npm`/`yarn`/`npx` sin shell). Este
// archivo lo evita en dos capas:
//   (a) resuelve y ejecuta el binario local de vitest directamente
//       (node_modules/.bin/vitest[.cmd]), sin pasar por npx en absoluto;
//   (b) igual usa `shell: true` en el spawn — que es el fix real de fondo
//       del bug — por si algún día hace falta caer al fallback de npx
//       (p. ej. en un checkout sin `node_modules` todavía instalado).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const VITEST_CONFIG = join(ROOT, 'vitest.parity-sync.config.mjs');

const SRC_SNAPSHOT = join(ROOT, 'src', 'geo', 'subdivision', '__parity__', 'paritySnapshot.json');
const SRC_FRAG_REC_SNAPSHOT = join(ROOT, 'src', 'geo', 'roads', '__parity__', 'fragRecParitySnapshot.json');
const DEST_DIR = join(ROOT, 'src-tauri', 'crates', 'geourban-geo', 'tests', 'fixtures');
const DEST_SNAPSHOT = join(DEST_DIR, 'paritySnapshot.json');
const DEST_FRAG_REC_SNAPSHOT = join(DEST_DIR, 'fragRecParitySnapshot.json');

/** Busca el binario local de `name` en node_modules/.bin — nunca toca PATH ni npx. */
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

/**
 * Corre `command args` mostrando stdout/stderr en vivo.
 * `shell: true` es la parte que realmente arregla "spawn ENOENT" con
 * shims .cmd/.ps1 en Windows: deja que el sistema operativo resuelva la
 * extensión vía PATHEXT en vez de que Node intente un exec directo del
 * archivo (que en Windows falla para .cmd/.ps1 sin pasar por un shell).
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.error) {
    console.error(`[parity:sync] No se pudo ejecutar "${command}":`, result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function generateSnapshot() {
  console.log('[parity:sync] Generando snapshot desde el motor TS (vitest)...');

  const localVitest = resolveLocalBin('vitest');
  const args = ['run', '--config', VITEST_CONFIG];

  let exitCode;
  if (localVitest) {
    exitCode = run(localVitest, args);
  } else {
    console.warn(
      '[parity:sync] No se encontró node_modules/.bin/vitest — ¿corriste `npm install`? ' +
        'Intentando con npx como último recurso…'
    );
    exitCode = run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', ...args]);
  }

  if (exitCode !== 0) {
    throw new Error(`La generación del snapshot falló (exit code ${exitCode}).`);
  }
}

function syncToRustFixtures() {
  if (!existsSync(SRC_SNAPSHOT)) {
    throw new Error(
      `Se esperaba encontrar ${SRC_SNAPSHOT} después de correr el generador, pero no está.\n` +
        'Revisá la salida de vitest de arriba — probablemente buildSnapshot.test.ts no llegó a escribirlo.'
    );
  }
  if (!existsSync(SRC_FRAG_REC_SNAPSHOT)) {
    throw new Error(
      `Se esperaba encontrar ${SRC_FRAG_REC_SNAPSHOT} después de correr el generador, pero no está.\n` +
        'Revisá la salida de vitest de arriba — probablemente buildFragRecSnapshot.test.ts no llegó a escribirlo.'
    );
  }
  mkdirSync(DEST_DIR, { recursive: true });
  copyFileSync(SRC_SNAPSHOT, DEST_SNAPSHOT);
  console.log(`[parity:sync] Snapshot copiado a ${DEST_SNAPSHOT}`);
  copyFileSync(SRC_FRAG_REC_SNAPSHOT, DEST_FRAG_REC_SNAPSHOT);
  console.log(`[parity:sync] Snapshot copiado a ${DEST_FRAG_REC_SNAPSHOT}`);
}

try {
  generateSnapshot();
  syncToRustFixtures();
  console.log(
    '[parity:sync] Listo. Corré `npm test` y desde src-tauri/:\n' +
      '  cargo test -p geourban-geo --test parity_cabecera_cuerpo\n' +
      '  cargo test -p geourban-geo --features geos-backend --test parity_fragment_reconciliation'
  );
} catch (err) {
  console.error('[parity:sync] Falló:', err instanceof Error ? err.message : err);
  process.exit(1);
}
