import React from 'react';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { useMapStore } from '@map-core/store/mapStore';
import { useDrawStore } from '@map-core/store/drawStore';
import { useUiShellStore } from '@app-shell/store/uiShellStore';
import { formatMetricArea, formatMetricLength, type SegmentMetric } from '@georef-engine/metrics';
import { getFeatureKind } from '@kernel/domain-model/featureModel';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { useDraggablePanel } from '@shared-ui/hooks/useDraggablePanel';
import { useLotsWorkflow } from '@lotificacion-engine/hooks/useLotsWorkflow';
import { useLabelConfigModalStore } from '@label-engine/store/labelConfigModalStore';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { defaultLabelStyleConfig, defaultColorForKind, type LabelStyleConfig } from '@label-engine/model/labelModel';

const basePanelStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 'var(--z-floating-panel)',
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
  const { focusManzanoInSidebar } = useLotsWorkflow();
  const streets = useStreetStore((s) => s.streets);
  const roundabouts = useRoundaboutStore((s) => s.roundabouts);
  const openLabelModal = useLabelConfigModalStore((s) => s.openForFeature);
  const entityLabels = useEntityLabelStore((s) => s.byId);
  const openEntityLabel = useLabelConfigModalStore((s) => s.openForEntity);

  const { position, onDragHandleMouseDown: handleMouseDown } = useDraggablePanel({
    initial: { top: 10, left: Math.max(8, window.innerWidth - 260) },
  });
  if (drawMode !== 'select' && drawMode !== 'edit') return null;
  if (!propertiesVisible) return null;

  const panelStyle: React.CSSProperties = { ...basePanelStyle, top: position.top, left: position.left };

  if (!primaryId || !drawSource) {
    return (
      <div style={panelStyle} className="cad-panel-glass animate-fade-in">
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

  const feat = (drawSource.getFeatureById(primaryId) as Feature<Geometry> | null) ?? null;

  if (!feat) {
    const street = streets.find((s) => s.id === primaryId);
    if (street) {
      return (
        <div style={panelStyle} className="cad-panel-glass animate-fade-in">
          <div style={{ padding: '10px 12px' }}>
            <div style={headerStyle} onMouseDown={handleMouseDown}>
              <span className="cad-section-title">Propiedades</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--cad-text)', marginBottom: 8 }}>{street.name}</p>
            <div className="cad-row"><span>Calzada</span><span className="cad-row-value">{formatMetricLength(street.widthM)}</span></div>
            <div className="cad-row"><span>Vereda</span><span className="cad-row-value">{formatMetricLength(street.sideWidthM)}</span></div>
            <button
              onClick={() => {
                const existing = entityLabels[street.id];
                openEntityLabel(
                  'street',
                  street.id,
                  existing?.config ??
                    defaultLabelStyleConfig({ prefix: 'Calle', color: defaultColorForKind('calle') }),
                  existing?.text ?? street.name
                );
              }}
              className="cad-btn-outline"
              style={{ marginTop: 8 }}
            >
              🏷 Generar etiqueta
            </button>
          </div>
        </div>
      );
    }
    const roundabout = roundabouts.find((r) => r.id === primaryId);
    if (roundabout) {
      return (
        <div style={panelStyle} className="cad-panel-glass animate-fade-in">
          <div style={{ padding: '10px 12px' }}>
            <div style={headerStyle} onMouseDown={handleMouseDown}>
              <span className="cad-section-title">Propiedades</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--cad-text)', marginBottom: 8 }}>{roundabout.name}</p>
            <div className="cad-row"><span>Radio</span><span className="cad-row-value">{formatMetricLength(roundabout.radiusM)}</span></div>
            <div className="cad-row"><span>Calzada</span><span className="cad-row-value">{formatMetricLength(roundabout.roadWidthM)}</span></div>
            <button
              onClick={() => {
                const existing = entityLabels[roundabout.id];
                openEntityLabel(
                  'roundabout',
                  roundabout.id,
                  existing?.config ??
                    defaultLabelStyleConfig({ prefix: 'Rotonda', color: defaultColorForKind('rotonda') }),
                  existing?.text ?? roundabout.name
                );
              }}
              className="cad-btn-outline"
              style={{ marginTop: 8 }}
            >
              🏷 Generar etiqueta
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  const featureKind = getFeatureKind(feat);
  const areaM2 = feat.get('areaM2') as number | undefined;
  const perimeterM = feat.get('perimeterM') as number | undefined;
  const lengthM = feat.get('lengthM') as number | undefined;
  const segmentLengths = (feat.get('segmentLengths') as SegmentMetric[] | undefined) ?? [];
  const method = feat.get('method') as string | undefined;
  const label = feat.get('label') as string | undefined;
  const mergedAt = feat.get('mergedAt') as string | undefined;

  const isPolygon = areaM2 !== undefined;
  const labelConfig = feat.get('labelConfig') as LabelStyleConfig | undefined;
  const labelText = feat.get('labelText') as string | undefined;
  const hasActiveLabel = !!labelConfig?.enabled;

  return (
    <div style={panelStyle} className="cad-panel-glass animate-fade-in">
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

        {/* Acciones rápidas — generales para CUALQUIER kind (perímetro, línea, lote, manzana) */}
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '1px solid var(--cad-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {isPolygon && featureKind === 'perimetro' && (
            <p style={{ fontSize: '0.65rem', color: 'var(--cad-text-muted)', fontStyle: 'italic', margin: 0 }}>
              Este es el perímetro del sitio (referencia intacta). Trazá calles para generar manzanos.
            </p>
          )}

          {isPolygon && featureKind === 'manzana' && (
            <button onClick={() => focusManzanoInSidebar(primaryId)} className="cad-btn-outline">
              Subdividir este polígono
            </button>
          )}

          {hasActiveLabel && (
            <div
              style={{
                fontSize: '0.62rem',
                color: 'var(--cad-text-muted)',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <span>Etiqueta activa</span>
              <span style={{ color: 'var(--cad-accent)', fontWeight: 600, overflowWrap: 'anywhere', textAlign: 'right' }}>
                {labelText || label || '—'}
              </span>
            </div>
          )}

          <button
            onClick={() => {
              openLabelModal(
                primaryId,
                labelConfig ?? defaultLabelStyleConfig({ color: defaultColorForKind(featureKind) }),
                labelText ?? label ?? ''
              );
            }}
            className="cad-btn-outline"
            style={hasActiveLabel ? { borderColor: 'var(--cad-accent)', color: 'var(--cad-accent)' } : undefined}
          >
            🏷 {hasActiveLabel ? 'Editar etiqueta' : 'Generar etiqueta'}
          </button>
        </div>
      </div>
    </div>
  );
}
