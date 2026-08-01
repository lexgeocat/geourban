#!/usr/bin/env node
// scripts/run-vitest-with-watchdog.mjs
//
// Envuelve `vitest run` con un watchdog externo: si el proceso hijo se
// cuelga más allá de un timeout (típico con JSTS OverlayOp sobre
// geometría patológica, que no tiene cancelación interna), lo matamos
// desde afuera en vez de dejar CI colgado indefinidamente.
//
// El suite de fuzz (src/geo/__fuzz__) es lento/no-determinístico por
// diseño y se excluye del `npm test` normal — PERO si el caller apunta
// explícitamente a esa carpeta (como hace `npm run test:fuzz`), la
// exclusión se levanta automáticamente. Antes este script la excluía
// siempre, dejando `test:fuzz` sin ningún archivo para correr.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const FUZZ_DIR = 'src/geo/__fuzz__';
const DEFAULT_WATCHDOG_MS = 120_000; // margen sobre cualquier --testTimeout

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** ¿Alguno de los argumentos posicionales (no-flags) apunta al directorio de fuzz? */
function targetsFuzzDir(args) {
  return args.some((a) => !a.startsWith('-') && toPosix(a).includes(FUZZ_DIR));
}

function hasExplicitExclude(args) {
  return args.some((a) => a === '--exclude' || a.startsWith('--exclude='));
}

function extractTestTimeoutMs(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--testTimeout')) {
      const raw = a.includes('=') ? a.split('=')[1] : args[i + 1];
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

async function main() {
  const cliArgs = process.argv.slice(2);
  const vitestArgs = [...cliArgs];

  const fuzzTargeted = targetsFuzzDir(cliArgs);

  // Solo inyectamos la exclusión del fuzz suite si:
  //  (a) el caller no está apuntando explícitamente a esa carpeta, y
  //  (b) el caller no trajo su propio --exclude (no lo pisamos).
  if (!fuzzTargeted && !hasExplicitExclude(cliArgs)) {
    vitestArgs.push('--exclude', `${FUZZ_DIR}/**`);
  }

  const explicitTimeout = extractTestTimeoutMs(cliArgs);
  const watchdogMs = explicitTimeout != null ? explicitTimeout + 60_000 : DEFAULT_WATCHDOG_MS;

  const vitestBin =
    process.platform === 'win32'
      ? path.join(ROOT, 'node_modules', '.bin', 'vitest.cmd')
      : path.join(ROOT, 'node_modules', '.bin', 'vitest');

  const child = spawn(vitestBin, vitestArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
  });

  let settled = false;
  let killedByWatchdog = false;

  const killTree = () => {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* noop */
        }
      }
    }
  };

  const watchdog = setTimeout(() => {
    if (settled) return;
    killedByWatchdog = true;
    console.error(
      `\n[watchdog] vitest superó ${watchdogMs}ms sin terminar — se asume una operación ` +
        'geométrica sin cota (p.ej. JSTS OverlayOp) colgada. Matando el árbol de procesos.\n'
    );
    killTree();
  }, watchdogMs);
  watchdog.unref?.();

  const onSignal = () => {
    if (!settled) killTree();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      settled = true;
      clearTimeout(watchdog);
      if (killedByWatchdog) return resolve(1);
      resolve(code ?? (signal ? 1 : 0));
    });
    child.on('error', (err) => {
      settled = true;
      clearTimeout(watchdog);
      console.error('[watchdog] no se pudo lanzar vitest:', err);
      resolve(1);
    });
  });

  process.exit(exitCode);
}

main();
