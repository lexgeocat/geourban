// src/components/RoundaboutPanel.tsx
import React, { useState, useRef, useCallback } from 'react';
import { useRoundaboutStore } from '../../store/entities/roundaboutStore';
import { useDrawStore } from '../../store/map/drawStore';
import { roundaboutRoadAreaM2 } from '../../geo/roundabout/roundaboutEngine';
import { formatMetricArea } from '../../geo/metrics';

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
  const panelVisible = useRoundaboutStore((s) => s.panelVisible);
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
  const setPanelVisible = useRoundaboutStore((s) => s.setPanelVisible);

  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);

  const [pos, setPos] = useState({ x: 280, y: 4 });
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
          Rotondas <span style={{ color: 'var(--cad-text-muted)', fontWeight: 400 }}>({roundabouts.length})</span>
        </span>
        <button onClick={() => setPanelVisible(false)} style={{ background: 'none', border: 'none', color: 'var(--cad-text-dim)', cursor: 'pointer', fontSize: '0.85rem' }} title="Cerrar">✕</button>
      </div>

      <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
          ◼ PARÁMETROS DE DISEÑO
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
          {mode === 'roundabout' ? '● Clic para centro y radio…' : '◎ Trazar rotonda'}
        </button>
      </div>

      {roundabouts.length === 0 ? (
        <p style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)' }}>Todavía no hay rotondas trazadas.</p>
      ) : (
        roundabouts.map((rb) => (
          <div key={rb.id} style={{ border: '1px solid var(--cad-border)', borderLeft: '3px solid #f78166', borderRadius: 4, marginBottom: 6, padding: '6px 8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: 'var(--cad-text)' }}>{rb.name}</span>
              <button onClick={() => removeRoundabout(rb.id)} style={{ background: 'none', border: 'none', color: 'var(--cad-accent-red)', cursor: 'pointer', fontSize: '0.75rem' }} title="Eliminar rotonda">✕</button>
            </div>
            <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.65rem', marginBottom: 4 }}>
              {formatMetricArea(roundaboutRoadAreaM2(rb))} de calzada
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ flex: 1, fontSize: '0.6rem', color: 'var(--cad-text-dim)' }}>
                Radio
                <input type="number" min={3} step={1} value={rb.radiusM}
                  onChange={(e) => updateRoundabout(rb.id, { radiusM: parseFloat(e.target.value) || rb.radiusM })} className="cad-input cad-input-sm" />
              </label>
              <label style={{ flex: 1, fontSize: '0.6rem', color: 'var(--cad-text-dim)' }}>
                Calzada
                <input type="number" min={1} step={0.5} value={rb.roadWidthM}
                  onChange={(e) => updateRoundabout(rb.id, { roadWidthM: parseFloat(e.target.value) || rb.roadWidthM })} className="cad-input cad-input-sm" />
              </label>
            </div>
          </div>
        ))
      )}
    </div>
  );
}