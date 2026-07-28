import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSelectionStore } from '../../store/map/selectionStore';
import { useMapStore } from '../../store/map/mapStore';
import { useSubdivisionStore } from '../../store/ui/subdivisionStore';
import { useDrawStore } from '../../store/map/drawStore';
import { useUiShellStore } from '../../store/ui/uiShellStore';
import { formatMetricArea, formatMetricLength, type SegmentMetric } from '../../geo/metrics';
import { useManzanoStore } from '../../store/entities/manzanoStore';
import { getFeatureKind } from '../../core/objectModel';

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  zIndex: 100,
  width: 240,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 10,
  paddingBottom: 8,
  borderBottom: '1px solid var(--cad-border)',
  cursor: 'grab',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

export default function PropertyPanel() {
  const drawMode = useDrawStore((s) => s.mode);
  const propertiesVisible = useUiShellStore((s) => s.panelVisibility.properties);
  const primaryId = useSelectionStore((s) => s.primaryId);
  const selectedCount = useSelectionStore((s) => s.selectedIds.size);
  const drawSource = useMapStore((s) => s.drawSource);
  const openSubdivision = useSubdivisionStore((s) => s.open);

  const [position, setPosition] = useState({ top: 10, right: 10 });
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, startTop: 0, startRight: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startTop: position.top,
      startRight: position.right,
    };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    e.stopPropagation();
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current.isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const newTop = dragRef.current.startTop + dy;
    const newRight = dragRef.current.startRight - dx;
    // Keep within viewport bounds
    const maxTop = window.innerHeight - 150;
    const maxRight = window.innerWidth - 260;
    setPosition({
      top: Math.max(10, Math.min(maxTop, newTop)),
      right: Math.max(10, Math.min(maxRight, newRight)),
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.isDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Solo mostrar en modo select o edit, y si el panel está habilitado
  if (drawMode !== 'select' && drawMode !== 'edit') return null;
  if (!propertiesVisible) return null;

  if (!primaryId || !drawSource) {
    return (
      <div style={{ ...panelStyle, top: position.top, right: position.right }} className="cad-panel-glass animate-fade-in">
        <div style={{ padding: '10px 12px' }}>
          <div style={headerStyle} onMouseDown={handleMouseDown}>
            <span className="cad-section-title">Propiedades</span>
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--cad-text-muted)' }}>
            Selecciona un polígono para ver sus propiedades.
          </p>
        </div>
      </div>
    );
  }

  const feat = drawSource.getFeatureById(primaryId) as any;
  if (!feat) return null;

  const featureKind = getFeatureKind(feat);
  const areaM2 = feat.get('areaM2') as number | undefined;
  const perimeterM = feat.get('perimeterM') as number | undefined;
  const lengthM = feat.get('lengthM') as number | undefined;
  const segmentLengths = (feat.get('segmentLengths') as SegmentMetric[] | undefined) ?? [];
  const method = feat.get('method') as string | undefined;
  const label = feat.get('label') as string | undefined;
  const mergedAt = feat.get('mergedAt') as string | undefined;

  const isPolygon = areaM2 !== undefined;

  return (
    <div style={{ ...panelStyle, top: position.top, right: position.right }} className="cad-panel-glass animate-fade-in">
      <div style={{ padding: '10px 12px' }}>
        <div style={headerStyle} onMouseDown={handleMouseDown}>
          <span className="cad-section-title">Propiedades</span>
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
            <div className="cad-row">
              <span>Área</span>
              <span className="cad-row-value">{formatMetricArea(areaM2)}</span>
            </div>
            <div className="cad-row">
              <span>Perímetro</span>
              <span className="cad-row-value">{formatMetricLength(perimeterM)}</span>
            </div>
          </>
        ) : (
          <div className="cad-row">
            <span>Longitud</span>
            <span className="cad-row-value">{formatMetricLength(lengthM)}</span>
          </div>
        )}

        {method && (
          <div className="cad-row">
            <span>Origen</span>
            <span style={{ color: 'var(--cad-text-muted)' }}>{method}</span>
          </div>
        )}
        {mergedAt && (
          <div className="cad-row">
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
              className="cad-section-title" style={{ marginTop: 12 }}
            >
              Lados ({segmentLengths.length})
            </span>
            <div style={{ maxHeight: 140, overflowY: 'auto' }}>
              {segmentLengths.map((seg, i) => (
                <div key={i} className="cad-row">
                  <span>Lado {i + 1}</span>
                  <span className="cad-row-value">{formatMetricLength(seg.lengthM)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Acciones rapidas */}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {isPolygon && featureKind === 'perimetro' && (
            <p style={{ fontSize: '0.65rem', color: 'var(--cad-text-muted)', fontStyle: 'italic' }}>
              Este es el perímetro del sitio (referencia intacta). Trazá calles para generar manzanos.
            </p>
          )}
          {isPolygon && featureKind !== 'perimetro' && (
            <button
              onClick={() => {
                if (featureKind === 'manzana') {
                  const { targetAreaM2, frontMinM } = useManzanoStore.getState();
                  openSubdivision(primaryId, 'auto', { targetAreaM2, frontMinM });
                } else {
                  openSubdivision(primaryId);
                }
              }}
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
