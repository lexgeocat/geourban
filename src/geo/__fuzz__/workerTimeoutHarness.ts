// ─────────────────────────────────────────────────────────────────────
// src/geo/__fuzz__/workerTimeoutHarness.ts
//
// Ejecuta una función síncrona potencialmente colgante (JSTS/polygon-
// clipping) en un worker_thread real, con timeout duro. A diferencia de
// Promise.race + setTimeout en el mismo hilo (que NO sirve si el
// callback es síncrono y bloquea el event loop), worker.terminate()
// aborta el isolate del worker desde afuera, incluso en medio de un
// bucle síncrono. Esto es lo único que puede matar un JSTS OverlayOp
// colgado sin matar todo el proceso de test.
// ─────────────────────────────────────────────────────────────────────
import { Worker } from 'node:worker_threads';
import * as esbuild from 'esbuild';

const bundleCache = new Map<string, string>();

function bundleEntry(entryAbsPath: string): string {
  const cached = bundleCache.get(entryAbsPath);
  if (cached) return cached;
  const result = esbuild.buildSync({
    entryPoints: [entryAbsPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external', // jsts, polygon-clipping, node builtins: se resuelven vía require() normal
    target: 'node18',
    write: false,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  bundleCache.set(entryAbsPath, code);
  return code;
}

export interface WorkerRunResult<T> {
  status: 'ok' | 'timeout' | 'error';
  value?: T;
  error?: string;
  elapsedMs: number;
}

export function runInWorkerWithTimeout<TInput, TOutput>(
  entryAbsPath: string,
  input: TInput,
  timeoutMs: number,
): Promise<WorkerRunResult<TOutput>> {
  const code = bundleEntry(entryAbsPath);
  const t0 = performance.now();

  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(code, { eval: true, workerData: input });

    const finish = (result: WorkerRunResult<TOutput>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ status: 'timeout', elapsedMs: performance.now() - t0 });
    }, timeoutMs);
    // No mantener vivo el proceso de test solo por este timer.
    timer.unref?.();

    worker.once('message', (msg: any) => {
      if (msg && msg.ok) {
        finish({ status: 'ok', value: msg as TOutput, elapsedMs: performance.now() - t0 });
      } else {
        finish({ status: 'error', error: msg?.error ?? 'unknown worker error', elapsedMs: performance.now() - t0 });
      }
    });

    worker.once('error', (err) => {
      finish({ status: 'error', error: err.message, elapsedMs: performance.now() - t0 });
    });
  });
}