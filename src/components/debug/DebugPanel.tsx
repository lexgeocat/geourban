// src/components/debug/DebugPanel.tsx
import React, { useEffect, useRef, useState } from 'react';
import { useDebugPanelStore } from '../../store/debug/debugPanelStore';
import { useMapStore } from '../../store/map/mapStore';
import { readDebugCounters, readPostrenderSplit } from '../../store/debug/debugCounters';
import type { DebugCountersSnapshot } from '../../store/debug/debugCounters';
import { readGeometryTelemetry } from '../../store/debug/geometryTelemetry';
import {
  readWorkerStats,
  readUndoCommandStats,
  readProjectLoadStats,
  readHeapSnapshot,
  type WorkerStatSnapshot,
} from '../../store/debug/perfTelemetry';
import { generateSyntheticManzanos, ensureSyntheticLotLayer } from '../../geo/debug/syntheticDataset';
import { readNativeEngineStats, type NativeEngineStatsSnapshot } from '../../store/debug/nativeEngineTelemetry';
import {
  readNativeMemorySnapshot,
  refreshNativeMemory,
  type NativeMemorySnapshot,
} from '../../store/debug/nativeMemoryTelemetry';
import { readAffineStats, type AffineStatsSnapshot } from '../../store/debug/affineTelemetry';
import { runStreetUndoBenchmarkSuite, type StreetUndoBenchmarkResult } from '../../geo/debug/undoRedoBenchmark';
import { runSpatialIndexBenchmarkSuite, type SpatialIndexBenchmarkResult } from '../../geo/debug/spatialIndexBenchmark';
import { runSyntheticUrbanBenchmarkSuite, type SyntheticUrbanBenchmarkResult } from '../../geo/debug/syntheticUrbanBenchmark';
import {
  runConcurrencyStressSuite,
  type ConcurrencyStressResult,
} from '../../geo/debug/concurrencyStressBenchmark';
import { LOCAL_TANGENT_PLANE_KEY, MAX_ACCEPTABLE_ERROR_M, utmTileCache } from '../../geo/crs/affineCache';
import { runAffineAccuracySuite, type AffineAccuracyResult } from '../../geo/debug/affineAccuracyBenchmark';

const REFRESH_MS = 400;
const SYNTHETIC_SIZES = [100_000, 500_000, 1_000_000] as const;

function useFps(active: boolean) {
  const [fps, setFps] = useState(0);
  const [fpsAvg, setFpsAvg] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const avgRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    lastRef.current = performance.now();
    avgRef.current = 0;

    const tick = (now: number) => {
      const delta = now - lastRef.current;
      lastRef.current = now;
      if (delta > 0) {
        const instant = 1000 / delta;
        avgRef.current = avgRef.current === 0 ? instant : avgRef.current * 0.9 + instant * 0.1;
        setFps(instant);
        setFpsAvg(avgRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  return { fps, fpsAvg };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '1px 0' }}>
      <span style={{ color: 'var(--cad-text-dim)' }}>{label}</span>
      <span style={{ color: 'var(--cad-accent-green)' }}>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--cad-border)', color: 'var(--cad-accent-amber)', fontWeight: 700, marginBottom: 3 }}>
      {children}
    </div>
  );
}

function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function DebugPanel() {
  const open = useDebugPanelStore((s) => s.open);
  const setOpen = useDebugPanelStore((s) => s.setOpen);
  const [compact, setCompact] = useState(true);
  const { fps, fpsAvg } = useFps(open);
  const [counters, setCounters] = useState<DebugCountersSnapshot | null>(null);
  const [split, setSplit] = useState<Record<string, number>>({});
  const [featureCount, setFeatureCount] = useState(0);
  const [geoTelemetry, setGeoTelemetry] = useState<ReturnType<typeof readGeometryTelemetry> | null>(null);
  const [workerStats, setWorkerStats] = useState<WorkerStatSnapshot[]>([]);
  const [undoSnap, setUndoSnap] = useState(readUndoCommandStats());
  const [projectLoad, setProjectLoad] = useState(readProjectLoadStats());
  const [heap, setHeap] = useState(readHeapSnapshot());
  const [nativeMem, setNativeMem] = useState<NativeMemorySnapshot>(readNativeMemorySnapshot());
  const [nativeStats, setNativeStats] = useState<NativeEngineStatsSnapshot[]>([]);
  const [affineStats, setAffineStats] = useState<AffineStatsSnapshot[]>([]);
  const [benchBusy, setBenchBusy] = useState(false);
  const [benchResults, setBenchResults] = useState<StreetUndoBenchmarkResult[]>([]);
  const [benchError, setBenchError] = useState<string | null>(null);

  const [spatialBusy, setSpatialBusy] = useState(false);
  const [spatialResults, setSpatialResults] = useState<SpatialIndexBenchmarkResult[]>([]);
  const [spatialError, setSpatialError] = useState<string | null>(null);
  const [urbanBusy, setUrbanBusy] = useState(false);
  const [urbanResults, setUrbanResults] = useState<SyntheticUrbanBenchmarkResult[]>([]);
  const [urbanError, setUrbanError] = useState<string | null>(null);
  const [affineAccBusy, setAffineAccBusy] = useState(false);
  const [affineAccResults, setAffineAccResults] = useState<AffineAccuracyResult[]>([]);
  const [affineAccError, setAffineAccError] = useState<string | null>(null);

  const [concurrencyBusy, setConcurrencyBusy] = useState(false);
  const [concurrencyResults, setConcurrencyResults] = useState<ConcurrencyStressResult[]>([]);
  const [concurrencyError, setConcurrencyError] = useState<string | null>(null);

  const [genBusy, setGenBusy] = useState<number | null>(null);
  const [lastGen, setLastGen] = useState<{
    size: number;
    generateMs: number;
    loadMs: number;
    manzanoCount: number;
    lotCount: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const tick = () => {
      setCounters(readDebugCounters());
      setSplit(readPostrenderSplit());
      setGeoTelemetry(readGeometryTelemetry());
      setWorkerStats(readWorkerStats());
      setUndoSnap(readUndoCommandStats());
      setProjectLoad(readProjectLoadStats());
      setHeap(readHeapSnapshot());
      setNativeStats(readNativeEngineStats());
      setAffineStats(readAffineStats());
      const src = useMapStore.getState().drawSource;
      setFeatureCount(src ? src.getFeatures().length : 0);
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    void refreshNativeMemory(true).then(setNativeMem);
    const memId = setInterval(() => void refreshNativeMemory().then(setNativeMem), 4000);
    return () => {
      clearInterval(id);
      clearInterval(memId);
    };
  }, [open]);

  const handleRunBenchmark = () => {
    if (benchBusy) return;
    setBenchBusy(true);
    setBenchError(null);
    void runStreetUndoBenchmarkSuite([10_000, 100_000, 500_000])
      .then(setBenchResults)
      .catch((err) => setBenchError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBenchBusy(false));
  };

  const handleRunSpatialBenchmark = () => {
    if (spatialBusy) return;
    setSpatialBusy(true);
    setSpatialError(null);
    void runSpatialIndexBenchmarkSuite([10_000, 100_000, 500_000])
      .then(setSpatialResults)
      .catch((err) => setSpatialError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSpatialBusy(false));
  };

  const handleRunUrbanBenchmark = () => {
    if (urbanBusy) return;
    setUrbanBusy(true);
    setUrbanError(null);
    const view = useMapStore.getState().mapInstance?.getView();
    const center = (view?.getCenter() as [number, number] | undefined) ?? [0, 0];
    void runSyntheticUrbanBenchmarkSuite([
      { targetBlockCount: 25, center },
      { targetBlockCount: 100, center },
      { targetBlockCount: 400, center },
    ])
      .then(setUrbanResults)
      .catch((err) => setUrbanError(err instanceof Error ? err.message : String(err)))
      .finally(() => setUrbanBusy(false));
  };
  const handleRunAffineAccuracy = () => {
    if (affineAccBusy) return;
    setAffineAccBusy(true);
    setAffineAccError(null);
    setTimeout(() => {
      try {
        const results = runAffineAccuracySuite([1_000, 10_000, 100_000]);
        setAffineAccResults(results);
      } catch (err) {
        setAffineAccError(err instanceof Error ? err.message : String(err));
      } finally {
        setAffineAccBusy(false);
      }
    }, 30);
  };

  const handleRunConcurrencyStress = () => {
    if (concurrencyBusy) return;
    setConcurrencyBusy(true);
    setConcurrencyError(null);
    void runConcurrencyStressSuite()
      .then(setConcurrencyResults)
      .catch((err) => setConcurrencyError(err instanceof Error ? err.message : String(err)))
      .finally(() => setConcurrencyBusy(false));
  };

  const handleGenerateSynthetic = (size: number) => {
    if (genBusy != null) return;
    setGenBusy(size);

    setTimeout(() => {
      try {
        ensureSyntheticLotLayer();
        const view = useMapStore.getState().mapInstance?.getView();
        const center = (view?.getCenter() as [number, number] | undefined) ?? [0, 0];
        const { collection, generateMs, extent, manzanoCount, lotCount } = generateSyntheticManzanos(size, center);
        useMapStore.getState().restoreDrawFeatures(collection);

        const fitLoaded = (): boolean => {
          const m = useMapStore.getState().mapInstance;
          const v = m?.getView();
          const src = useMapStore.getState().drawSource;
          if (!v || !src) return false;
          const srcExtent = src.getExtent();
          const valid = (e: number[] | null | undefined): boolean =>
            e != null && e.length >= 4 && Number.isFinite(e[0]) && Number.isFinite(e[1]);
          const target = valid(srcExtent) ? srcExtent : extent;
          if (!target) return false;
          v.fit(target as number[], { padding: [40, 40, 40, 40], maxZoom: 19 });
          return true;
        };
        if (!fitLoaded()) {
          let attempts = 0;
          const retryFit = () => {
            attempts++;
            if (fitLoaded() || attempts > 120) return;
            requestAnimationFrame(retryFit);
          };
          requestAnimationFrame(retryFit);
        }

        const load = readProjectLoadStats();
        setLastGen({ size, generateMs, loadMs: load.lastMs, manzanoCount, lotCount });
        setProjectLoad(load);
      } finally {
        setGenBusy(null);
      }
    }, 30);
  };

  if (!open) return null;

  return (
    <div
      className="cad-panel-glass"
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 5000,
        padding: '8px 10px',
        fontSize: '0.68rem',
        fontFamily: 'JetBrains Mono, monospace',
        color: 'var(--cad-text)',
        minWidth: 260,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, borderBottom: '1px solid var(--cad-border)', paddingBottom: 4 }}>
        <span style={{ fontWeight: 700, color: 'var(--cad-accent)' }}>DEBUG</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setCompact((c) => !c)}
            style={{ background: 'none', border: 'none', color: compact ? 'var(--cad-accent-green)' : 'var(--cad-text-dim)', cursor: 'pointer', fontSize: '0.68rem' }}
            aria-label="Alternar modo compacto"
            title={compact ? 'Expandir panel completo' : 'Colapsar a métricas de rendimiento'}
          >
            {compact ? 'COMPACTO' : 'EXPANDIDO'}
          </button>
          <button
            onClick={() => setOpen(false)}
            style={{ background: 'none', border: 'none', color: 'var(--cad-text-dim)', cursor: 'pointer' }}
            aria-label="Cerrar panel de debug"
          >
            ✕
          </button>
        </span>
      </div>

      <Row label="FPS" value={fps.toFixed(0)} />
      <Row label="FPS avg" value={fpsAvg.toFixed(1)} />
      <Row label="WebGL layers" value={String(counters?.webglLayerCount ?? 0)} />
      <Row label="Features" value={String(featureCount)} />
      <Row label="Postrender last" value={`${(counters?.postrenderLastMs ?? 0).toFixed(2)} ms`} />
      <Row label="Postrender avg" value={`${(counters?.postrenderAvgMs ?? 0).toFixed(2)} ms`} />
      <Row
        label="Label cache (hit/miss/min)"
        value={`${counters?.labelCacheHitsPerMin ?? 0} / ${counters?.labelCacheMissesPerMin ?? 0}`}
      />
      <Row
        label="Postrender split (avg ms)"
        value={`fullFrame=${split.fullFrame?.toFixed(1)} · prologue=${split.prologue?.toFixed(1)} · visible=${split.getVisibleFeatures?.toFixed(1)} · labels=${split.labels?.toFixed(1)} · resto=${split.resto?.toFixed(1)}`}
      />
      <Row label="setStyle/min" value={String(counters?.setStyleCallsPerMin ?? 0)} />
      <Row label="syncLayerSet/min" value={String(counters?.syncLayerSetCallsPerMin ?? 0)} />
      <Row label="syncGizmo/min" value={String(counters?.syncGizmoCallsPerMin ?? 0)} />

      {!compact && (
        <>
      <SectionTitle>Memoria heap JS</SectionTitle>
      {heap.available ? (
        <>
          <Row label="Used" value={`${heap.usedMB.toFixed(0)} MB`} />
          <Row label="Total" value={`${heap.totalMB.toFixed(0)} MB`} />
          <Row label="Limit" value={`${heap.limitMB.toFixed(0)} MB`} />
        </>
      ) : (
        <div style={{ color: 'var(--cad-text-muted)', fontStyle: 'italic' }}>
          performance.memory no disponible en este webview
        </div>
      )}

      <SectionTitle>Memoria proceso nativo (Fase 6.2 — RSS Rust)</SectionTitle>
      {nativeMem.available ? (
        <>
          <Row label="RSS (física)" value={`${nativeMem.rssMB.toFixed(0)} MB`} />
          <Row label="Privada" value={`${nativeMem.privateMB.toFixed(0)} MB`} />
          <Row label="Pico RSS" value={`${nativeMem.peakRssMB.toFixed(0)} MB`} />
          <Row
            label="Total JS + nativo"
            value={`${(heap.usedMB + nativeMem.rssMB).toFixed(0)} MB`}
          />
          <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.6rem', marginBottom: 4 }}>
            Objetivo Fase 6.2: &lt;2GB con 1M features. El heap JS de arriba
            solo cubre el webview — GEOS, buffers batch e índice viven acá.
          </div>
        </>
      ) : (
        <div style={{ color: 'var(--cad-text-muted)', fontStyle: 'italic' }}>
          process_memory no disponible en esta plataforma
        </div>
      )}

      <SectionTitle>Carga de proyecto (restoreDrawFeatures)</SectionTitle>
      <Row label="Última carga" value={`${projectLoad.lastMs.toFixed(1)} ms`} />
      <Row label="Features cargadas" value={String(projectLoad.lastFeatureCount)} />
      <Row label="Tamaño estimado" value={formatKB(projectLoad.lastBytes)} />

      <SectionTitle>Undo último comando (diff estructural)</SectionTitle>
      <Row label="Último tamaño" value={formatKB(undoSnap.lastBytes)} />
      <Row label="Último tiempo" value={`${undoSnap.lastMs.toFixed(1)} ms`} />
      <Row label="Snapshots totales" value={String(undoSnap.count)} />

      <SectionTitle>Worker roundtrip por tipo</SectionTitle>
      {workerStats.length === 0 ? (
        <div style={{ color: 'var(--cad-text-muted)', fontStyle: 'italic' }}>Sin requests todavía</div>
      ) : (
        workerStats.map((s) => (
          <Row
            key={s.type}
            label={s.type}
            value={`n=${s.count} · last ${s.lastMs.toFixed(0)}ms · avg ${s.avgMs.toFixed(0)}ms`}
          />
        ))
      )}

      <SectionTitle>Motor de geometría (Fase 2.7 completa)</SectionTitle>
      <Row label="Vía" value="Nativo (Rust, GEOS) — única" />
      <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.6rem', marginBottom: 4 }}>
        El motor JS (jsts/polygon-clipping) fue retirado tras validar la
        paridad con datos reales (0 mismatches / 0 fallbacks). Sin runtime
        Tauri no hay motor: la versión web quedó en el branch web-version.
      </div>

      {nativeStats.length === 0 ? (
        <div style={{ color: 'var(--cad-text-muted)', fontStyle: 'italic', fontSize: '0.6rem' }}>
          Sin operaciones nativas todavía en esta sesión
        </div>
      ) : (
        nativeStats.map((s) => (
          <div key={s.opType} style={{ marginBottom: 3 }}>
            <Row label={s.opType} value={`nativo=${s.native} fallback=${s.fallback}`} />
          </div>
        ))
      )}
<div style={{ color: 'var(--cad-text-muted)', fontSize: '0.6rem', marginBottom: 2 }}>
  subdivide / subdivideManzano / subdivideManzanoBatch / computeManzanos /
  computeRoadNetworkNet / matchFragmentsBatch. Los errores del motor nativo
  salen por consola y se propagan al comando (sin reintento JS).
</div>

     <SectionTitle>CRS afín (Fase 5 — mosaico UTM + plano local, robustecido)</SectionTitle>
<div style={{ color: 'var(--cad-text-muted)', fontSize: '0.6rem', marginBottom: 4 }}>
  UTM usa un caché en mosaico (tiles de ~1km, con refinamiento adaptativo):
  cada tile se ajusta una sola vez y queda cacheado indefinidamente — el
  "reuses" debería dominar fuertemente en cuanto se trabaja en la misma
  zona, muy por encima del caché de extent único anterior. El plano local
  sigue con un único ajuste global (no se tilea a propósito).
</div>
{affineStats.length === 0 ? (
  <div style={{ color: 'var(--cad-text-muted)', fontStyle: 'italic', fontSize: '0.6rem' }}>
    Sin cálculos afines todavía en esta sesión
  </div>
) : (
  affineStats.map((s) => (
    <div key={s.epsg} style={{ marginBottom: 4 }}>
      <Row
        label={s.epsg === LOCAL_TANGENT_PLANE_KEY ? 'Plano local (sin CRS)' : s.epsg}
        value={`refits=${s.refits} reuses=${s.reuses} degraded=${s.degraded} (${(s.reuseRatio * 100).toFixed(1)}% reuse)`}
      />
      <Row
        label="Último ajuste"
        value={`err=${s.lastMaxErrorM < 1 ? (s.lastMaxErrorM * 1000).toFixed(2) + 'mm' : s.lastMaxErrorM.toFixed(2) + 'm'} · extent=${(s.lastExtentWidthM / 1000).toFixed(1)}x${(s.lastExtentHeightM / 1000).toFixed(1)}km`}
      />
      <Row
        label="Peor error observado"
        value={`${s.worstMaxErrorM < 1 ? (s.worstMaxErrorM * 1000).toFixed(2) + 'mm' : s.worstMaxErrorM.toFixed(2) + 'm'} ${s.worstMaxErrorM < MAX_ACCEPTABLE_ERROR_M ? '✓' : '⚠'}`}
      />
      {s.epsg !== LOCAL_TANGENT_PLANE_KEY && (
        <Row label="Tiles cacheados" value={String(utmTileCache.sizeForKey(s.epsg))} />
      )}
    </div>
  ))
)}
<SectionTitle>Fase 5.4 — validación de error acumulado (afín vs. referencia exacta)</SectionTitle>
      <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.6rem', marginBottom: 4 }}>
        Compara la matriz afín contra proj4 completo (UTM) / fórmula esférica
        exacta (plano local) en CADA vértice del dataset sintético generado
        para cada tamaño — no solo la grilla 5x5 de ajuste. ✓ = por debajo de
        MAX_ACCEPTABLE_ERROR_M (1cm); "sub-mm" es informativo, no bloqueante.
      </div>
      <button
        onClick={handleRunAffineAccuracy}
        disabled={affineAccBusy}
        className="cad-icon-btn"
        style={{ width: '100%', height: 24, fontSize: '0.62rem', marginBottom: 4 }}
      >
        {affineAccBusy ? <><span className="cad-spinner" /> Corriendo…</> : '▶ Correr suite (1k/10k/100k)'}
      </button>
      {affineAccError && (
        <div style={{ color: 'var(--cad-accent-red)', fontSize: '0.6rem', marginBottom: 4 }}>{affineAccError}</div>
      )}
      {affineAccResults.map((r, i) => (
        <div key={`${r.key}-${r.datasetSize}-${i}`} style={{ marginBottom: 4 }}>
          <Row
            label={`${r.label} · ${r.datasetSize / 1000}k feat.`}
            value={`max=${(r.maxErrorM * 1000).toFixed(3)}mm ${r.withinAcceptableError ? '✓' : '⚠ EXCEDE 1cm'}${r.subMillimeter ? ' · sub-mm' : ''}`}
          />
          <Row
            label="avg / p95 / p99"
            value={`${(r.avgErrorM * 1000).toFixed(3)} / ${(r.p95ErrorM * 1000).toFixed(3)} / ${(r.p99ErrorM * 1000).toFixed(3)} mm`}
          />
          <Row
            label="vértices · extent"
            value={`${r.vertexCount} · ${r.extentWidthKm.toFixed(1)}x${r.extentHeightKm.toFixed(1)}km · ${r.elapsedMs.toFixed(0)}ms`}
          />
        </div>
      ))}

      <SectionTitle>Dataset sintético (manzanos + lotes)</SectionTitle>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {SYNTHETIC_SIZES.map((size) => (
          <button
            key={size}
            onClick={() => handleGenerateSynthetic(size)}
            disabled={genBusy != null}
            className="cad-icon-btn"
            style={{
              flex: 1,
              width: 'auto',
              height: 'auto',
              padding: '4px 0',
              fontSize: '0.6rem',
              color:
                size === 1_000_000
                  ? 'var(--cad-accent-amber)'
                  : genBusy === size
                    ? 'var(--cad-accent)'
                    : undefined,
              opacity: genBusy != null && genBusy !== size ? 0.4 : 1,
            }}
          >
            {genBusy === size ? <span className="cad-spinner" /> : `${size / 1000}k`}
          </button>
        ))}
      </div>
      <div style={{ color: 'var(--cad-accent-amber)', fontSize: '0.6rem', marginBottom: 4 }}>
        ⚠ 1M: riesgo real de OOM/thrash — heap JS al ~70% del límite con
        500k (corrida Fase 3.4). Usar 1M solo en máquinas con &gt;8GB.
      </div>
      {lastGen && (
        <>
          <Row label="Última gen." value={`${lastGen.manzanoCount} manzanos · ${lastGen.lotCount} lotes`} />
          <Row label="Tiempo generación" value={`${lastGen.generateMs.toFixed(0)} ms`} />
          <Row label="Tiempo carga" value={`${lastGen.loadMs.toFixed(0)} ms`} />
        </>
      )}

      <SectionTitle>Benchmark Fase 3.4 — undo de un trazo vs. proyecto entero</SectionTitle>
      <button
        onClick={handleRunBenchmark}
        disabled={benchBusy}
        className="cad-icon-btn"
        style={{ width: '100%', height: 24, fontSize: '0.62rem', marginBottom: 4 }}
      >
        {benchBusy ? <><span className="cad-spinner" /> Corriendo…</> : '▶ Correr suite (10k/100k/500k)'}
      </button>
      {benchError && (
        <div style={{ color: 'var(--cad-accent-red)', fontSize: '0.6rem', marginBottom: 4 }}>{benchError}</div>
      )}
      {benchResults.map((r) => (
        <Row
          key={r.datasetSize}
          label={`${r.datasetSize / 1000}k features`}
          value={`undo=${formatKB(r.undoDiffBytes)} · baseline=${formatKB(r.fullSnapshotBaselineBytes)} · ratio=${(r.ratio * 100).toFixed(2)}% · ${r.executeMs.toFixed(0)}ms`}
        />
      ))}

      <SectionTitle>Benchmark Fase 4.1/4.2 — rstar nativo vs RBush JS</SectionTitle>
      <button
        onClick={handleRunSpatialBenchmark}
        disabled={spatialBusy}
        className="cad-icon-btn"
        style={{ width: '100%', height: 24, fontSize: '0.62rem', marginBottom: 4 }}
      >
        {spatialBusy ? <><span className="cad-spinner" /> Corriendo…</> : '▶ Correr suite (10k/100k/500k)'}
      </button>
      {spatialError && (
        <div style={{ color: 'var(--cad-accent-red)', fontSize: '0.6rem', marginBottom: 4 }}>{spatialError}</div>
      )}
      {spatialResults.map((r) => (
        <div key={r.datasetSize} style={{ marginBottom: 4 }}>
          <Row
            label={`${r.datasetSize / 1000}k load JS/nat`}
            value={`${r.jsLoadMs.toFixed(1)} / ${r.nativeLoadMs.toFixed(1)} ms`}
          />
          <Row
            label={`query JS/nat (${r.queryRounds}r)`}
            value={`${r.jsQueryAvgMs.toFixed(2)} / ${r.nativeQueryAvgMs.toFixed(2)} ms`}
          />
          <Row
            label="rstar interno (sin IPC)"
            value={`${r.nativeSearchAvgMs.toFixed(3)} ms`}
          />
          <Row
            label={`hits JS/nat`}
            value={`${r.jsHitCount} / ${r.nativeHitCount} ${r.parityOk ? '· paridad ✓' : '· ⚠ PARIDAD FALLA'}`}
          />
        </div>
      ))}

      {/* ═══ INSERTAR DESDE ACÁ ═══ */}
      <SectionTitle>Fase 6.1 — Dataset urbano avanzado (calles + rotondas + manzanos irregulares)</SectionTitle>
      <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.6rem', marginBottom: 4 }}>
        A diferencia del dataset de arriba (lotes rectangulares
        precomputados como GeoJSON), esto genera CALLES con ancho
        variable + AVENIDAS diagonales + ROTONDAS mixtas + un perímetro
        irregular, y corre el pipeline REAL completo: recomputeManzanos
        → GEOS union/difference (Fase 2.3) → reconciliación de
        fragmentos vía una pasada incremental (Fase 2.4) →
        subdivideManzanoBatch sobre manzanos de geometría irregular real
        (Fase 2.2). "0 degenerados" en la subdivisión es el criterio de
        éxito — cualquier lote con área ≤0 o punto no-finito es una
        regresión.
      </div>
      <button
        onClick={handleRunUrbanBenchmark}
        disabled={urbanBusy}
        className="cad-icon-btn"
        style={{ width: '100%', height: 24, fontSize: '0.62rem', marginBottom: 4 }}
      >
        {urbanBusy ? <><span className="cad-spinner" /> Corriendo…</> : '▶ Correr suite (25/100/400 manzanos)'}
      </button>
      {urbanError && (
        <div style={{ color: 'var(--cad-accent-red)', fontSize: '0.6rem', marginBottom: 4 }}>{urbanError}</div>
      )}
      {urbanResults.map((r, i) => (
        <div key={i} style={{ marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--cad-border)' }}>
          <Row
            label={`Grilla ${r.layout.gridCols}x${r.layout.gridRows}`}
            value={`${r.layout.streets.length} calles · ${r.layout.roundabouts.length} rotondas`}
          />
          <Row
            label="Carga + recompute inicial"
            value={`${r.loadMs.toFixed(0)}ms + ${r.initialRecomputeMs.toFixed(0)}ms`}
          />
          <Row
            label="Manzanos generados"
            value={`${r.manzanoCount} (${r.manzanoAreaStats.min.toFixed(0)}-${r.manzanoAreaStats.max.toFixed(0)} m²)`}
          />
          <Row
            label="Vértices/manzano (min/avg/max)"
            value={`${r.fragmentCountsByVertex.minVertices}/${r.fragmentCountsByVertex.avgVertices.toFixed(1)}/${r.fragmentCountsByVertex.maxVertices}`}
          />
          {r.incrementalPass && (
            <>
              <Row
                label="Pasada incremental (Fase 2.4)"
                value={`${r.incrementalPass.recomputeMs.toFixed(0)}ms · +${r.incrementalPass.diffAddedCount}/-${r.incrementalPass.diffRemovedCount}/~${r.incrementalPass.diffModifiedCount}`}
              />
              <Row
                label="Manzanos tras pasada incremental"
                value={`${r.incrementalPass.manzanoCountAfter}`}
              />
              {!r.incrementalPass.consistency.ok && (
                <div style={{ color: 'var(--cad-accent-red)', fontSize: '0.6rem', marginTop: 2 }}>
                  ⚠ Consistencia del diff FALLÓ: {r.incrementalPass.consistency.changedGeometryAbsentFromDiff.length} cambios de geometría ausentes del diff ·{' '}
                  {r.incrementalPass.consistency.untouchedButTouched.length} manzanos fuera del corredor tocados
                </div>
              )}
            </>
          )}
          {r.subdivisionStress && (
            <Row
              label="Subdivisión (Fase 2.2)"
              value={`${r.subdivisionStress.totalLots} lotes en ${r.subdivisionStress.elapsedMs.toFixed(0)}ms${
                r.subdivisionStress.degenerateLots > 0
                  ? ` · ⚠ ${r.subdivisionStress.degenerateLots} degenerados`
                  : ' · 0 degenerados ✓'
              }`}
            />
          )}
        </div>
      ))}
      {/* ═══ HASTA ACÁ ═══ */}

      <SectionTitle>Fase 6.4 — Carga concurrente (comandos en paralelo vs. UI)</SectionTitle>
      <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.6rem', marginBottom: 4 }}>
        Correla los comandos nativos en paralelo (subdivisión batch ∥ red
        vial ∥ reconciliación) midiendo la degradación del event loop de la
        UI: speedup &gt;1 = el runtime async de Tauri realmente paraleliza;
        stall ~1x = la interacción no percibe la carga. Criterio de éxito:
        lotes degenerados = 0 en todas las escalas.
      </div>
      <button
        onClick={handleRunConcurrencyStress}
        disabled={concurrencyBusy}
        className="cad-icon-btn"
        style={{ width: '100%', height: 24, fontSize: '0.62rem', marginBottom: 4 }}
      >
        {concurrencyBusy ? <><span className="cad-spinner" /> Corriendo…</> : '▶ Correr suite (32/64/128 manzanos)'}
      </button>
      {concurrencyError && (
        <div style={{ color: 'var(--cad-accent-red)', fontSize: '0.6rem', marginBottom: 4 }}>
          {concurrencyError}
        </div>
      )}
      {concurrencyResults.map((r, i) => (
        <div key={i} style={{ marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--cad-border)' }}>
          <Row
            label={`${r.ringCount} manzanos · ${r.lotTotal} lotes`}
            value={`${r.elapsedMs.toFixed(0)}ms · ${r.degenerateLots > 0 ? `⚠ ${r.degenerateLots} degenerados` : '0 degenerados ✓'}`}
          />
          <Row
            label="serial vs. paralela"
            value={`${r.serialElapsedMs.toFixed(0)}ms vs ${r.parallelElapsedMs.toFixed(0)}ms · speedup ${r.parallelSpeedup.toFixed(2)}x`}
          />
          <Row
            label="Stall event loop (reposo → carga)"
            value={`${r.idleStallMaxMs.toFixed(1)}ms → ${r.parallelStallMaxMs.toFixed(1)}ms (${r.stallDegradationRatio.toFixed(1)}x)`}
          />
          {r.phases.map((p) => (
            <Row
              key={p.phase}
              label={p.phase}
              value={`${p.elapsedMs.toFixed(0)}ms · avg ${p.avgMs.toFixed(0)}ms · max ${p.maxMs.toFixed(0)}ms`}
            />
          ))}
        </div>
      ))}
      {/* ═══ FIN Fase 6.4 ═══ */}

      {geoTelemetry && Object.values(geoTelemetry.countsByContext).some((n) => n > 0) && (
        <>
          <SectionTitle>Saneo de geometría (últimos 60s)</SectionTitle>
          {Object.entries(geoTelemetry.countsByContext)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([ctx, n]) => (
              <Row key={ctx} label={ctx} value={String(n)} />
            ))}
        </>
      )}
        </>
      )}

      <div style={{ marginTop: 6, fontSize: '0.6rem', color: 'var(--cad-text-muted)' }}>
        Ctrl+Shift+D para alternar
      </div>
    </div>
  );
}