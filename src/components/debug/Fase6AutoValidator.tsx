import React, { useEffect, useState } from 'react';
import { useMapStore } from '../../store/map/mapStore';
import { runSyntheticUrbanBenchmarkSuite } from '../../geo/debug/syntheticUrbanBenchmark';
import { runConcurrencyStressSuite } from '../../geo/debug/concurrencyStressBenchmark';

const POST_URL = 'http://127.0.0.1:9876/results';

async function postWithRetry(body: unknown, attempts = 60): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(POST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
    } catch {
      // server aún levantando o CSP — reintentar
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function waitForSource(): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const poll = () => {
      const src = useMapStore.getState().drawSource;
      if (src) {
        resolve(true);
        return;
      }
      if (Date.now() - t0 > 30_000) {
        resolve(false);
        return;
      }
      setTimeout(poll, 200);
    };
    poll();
  });
}

export default function Fase6AutoValidator() {
  const [state, setState] = useState('esperando drawSource…');

  useEffect(() => {
    if (!window.location.hash.startsWith('#fase6-validate')) return;

    let cancelled = false;
    (async () => {
      const ok = await waitForSource();
      if (cancelled) return;
      if (!ok) {
        setState('ERROR: drawSource no inicializó');
        void postWithRetry({ urbanError: 'drawSource no inicializó en 30s' });
        return;
      }

      // Dejar que el primer frame real renderice antes de estresar.
      await new Promise((r) => {
        let n = 0;
        const tick = () => { if (++n >= 3) { r(null); return; } requestAnimationFrame(tick); };
        tick();
      });
      await new Promise((r) => setTimeout(r, 400));
      if (cancelled) return;

      const view = useMapStore.getState().mapInstance?.getView();
      const center = (view?.getCenter() as [number, number] | undefined) ?? [0, 0];

      let urban: unknown = null;
      let urbanError: string | null = null;
      try {
        setState('Fase 6.1: suite urbana (25/100/400)…');
        urban = await runSyntheticUrbanBenchmarkSuite([
          { targetBlockCount: 25, center },
          { targetBlockCount: 100, center },
          { targetBlockCount: 400, center },
        ]);
      } catch (err) {
        urbanError = err instanceof Error ? err.message : String(err);
        setState(`6.1 ERROR: ${urbanError}`);
      }

      let concurrency: unknown = null;
      let concurrencyError: string | null = null;
      try {
        setState('Fase 6.4: concurrencia (32/64/128)…');
        concurrency = await runConcurrencyStressSuite();
      } catch (err) {
        concurrencyError = err instanceof Error ? err.message : String(err);
        setState(`6.4 ERROR: ${concurrencyError}`);
      }

      if (cancelled) return;
      setState('POSTeando resultados al harness…');
      const posted = await postWithRetry({ urban, urbanError, concurrency, concurrencyError });
      setState(posted ? 'DONE: resultados entregados.' : 'WARN: no se pudieron entregar los resultados.');
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <div
      style={{
        position: 'fixed', top: 8, right: 8, zIndex: 99999,
        background: '#0b0f14', border: '1px solid #f59e0b', color: '#fbbf24',
        padding: '6px 10px', fontSize: 12, fontFamily: 'monospace', maxWidth: 480,
      }}
    >
      [Fase6AutoValidator] {state}
    </div>
  );
}
