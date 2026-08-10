import React from 'react';
import { useRoundaboutStore } from '../store/roundaboutStore';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { useDrawStore } from '@map-core/store/drawStore';
import { roundaboutRoadAreaM2 } from '../geometry/roundaboutEngine';
import { formatMetricArea } from '@georef-engine/metrics';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { useLabelConfigModalStore } from '@label-engine/store/labelConfigModalStore';
import { defaultLabelStyleConfig, defaultColorForKind } from '@label-engine/model/labelModel';

const SIDES_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Círculo' },
  { value: 3, label: 'Triángulo' },
  { value: 4, label: 'Cuadrado' },
  { value: 5, label: 'Pentágono' },
  { value: 6, label: 'Hexágono' },
  { value: 7, label: 'Heptágono' },
  { value: 8, label: 'Octógono' },
];

export default function RoundaboutPanel() {
  const roundabouts = useRoundaboutStore((s) => s.roundabouts);
  const defaultRadiusM = useRoundaboutStore((s) => s.defaultRadiusM);
  const defaultSides = useRoundaboutStore((s) => s.defaultSides);
  const defaultRoadWidthM = useRoundaboutStore((s) => s.defaultRoadWidthM);
  const defaultSidewalkWidthM = useRoundaboutStore((s) => s.defaultSidewalkWidthM);
  const setDefaultRadius = useRoundaboutStore((s) => s.setDefaultRadius);
  const setDefaultSides = useRoundaboutStore((s) => s.setDefaultSides);
  const setDefaultRoadWidth = useRoundaboutStore((s) => s.setDefaultRoadWidth);
  const setDefaultSidewalkWidth = useRoundaboutStore((s) => s.setDefaultSidewalkWidth);
  const updateRoundabout = useRoundaboutStore((s) => s.updateRoundabout);
  const removeRoundabout = useRoundaboutStore((s) => s.removeRoundabout);

  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const selectOnMap = useSelectionStore((s) => s.setSelection);
  const entityLabels = useEntityLabelStore((s) => s.byId);
  const openEntityLabel = useLabelConfigModalStore((s) => s.openForEntity);

  return (
    <div style={{ height: '100%', overflowY: 'auto', fontSize: '0.72rem' }}>
      <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
          ? PARÁMETROS DE DISEÑO
        </div>

        <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Radio al eje (m)</label>
        <input type="number" min={3} step={1} value={defaultRadiusM}
          onChange={(e) => setDefaultRadius(parseFloat(e.target.value) || defaultRadiusM)} className="cad-input" />

        <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>Forma</label>
        <select value={defaultSides} onChange={(e) => setDefaultSides(parseInt(e.target.value, 10))} className="cad-input" style={{ cursor: 'pointer' }}>
          {SIDES_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Calzada (m)</label>
            <input type="number" min={1} step={0.5} value={defaultRoadWidthM}
              onChange={(e) => setDefaultRoadWidth(parseFloat(e.target.value) || defaultRoadWidthM)} className="cad-input" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Vereda (m)</label>
            <input type="number" min={0} step={0.5} value={defaultSidewalkWidthM}
              onChange={(e) => setDefaultSidewalkWidth(parseFloat(e.target.value) || 0)} className="cad-input" />
          </div>
        </div>

        <button
          onClick={() => setMode(mode === 'roundabout' ? 'select' : 'roundabout')}
          className="cad-icon-btn"
          style={{ width: '100%', marginTop: 8, height: 28, borderColor: mode === 'roundabout' ? 'var(--cad-accent)' : undefined, color: mode === 'roundabout' ? 'var(--cad-accent)' : undefined }}
        >
          {mode === 'roundabout' ? '? Clic para centro y radio…' : '? Trazar rotonda'}
        </button>
      </div>

      {roundabouts.length === 0 ? (
        <p style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)' }}>Todavía no hay rotondas trazadas.</p>
      ) : (
        roundabouts.map((rb) => (
          <div
            key={rb.id}
            onClick={() => selectOnMap([rb.id], rb.id)}
            title="Click: resalta esta rotonda en el mapa"
            style={{
              border: `1px solid ${selectedIds.has(rb.id) ? 'var(--cad-accent-amber)' : 'var(--cad-border)'}`,
              borderLeft: '3px solid #f78166',
              borderRadius: 4,
              marginBottom: 6,
              padding: '6px 8px',
              cursor: 'pointer',
              boxShadow: selectedIds.has(rb.id) ? '0 0 0 1px var(--cad-accent-amber)' : 'none',
              transition: 'box-shadow 120ms ease, border-color 120ms ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: 'var(--cad-text)' }}>{rb.name}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const existing = entityLabels[rb.id];
                    openEntityLabel(
                      'roundabout',
                      rb.id,
                      existing?.config ?? defaultLabelStyleConfig({ prefix: 'Rotonda', color: defaultColorForKind('rotonda') }),
                      existing?.text ?? rb.name,
                    );
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--cad-accent)', cursor: 'pointer', fontSize: '0.75rem' }}
                  title="Generar etiqueta"
                >
                  ??
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); removeRoundabout(rb.id); useEntityLabelStore.getState().remove(rb.id); }}
                  style={{ background: 'none', border: 'none', color: 'var(--cad-accent-red)', cursor: 'pointer', fontSize: '0.75rem' }}
                  title="Eliminar rotonda"
                >
                  ?
                </button>
              </div>
            </div>
            <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.65rem', marginBottom: 4 }}>
              {formatMetricArea(roundaboutRoadAreaM2(rb))} de calzada
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ flex: 1, fontSize: '0.6rem', color: 'var(--cad-text-dim)' }}>
                Radio
                <input type="number" min={3} step={1} value={rb.radiusM}
                  onChange={(e) => updateRoundabout(rb.id, { radiusM: parseFloat(e.target.value) || rb.radiusM })}
                  onClick={(e) => e.stopPropagation()} className="cad-input cad-input-sm" />
              </label>
              <label style={{ flex: 1, fontSize: '0.6rem', color: 'var(--cad-text-dim)' }}>
                Calzada
                <input type="number" min={1} step={0.5} value={rb.roadWidthM}
                  onChange={(e) => updateRoundabout(rb.id, { roadWidthM: parseFloat(e.target.value) || rb.roadWidthM })}
                  onClick={(e) => e.stopPropagation()} className="cad-input cad-input-sm" />
              </label>
            </div>
          </div>
        ))
      )}
    </div>
  );
}