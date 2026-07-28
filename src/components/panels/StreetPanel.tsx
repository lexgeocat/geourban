import React, { useState, useRef, useCallback } from 'react';
import { useStreetStore } from '../../store/entities/streetStore';
import { useRoadCornerStore } from '../../store/map/roadCornerStore';
import { type CornerMode } from '../../geo/roads/ringFillet';
import { recomputeManzanos } from '../../geo/recomputeManzanos';
import { formatMetricLength, formatMetricArea } from '../../geo/metrics';
import { pathLength } from '../../geo/math/polygonEngine';

function streetLengthM(street: { start: [number, number]; end: [number, number]; waypoints?: Array<[number, number]> }): number {
  return pathLength([street.start, ...(street.waypoints ?? []), street.end]);
}

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
  const panelVisible = useStreetStore((s) => s.panelVisible);
  const setPanelVisible = useStreetStore((s) => s.setPanelVisible);
  const streets = useStreetStore((s) => s.streets);
  const updateStreet = useStreetStore((s) => s.updateStreet);
  const removeStreet = useStreetStore((s) => s.removeStreet);
  const defaultWidthM = useStreetStore((s) => s.defaultWidthM);
  const defaultSideWidthM = useStreetStore((s) => s.defaultSideWidthM);
  const setDefaultWidth = useStreetStore((s) => s.setDefaultWidth);
  const setDefaultSideWidth = useStreetStore((s) => s.setDefaultSideWidth);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const [pos, setPos] = useState({ x: 550, y: 4 });
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, posX: pos.x, posY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const nextX = dragRef.current.posX + (ev.clientX - dragRef.current.startX);
      const nextY = dragRef.current.posY + (ev.clientY - dragRef.current.startY);
      const maxX = window.innerWidth - 40;
      const maxY = window.innerHeight - 40;
      setPos({
        x: Math.min(Math.max(0, nextX), maxX),
        y: Math.min(Math.max(0, nextY), maxY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos.x, pos.y]);

  if (!panelVisible) return null;

  const handleWidthChange = (id: string, widthM: number) => {
    updateStreet(id, { widthM });
    void recomputeManzanos();
  };

  const handleSideWidthChange = (id: string, sideWidthM: number) => {
    updateStreet(id, { sideWidthM });
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
    <div
      className="cad-panel-glass animate-fade-in"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        maxHeight: 'calc(100vh - 160px)',
        overflowY: 'auto',
        zIndex: 110,
        padding: '10px 10px',
        fontSize: '0.72rem',
        minWidth: 260,
        maxWidth: 300,
      }}
    >
      <div
        onMouseDown={onHeaderMouseDown}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderBottom: '1px solid var(--cad-border)', paddingBottom: 6, cursor: 'grab', userSelect: 'none' }}
      >
        <span style={{ fontWeight: 700, color: 'var(--cad-text)', letterSpacing: '0.03em' }}>
          Vías <span style={{ color: 'var(--cad-text-muted)', fontWeight: 400 }}>({streets.length})</span>
        </span>
        <button onClick={() => setPanelVisible(false)} style={{ background: 'none', border: 'none', color: 'var(--cad-text-dim)', cursor: 'pointer', fontSize: '0.85rem' }} title="Cerrar" aria-label="Cerrar panel de vías">×</button>
      </div>

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
          <div key={s.id} style={{ border: '1px solid var(--cad-border)', borderLeft: '3px solid #8b5cf6', borderRadius: 4, marginBottom: 6, padding: '6px 8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {editingId === s.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                  className="cad-input cad-input-sm" style={{ marginTop: 0, flex: 1, marginRight: 6 }}
                  aria-label={`Nombre de ${s.name}`}
                />
              ) : (
                <span
                  onDoubleClick={() => startRename(s.id, s.name)}
                  style={{ fontWeight: 700, color: 'var(--cad-text)', cursor: 'text' }}
                  title="Doble click para renombrar"
                >
                  {s.name}
                </span>
              )}
              <button
                onClick={() => handleDelete(s.id)}
                style={{ background: 'none', border: 'none', color: 'var(--cad-accent-red)', cursor: 'pointer', fontSize: '0.75rem' }}
                title="Eliminar calle"
                aria-label={`Eliminar ${s.name}`}
              >
                ×
              </button>
            </div>
            <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.65rem', marginBottom: 4 }}>
              {formatMetricLength(streetLengthM(s))} · {formatMetricArea(streetLengthM(s) * s.widthM)} de calzada
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ flex: 1, fontSize: '0.6rem', color: 'var(--cad-text-dim)' }}>
                Calzada
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={s.widthM}
                  onChange={(e) => handleWidthChange(s.id, Math.max(0.5, parseFloat(e.target.value) || s.widthM))}
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
                  onChange={(e) => handleSideWidthChange(s.id, Math.max(0, parseFloat(e.target.value) || 0))}
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
