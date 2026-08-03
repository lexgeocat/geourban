import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const FUZZ_DIR = 'src/geo/__fuzz__';
const FUZZ_CONFIG_CANDIDATES = ['vitest.fuzz.config.mjs', 'vitest.fuzz.config.ts'];
const DEFAULT_WATCHDOG_MS = 120_000; // margen sobre cualquier --testTimeout

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function targetsFuzzDir(args) {
  return args.some((a) => !a.startsWith('-') && toPosix(a).includes(FUZZ_DIR));
}

function hasExplicitConfig(args) {
  return args.some((a) => a === '--config' || a.startsWith('--config='));
}

function resolveFuzzConfigPath() {
  for (const candidate of FUZZ_CONFIG_CANDIDATES) {
    if (existsSync(path.join(ROOT, candidate))) return candidate;
  }
  return null;
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

  if (fuzzTargeted) {
    if (!hasExplicitConfig(cliArgs)) {
      const fuzzConfig = resolveFuzzConfigPath();
      if (!fuzzConfig) {
        console.error(
          `\n[watchdog] Se pidió correr la suite de fuzz (${FUZZ_DIR}) pero no existe ninguno de ` +
            `estos configs en la raíz del repo: ${FUZZ_CONFIG_CANDIDATES.join(', ')}.\n` +
            'Creá vitest.fuzz.config.mjs (sin excluir src/geo/__fuzz__) o pasá --config explícitamente.\n'
        );
        process.exit(1);
      }
      vitestArgs.push('--config', fuzzConfig);
    }
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
        } catch {}
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
