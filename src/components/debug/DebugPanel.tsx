import React, { useEffect, useRef, useState } from 'react';
import { useDebugPanelStore } from '../../store/debug/debugPanelStore';
import { useMapStore } from '../../store/map/mapStore';
import { readDebugCounters } from '../../store/debug/debugCounters';
import type { DebugCountersSnapshot } from '../../store/debug/debugCounters';
import { readGeometryTelemetry } from '../../store/debug/geometryTelemetry';

const REFRESH_MS = 400;

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

export default function DebugPanel() {
  const open = useDebugPanelStore((s) => s.open);
  const setOpen = useDebugPanelStore((s) => s.setOpen);
  const { fps, fpsAvg } = useFps(open);
  const [counters, setCounters] = useState<DebugCountersSnapshot | null>(null);
  const [featureCount, setFeatureCount] = useState(0);
  const [geoTelemetry, setGeoTelemetry] = useState<ReturnType<typeof readGeometryTelemetry> | null>(null);

  useEffect(() => {
    if (!open) return;
    const tick = () => {
      setCounters(readDebugCounters());
      setGeoTelemetry(readGeometryTelemetry());
      const src = useMapStore.getState().drawSource;
      setFeatureCount(src ? src.getFeatures().length : 0);
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, [open]);

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
        minWidth: 210,
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
      {geoTelemetry && Object.values(geoTelemetry.countsByContext).some((n) => n > 0) && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--cad-border)' }}>
          <div style={{ color: 'var(--cad-accent-amber)', fontWeight: 700, marginBottom: 3 }}>
            Saneo de geometría (últimos 60s)
          </div>
          {Object.entries(geoTelemetry.countsByContext)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([ctx, n]) => (
              <Row key={ctx} label={ctx} value={String(n)} />
            ))}
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: '0.6rem', color: 'var(--cad-text-muted)' }}>
        Ctrl+Shift+D para alternar
      </div>
    </div>
  );
}