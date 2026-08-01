#!/usr/bin/env node
// scripts/run-vitest-with-watchdog.mjs
//
// Ejecuta vitest en un proceso hijo con timeout duro a nivel de SO.
// El timeout interno de Vitest no sirve contra un test bloqueado en
// código 100% síncrono (p. ej. OverlayOp.difference de JSTS con
// geometría patológica): ese timeout se chequea en el mismo event loop
// que está bloqueado, así que nunca dispara. Un proceso padre aparte SÍ
// puede matar al hijo por señal del SO, sin depender de que el hijo
// coopere.
import { spawn } from 'node:child_process';
import process from 'node:process';

const TIMEOUT_MS = Number(process.env.VITEST_WATCHDOG_TIMEOUT_MS ?? 3 * 60_000);
const vitestArgs = process.argv.slice(2);
const isWindows = process.platform === 'win32';

const child = spawn('npx', ['vitest', ...vitestArgs], {
  stdio: 'inherit',
  shell: isWindows, // en Windows npx es un .cmd
});

let settled = false;

const timer = setTimeout(() => {
  if (settled) return;
  console.error(
    `\n⛔ [watchdog] vitest no terminó en ${TIMEOUT_MS}ms — probablemente hay un test ` +
      'colgado en una llamada síncrona (p. ej. una unión/diferencia de JSTS con geometría ' +
      'patológica). Matando el proceso y sus hijos.\n'
  );
  if (isWindows && child.pid) {
    // taskkill mata el árbol completo (npx -> node -> vitest workers).
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  } else {
    child.kill('SIGKILL');
  }
  process.exitCode = 1;
}, TIMEOUT_MS);

child.on('exit', (code, signal) => {
  settled = true;
  clearTimeout(timer);
  if (signal) {
    console.error(`[watchdog] vitest terminó por señal ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});

child.on('error', (err) => {
  settled = true;
  clearTimeout(timer);
  console.error('[watchdog] no se pudo lanzar vitest:', err);
  process.exitCode = 1;
});
