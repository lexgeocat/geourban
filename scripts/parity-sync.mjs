// Sincroniza el snapshot de paridad TS <-> Rust.
//
// Que hace:
//   1) Ejecuta vitest apuntando solo al archivo generador
//      (`src/geo/subdivision/__parity__/__generator__/buildSnapshot.test.ts`).
//      Ese archivo esta excluido de `npm test` regular, asi que vitest
//      no carga el reader de paridad (que fallaria con "snapshot ausente"
//      y mataria el proceso).
//   2) Espera a que vitest termine via el evento `close` del child process
//      (no `spawnSync`, que sufria SIGTERM raro en Windows + PowerShell).
//   3) Verifica que el snapshot se escribio y lo copia a la ruta de Rust.
//
// Uso:
//   npm run parity:sync
//
// Despues:
//   npm test
//   cargo test -p geourban-geo --test parity_cabecera_cuerpo

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const tsSnapshot = resolve(
  root,
  'src/geo/subdivision/__parity__/paritySnapshot.json',
);
const rustFixtureDir = resolve(
  root,
  'src-tauri/crates/geourban-geo/tests/fixtures',
);
const rustSnapshot = resolve(rustFixtureDir, 'paritySnapshot.json');

const generatorPath = resolve(
  root,
  'src/geo/subdivision/__parity__/__generator__/buildSnapshot.test.ts',
);

function runGenerator() {
  return new Promise((resolveP, rejectP) => {
    console.log('[parity:sync] Generando snapshot desde el motor TS (vitest)...');
    const child = spawn(
      'npx',
      ['--no-install', 'vitest', 'run', generatorPath, '--reporter=basic'],
      {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, NODE_OPTIONS: '' },
      },
    );
    child.on('error', (err) => rejectP(err));
    child.on('close', (code, signal) => {
      if (signal) {
        rejectP(new Error(`vitest termino por señal ${signal}`));
        return;
      }
      if (code !== 0) {
        rejectP(new Error(`vitest salio con codigo ${code}`));
        return;
      }
      resolveP();
    });
  });
}

async function main() {
  await runGenerator();

  if (!existsSync(tsSnapshot)) {
    console.error(
      `[parity:sync] vitest no escribio ${tsSnapshot}.\n` +
        '         El test generador corrio OK pero no produjo el JSON. Bug del generador.',
    );
    process.exit(1);
  }

  mkdirSync(rustFixtureDir, { recursive: true });
  copyFileSync(tsSnapshot, rustSnapshot);
  console.log(`[parity:sync] Copiado a ${rustSnapshot}`);
  console.log('[parity:sync] Listo. Ahora corre:');
  console.log('  npm test');
  console.log('  cargo test -p geourban-geo --test parity_cabecera_cuerpo');
}

main().catch((err) => {
  console.error(`[parity:sync] Error: ${err.message}`);
  process.exit(1);
});
