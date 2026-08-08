import React, { useMemo } from 'react';
import { useMapStore } from '../../store/map/mapStore';
import { useStreetStore } from '../../store/entities/streetStore';
import { useUiShellStore } from '../../store/ui/uiShellStore';
import { useDrawSourceTick } from '../../hooks/useDrawSourceTick';
import { useDraggablePanel } from '../../hooks/useDraggablePanel';
import { polyArea, type Pt } from '../../geo/math/polygonEngine';
import { formatMetricArea, streetLengthMetricM } from '../../geo/metrics';
import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import type VectorSource from 'ol/source/Vector.js';
import { getFeatureKind, getLotStatus } from '../../core/objectModel';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { Street } from '../../store/entities/streetStore';

interface ManzanoInfo {
  index: number;
  areaM2: number;
  color: string;
  isManzana: boolean;
  vertexCount: number;
}

interface StatsData {
  totalAreaM2: number;
  manzanoCount: number;
  manzanoAreaM2: number;
  lotCount: number;
  lotAreaM2: number;
  streetCount: number;
  streetAreaM2: number;
  manzanos: ManzanoInfo[];
}

function computeStats(drawSource: VectorSource<Feature<Geometry>> | null, streets: Street[], manzColor: string): StatsData {
  const result: StatsData = {
    totalAreaM2: 0,
    manzanoCount: 0,
    manzanoAreaM2: 0,
    lotCount: 0,
    lotAreaM2: 0,
    streetCount: streets.length,
    streetAreaM2: 0,
    manzanos: [],
  };

  if (!drawSource) return result;

  // Área total de todos los polígonos
  let mznIdx = 0;
  drawSource.forEachFeature((f: Feature<Geometry>) => {
    const geom = f.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;
    const kind = getFeatureKind(f);
    if (kind === 'perimetro') return; // referencia intacta — no forma parte de las métricas operativas

    const isManzana = kind === 'manzana';
    if (isManzana && getLotStatus(f) === 'subdivided') return;

    const coords = (geom as Polygon).getCoordinates();
    if (!coords[0] || coords[0].length < 4) return;
    const pts: Pt[] = coords[0].map((c: number[]) => [c[0], c[1]]);
    const area = (f.get('areaM2') as number | undefined) ?? polyArea(pts);

    result.totalAreaM2 += area;

    const isLot = kind === 'lote';

    if (isManzana) {
      result.manzanoCount++;
      result.manzanoAreaM2 += area;
      result.manzanos.push({
        index: mznIdx,
        areaM2: area,
        color: manzColor,
        isManzana: true,
        vertexCount: coords[0].length - 1,
      });
      mznIdx++;
    } else if (isLot) {
      result.lotCount++;
      result.lotAreaM2 += area;
    }
  });

  for (const s of streets) {
    const lenM = streetLengthMetricM(s);
    result.streetAreaM2 += lenM * s.widthM;
  }

  return result;
}

export default function StatsPanel() {
  const drawSource = useMapStore((s) => s.drawSource);
  const streets = useStreetStore((s) => s.streets);
  const manzanoColor = useLayersStore((s) => s.getLayerForKind('manzana')?.color ?? '#f59e0b');
  const visible = useUiShellStore((s) => s.statsPanelVisible);
  const setStatsPanelVisible = useUiShellStore((s) => s.setStatsPanelVisible);

  const { position: pos, onDragHandleMouseDown } = useDraggablePanel({
    initial: { top: Math.max(0, window.innerHeight - 350), left: Math.max(0, window.innerWidth - 250) },
  });

  const tick = useDrawSourceTick(drawSource);

  const stats = useMemo(() => computeStats(drawSource, streets, manzanoColor),
  [drawSource, streets, tick, manzanoColor]);

  if (!visible) return null;
  if (stats.totalAreaM2 === 0 && stats.streetCount === 0) return null;

  const pctLots = stats.totalAreaM2 > 0 ? (stats.lotAreaM2 / stats.totalAreaM2) * 100 : 0;
  const pctMzn = stats.totalAreaM2 > 0 ? (stats.manzanoAreaM2 / stats.totalAreaM2) * 100 : 0;
  const pctVia = stats.totalAreaM2 > 0 ? (stats.streetAreaM2 / stats.totalAreaM2) * 100 : 0;

  return (
    <div
      className="cad-panel-glass"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 'var(--z-stats)',
        padding: '10px 14px',
        minWidth: 220,
        maxWidth: 300,
        fontSize: '0.72rem',
        cursor: 'default',
      }}
    >
      {/* Header */}
      <div
        onMouseDown={onDragHandleMouseDown}
        style={{
          fontWeight: 700,
          color: 'var(--cad-text)',
          marginBottom: 8,
          fontSize: '0.78rem',
          letterSpacing: '0.03em',
          borderBottom: '1px solid var(--cad-border)',
          paddingBottom: 6,
          cursor: 'grab',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
        }}
      >
        <span>Estadísticas del proyecto</span>
        <button
          onClick={() => setStatsPanelVisible(false)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--cad-text-dim)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            lineHeight: 1,
            padding: '0 2px',
          }}
          title="Cerrar"
        >
          ✕
        </button>
      </div>

      {/* Tabla de estadísticas */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '3px 10px', marginBottom: 8 }}>
        <span style={{ color: 'var(--cad-text-dim)' }}>Área total:</span>
        <span style={{ color: '#3fb950', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>{formatMetricArea(stats.totalAreaM2)}</span>
        <span />

        {stats.manzanoCount > 0 && (
          <>
            <span style={{ color: 'var(--cad-text-dim)' }}>Manzanos:</span>
            <span style={{ color: '#58a6ff', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>{stats.manzanoCount}</span>
            <span style={{ color: 'var(--cad-text-muted)', fontSize: '0.65rem' }}>{formatMetricArea(stats.manzanoAreaM2)}</span>
          </>
        )}

        {stats.lotCount > 0 && (
          <>
            <span style={{ color: 'var(--cad-text-dim)' }}>Lotes:</span>
            <span style={{ color: '#10b981', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>{stats.lotCount}</span>
            <span style={{ color: 'var(--cad-text-muted)', fontSize: '0.65rem' }}>{formatMetricArea(stats.lotAreaM2)}</span>
          </>
        )}

        {stats.streetCount > 0 && (
          <>
            <span style={{ color: 'var(--cad-text-dim)' }}>Calles:</span>
            <span style={{ color: '#ffa657', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>{stats.streetCount}</span>
            <span style={{ color: 'var(--cad-text-muted)', fontSize: '0.65rem' }}>{formatMetricArea(stats.streetAreaM2)}</span>
          </>
        )}
      </div>

      {/* Barra apilada (stacked bar) */}
      {stats.totalAreaM2 > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{
            display: 'flex',
            height: 8,
            borderRadius: 4,
            overflow: 'hidden',
            background: 'var(--cad-bg-deepest)',
          }}>
            {pctLots > 0 && (
              <div style={{ width: `${pctLots}%`, background: '#10b981' }} title={`Lotes: ${pctLots.toFixed(1)}%`} />
            )}
            {pctMzn > 0 && (
              <div style={{ width: `${pctMzn}%`, background: '#58a6ff' }} title={`Manzanos: ${pctMzn.toFixed(1)}%`} />
            )}
            {pctVia > 0 && (
              <div style={{ width: `${Math.min(pctVia, 100)}%`, background: '#ffa657' }} title={`Vía: ${pctVia.toFixed(1)}%`} />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: '0.6rem', color: 'var(--cad-text-muted)' }}>
            <span>Lotes {pctLots.toFixed(0)}%</span>
            <span>Mzn {pctMzn.toFixed(0)}%</span>
            <span>Vía {pctVia.toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Lista de manzanos con colores */}
      {stats.manzanos.length > 0 && (
        <div style={{ marginTop: 6, borderTop: '1px solid var(--cad-border)', paddingTop: 6 }}>
          {stats.manzanos.map((m) => (
            <div key={m.index} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 0',
              fontSize: '0.68rem',
            }}>
              <div style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: m.color,
                flexShrink: 0,
              }} />
              <span style={{ color: 'var(--cad-text-dim)' }}>Mzo. {m.index + 1}</span>
              <span style={{ color: 'var(--cad-text-muted)', marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem' }}>
                {formatMetricArea(m.areaM2)}
              </span>
              <span style={{ color: 'var(--cad-text-muted)', fontSize: '0.58rem' }}>
                {m.vertexCount} vért.
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
