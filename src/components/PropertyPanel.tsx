import React from 'react';
import { useSelectionStore } from '../store/selectionStore';
import { useMapStore } from '../store/mapStore';
import { useSubdivisionStore } from '../store/subdivisionStore';
import { formatMetricArea, formatMetricLength, type SegmentMetric } from '../geo/metrics';

/* ================================================================
   PROPERTY PANEL
   ================================================================
   Panel lateral derecho con:
   - Metricas del feature primario seleccionado
   - Lista de lados / segmentos con su longitud
   - Acciones rapidas: Subdividir, Fusionar con otro, Eliminar
   ================================================================ */

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 240, // a la izquierda del LayerPanel
  zIndex: 100,
  width: 240,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.6rem',
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--cad-text-muted)',
  marginBottom: 6,
  display: 'block',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '4px 0',
  fontSize: '0.7rem',
  color: 'var(--cad-text-dim)',
};

const valueStyle: React.CSSProperties = {
  color: 'var(--cad-accent)',
  fontFamily: 'JetBrains Mono, monospace',
  fontWeight: 500,
};

export default function PropertyPanel() {
  const primaryId = useSelectionStore((s) => s.primaryId);
  const selectedCount = useSelectionStore((s) => s.selectedIds.size);
  const drawSource = useMapStore((s) => s.drawSource);
  const openSubdivision = useSubdivisionStore((s) => s.open);

  if (!primaryId || !drawSource) {
    return (
      <div style={panelStyle} className="cad-panel-glass animate-fade-in">
        <div style={{ padding: '10px 12px' }}>
          <span style={sectionTitleStyle}>Propiedades</span>
          <p style={{ fontSize: '0.7rem', color: 'var(--cad-text-muted)' }}>
            Selecciona un polígono para ver sus propiedades.
          </p>
        </div>
      </div>
    );
  }

  const feat = drawSource.getFeatureById(primaryId) as any;
  if (!feat) return null;

  const areaM2 = feat.get('areaM2') as number | undefined;
  const perimeterM = feat.get('perimeterM') as number | undefined;
  const lengthM = feat.get('lengthM') as number | undefined;
  const segmentLengths = (feat.get('segmentLengths') as SegmentMetric[] | undefined) ?? [];
  const method = feat.get('method') as string | undefined;
  const label = feat.get('label') as string | undefined;
  const mergedAt = feat.get('mergedAt') as string | undefined;

  const isPolygon = areaM2 !== undefined;

  return (
    <div style={panelStyle} className="cad-panel-glass animate-fade-in">
      <div style={{ padding: '10px 12px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
            paddingBottom: 8,
            borderBottom: '1px solid var(--cad-border)',
          }}
        >
          <span style={sectionTitleStyle}>Propiedades</span>
          <span
            style={{
              fontSize: '0.55rem',
              color: 'var(--cad-text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {selectedCount > 1 ? `+${selectedCount - 1} más` : ''}
          </span>
        </div>

        {label && (
          <p style={{ fontSize: '0.75rem', color: 'var(--cad-text)', marginBottom: 8 }}>
            {label}
          </p>
        )}

        {isPolygon ? (
          <>
            <div style={rowStyle}>
              <span>Área</span>
              <span style={valueStyle}>{formatMetricArea(areaM2)}</span>
            </div>
            <div style={rowStyle}>
              <span>Perímetro</span>
              <span style={valueStyle}>{formatMetricLength(perimeterM)}</span>
            </div>
          </>
        ) : (
          <div style={rowStyle}>
            <span>Longitud</span>
            <span style={valueStyle}>{formatMetricLength(lengthM)}</span>
          </div>
        )}

        {method && (
          <div style={rowStyle}>
            <span>Origen</span>
            <span style={{ color: 'var(--cad-text-muted)' }}>{method}</span>
          </div>
        )}
        {mergedAt && (
          <div style={rowStyle}>
            <span>Fusionado</span>
            <span style={{ color: 'var(--cad-text-muted)', fontSize: '0.6rem' }}>
              {new Date(mergedAt).toLocaleString()}
            </span>
          </div>
        )}

        {/* Segmentos / lados */}
        {segmentLengths.length > 0 && (
          <>
            <span
              style={{ ...sectionTitleStyle, marginTop: 12 }}
            >
              Lados ({segmentLengths.length})
            </span>
            <div style={{ maxHeight: 140, overflowY: 'auto' }}>
              {segmentLengths.map((seg, i) => (
                <div key={i} style={rowStyle}>
                  <span>Lado {i + 1}</span>
                  <span style={valueStyle}>{formatMetricLength(seg.lengthM)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Acciones rapidas */}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {isPolygon && (
            <button
              onClick={() => openSubdivision(primaryId)}
              className="cad-icon-btn"
              style={{
                width: '100%',
                height: 'auto',
                padding: '6px 10px',
                fontSize: '0.7rem',
                fontWeight: 500,
                background: 'var(--cad-bg-surface)',
                border: '1px solid var(--cad-border)',
                color: 'var(--cad-text-dim)',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              Subdividir este polígono
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
