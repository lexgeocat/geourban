import React, { useEffect, useRef, useState } from 'react';
import { useDebugPanelStore } from '../../store/debug/debugPanelStore';
import { useMapStore } from '../../store/map/mapStore';
import { readDebugCounters } from '../../store/debug/debugCounters';
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
  const { fps, fpsAvg } = useFps(open);
  const [counters, setCounters] = useState<DebugCountersSnapshot | null>(null);
  const [featureCount, setFeatureCount] = useState(0);
  const [geoTelemetry, setGeoTelemetry] = useState<ReturnType<typeof readGeometryTelemetry> | null>(null);
  const [workerStats, setWorkerStats] = useState<WorkerStatSnapshot[]>([]);
  const [undoSnap, setUndoSnap] = useState(readUndoCommandStats());
  const [projectLoad, setProjectLoad] = useState(readProjectLoadStats());
  const [heap, setHeap] = useState(readHeapSnapshot());
  const [nativeStats, setNativeStats] = useState<NativeEngineStatsSnapshot[]>([]);

  const [genBusy, setGenBusy] = useState<number | null>(null);
  const [lastGen, setLastGen] = useState<{ size: number; generateMs: number; loadMs: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const tick = () => {
      setCounters(readDebugCounters());
      setGeoTelemetry(readGeometryTelemetry());
      setWorkerStats(readWorkerStats());
      setUndoSnap(readUndoCommandStats());
      setProjectLoad(readProjectLoadStats());
      setHeap(readHeapSnapshot());
      setNativeStats(readNativeEngineStats());
      const src = useMapStore.getState().drawSource;
      setFeatureCount(src ? src.getFeatures().length : 0);
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, [open]);

  const handleGenerateSynthetic = (size: number) => {
    if (genBusy != null) return;
    setGenBusy(size);

    setTimeout(() => {
      try {
        ensureSyntheticLotLayer();
        // Fase 3.4 — centra la grilla sintética en el centro de vista
        // actual (unidades internas del proyecto, no lon/lat) en vez de
        // partir siempre desde el origen absoluto: con 100k+ features el
        // lado de la grilla mide varios km y, sin esto, quedaba lejos del
        // viewport dando la falsa impresión de que "no generó nada" —
        // parte del mismo bug de proyección que rompía el fit.
        const view = useMapStore.getState().mapInstance?.getView();
        const center = (view?.getCenter() as [number, number] | undefined) ?? [0, 0];
        const { collection, generateMs } = generateSyntheticLots(size, center);
        useMapStore.getState().restoreDrawFeatures(collection);
        useMapStore.getState().fitToExtent();
        const load = readProjectLoadStats();
        setLastGen({ size, generateMs, loadMs: load.lastMs });
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
        <button
          onClick={() => setOpen(false)}
          style={{ background: 'none', border: 'none', color: 'var(--cad-text-dim)', cursor: 'pointer' }}
          aria-label="Cerrar panel de debug"
        >
          ✕
        </button>
      </div>

      <Row label="FPS" value={fps.toFixed(0)} />
      <Row label="FPS avg" value={fpsAvg.toFixed(1)} />
      <Row label="WebGL layers" value={String(counters?.webglLayerCount ?? 0)} />
      <Row label="Features" value={String(featureCount)} />
      <Row label="Postrender last" value={`${(counters?.postrenderLastMs ?? 0).toFixed(2)} ms`} />
      <Row label="Postrender avg" value={`${(counters?.postrenderAvgMs ?? 0).toFixed(2)} ms`} />
      <Row label="setStyle/min" value={String(counters?.setStyleCallsPerMin ?? 0)} />
      <Row label="syncLayerSet/min" value={String(counters?.syncLayerSetCallsPerMin ?? 0)} />
      <Row label="syncGizmo/min" value={String(counters?.syncGizmoCallsPerMin ?? 0)} />

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

      <SectionTitle>Dataset sintético (Fase 0)</SectionTitle>
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
              color: genBusy === size ? 'var(--cad-accent)' : undefined,
              opacity: genBusy != null && genBusy !== size ? 0.4 : 1,
            }}
          >
            {genBusy === size ? <span className="cad-spinner" /> : `${size / 1000}k`}
          </button>
        ))}
      </div>
      {lastGen && (
        <>
          <Row label="Última gen." value={`${lastGen.size / 1000}k lotes`} />
          <Row label="Tiempo generación" value={`${lastGen.generateMs.toFixed(0)} ms`} />
          <Row label="Tiempo carga" value={`${lastGen.loadMs.toFixed(0)} ms`} />
        </>
      )}

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

      <div style={{ marginTop: 6, fontSize: '0.6rem', color: 'var(--cad-text-muted)' }}>
        Ctrl+Shift+D para alternar
      </div>
    </div>
  );
}