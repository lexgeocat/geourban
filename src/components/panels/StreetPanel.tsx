import React, { useState } from 'react';
import { useStreetStore } from '../../store/entities/streetStore';
import { useSelectionStore } from '../../store/map/selectionStore';
import { useRoadCornerStore } from '../../store/map/roadCornerStore';
import { type CornerMode } from '../../geo/roads/ringFillet';
import { recomputeManzanos } from '../../geo/recomputeManzanos';
import { formatMetricLength, formatMetricArea, streetLengthMetricM } from '../../geo/metrics';

const CORNER_MODE_OPTIONS: { value: CornerMode; label: string }[] = [
  { value: 'fillet', label: 'Ochave' },
  { value: 'chamfer', label: 'Chaflán' },
  { value: 'none', label: 'Esquina recta' },
];

function CornerModeControl() {
  const mode = useRoadCornerStore((s) => s.mode);
  const setMode = useRoadCornerStore((s) => s.setMode);

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {CORNER_MODE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`ribbon-tool small ${mode === opt.value ? 'active' : ''}`}
          onClick={() => setMode(opt.value)}
          aria-pressed={mode === opt.value}
          title={`Esquinas: ${opt.label}`}
        >
          <span className="ribbon-tool-label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function StreetPanel() {
  const streets = useStreetStore((s) => s.streets);
  const updateStreet = useStreetStore((s) => s.updateStreet);
  const removeStreet = useStreetStore((s) => s.removeStreet);
  const defaultWidthM = useStreetStore((s) => s.defaultWidthM);
  const defaultSideWidthM = useStreetStore((s) => s.defaultSideWidthM);
  const setDefaultWidth = useStreetStore((s) => s.setDefaultWidth);
  const setDefaultSideWidth = useStreetStore((s) => s.setDefaultSideWidth);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const selectOnMap = useSelectionStore((s) => s.setSelection);

  const applyStreetPatch = (id: string, patch: { widthM?: number; sideWidthM?: number }) => {
    updateStreet(id, patch);
    void recomputeManzanos();
  };

  const handleDelete = (id: string) => {
    removeStreet(id);
    void recomputeManzanos();
  };

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      updateStreet(editingId, { name: editName.trim() });
    }
    setEditingId(null);
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', fontSize: '0.72rem' }}>
      <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
          ▾ VALORES POR DEFECTO (próximas calles)
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }} htmlFor="street-panel-default-width">
              Calzada (m)
            </label>
            <input
              id="street-panel-default-width"
              type="number"
              min={0.5}
              step={0.5}
              value={defaultWidthM}
              onChange={(e) => setDefaultWidth(parseFloat(e.target.value) || defaultWidthM)}
              className="cad-input"
              aria-label="Ancho de calzada por defecto en metros"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }} htmlFor="street-panel-default-side">
              Vereda (m)
            </label>
            <input
              id="street-panel-default-side"
              type="number"
              min={0}
              step={0.5}
              value={defaultSideWidthM}
              onChange={(e) => setDefaultSideWidth(Math.max(0, parseFloat(e.target.value) || 0))}
              className="cad-input"
              aria-label="Ancho de vereda por defecto en metros"
            />
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
          ▾ ESQUINAS DE VÍA
        </div>
        <CornerModeControl />
      </div>

      {streets.length === 0 ? (
        <p style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)' }}>Todavía no hay calles trazadas.</p>
      ) : (
        streets.map((s) => (
          <div
            key={s.id}
            onClick={() => selectOnMap([s.id], s.id)}
            title="Click: resalta esta calle en el mapa"
            style={{
              border: `1px solid ${selectedIds.has(s.id) ? 'var(--cad-accent-amber)' : 'var(--cad-border)'}`,
              borderLeft: '3px solid #8b5cf6',
              borderRadius: 4,
              marginBottom: 6,
              padding: '6px 8px',
              cursor: 'pointer',
              boxShadow: selectedIds.has(s.id) ? '0 0 0 1px var(--cad-accent-amber)' : 'none',
              transition: 'box-shadow 120ms ease, border-color 120ms ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {editingId === s.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                  onClick={(e) => e.stopPropagation()}
                  className="cad-input cad-input-sm" style={{ marginTop: 0, flex: 1, marginRight: 6 }}
                  aria-label={`Nombre de ${s.name}`}
                />
              ) : (
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(s.id, s.name); }}
                  style={{ fontWeight: 700, color: 'var(--cad-text)', cursor: 'text' }}
                  title="Doble click para renombrar"
                >
                  {s.name}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                style={{ background: 'none', border: 'none', color: 'var(--cad-accent-red)', cursor: 'pointer', fontSize: '0.75rem' }}
                title="Eliminar calle"
                aria-label={`Eliminar ${s.name}`}
              >
                ×
              </button>
            </div>
            <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.65rem', marginBottom: 4 }}>
              {formatMetricLength(streetLengthMetricM(s))} · {formatMetricArea(streetLengthMetricM(s) * s.widthM)} de calzada
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ flex: 1, fontSize: '0.6rem', color: 'var(--cad-text-dim)' }}>
                Calzada
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={s.widthM}
                  onChange={(e) => applyStreetPatch(s.id, { widthM: Math.max(0.5, parseFloat(e.target.value) || s.widthM) })}
                  onClick={(e) => e.stopPropagation()}
                  className="cad-input cad-input-sm"
                  aria-label={`Ancho de calzada de ${s.name} en metros`}
                />
              </label>
              <label style={{ flex: 1, fontSize: '0.6rem', color: 'var(--cad-text-dim)' }}>
                Vereda
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={s.sideWidthM}
                  onChange={(e) => applyStreetPatch(s.id, { sideWidthM: Math.max(0, parseFloat(e.target.value) || 0) })}
                  onClick={(e) => e.stopPropagation()}
                  className="cad-input cad-input-sm"
                  aria-label={`Ancho de vereda de ${s.name} en metros`}
                />
              </label>
            </div>
          </div>
        ))
      )}
    </div>
  );
}