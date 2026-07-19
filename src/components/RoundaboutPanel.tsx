// src/components/RoundaboutPanel.tsx
import React from 'react';
import { useRoundaboutStore } from '../store/roundaboutStore';
import { useDrawStore } from '../store/drawStore';
import { roundaboutRoadAreaM2 } from '../geo/roundaboutEngine';

const SIDES_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Círculo' },
  { value: 3, label: 'Triángulo' },
  { value: 4, label: 'Cuadrado' },
  { value: 5, label: 'Pentágono' },
  { value: 6, label: 'Hexágono' },
  { value: 7, label: 'Heptágono' },
  { value: 8, label: 'Octógono' },
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  background: 'var(--cad-bg-deepest)',
  border: '1px solid var(--cad-border)',
  borderRadius: 4,
  color: 'var(--cad-text)',
  fontSize: '0.72rem',
  fontFamily: 'JetBrains Mono, monospace',
};

const inputStyleSmall: React.CSSProperties = { ...inputStyle, padding: '3px 6px', fontSize: '0.65rem', marginTop: 2 };

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

  if (!panelVisible) return null;

  return (
    <div
      className="cad-panel-glass animate-fade-in"
      style={{
        position: 'fixed',
        top: 'calc(var(--cad-topbar-height) + 12px)',
        left: 280,
        width: 260,
        maxHeight: 'calc(100vh - 160px)',
        overflowY: 'auto',
        zIndex: 90,
        padding: '10px 10px',
        fontSize: '0.72rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderBottom: '1px solid var(--cad-border)', paddingBottom: 6 }}>
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
          onChange={(e) => setDefaultRadius(parseFloat(e.target.value) || defaultRadiusM)} style={inputStyle} />

        <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>Forma</label>
        <select value={defaultSides} onChange={(e) => setDefaultSides(parseInt(e.target.value, 10))} style={{ ...inputStyle, cursor: 'pointer' }}>
          {SIDES_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Calzada (m)</label>
            <input type="number" min={1} step={0.5} value={defaultRoadWidthM}
              onChange={(e) => setDefaultRoadWidth(parseFloat(e.target.value) || defaultRoadWidthM)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Vereda (m)</label>
            <input type="number" min={0} step={0.5} value={defaultSidewalkWidthM}
              onChange={(e) => setDefaultSidewalkWidth(parseFloat(e.target.value) || 0)} style={inputStyle} />
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
              {roundaboutRoadAreaM2(rb).toFixed(1)} m² de calzada
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ flex: 1, fontSize: '0.6rem', color: 'var(--cad-text-dim)' }}>
                Radio
                <input type="number" min={3} step={1} value={rb.radiusM}
                  onChange={(e) => updateRoundabout(rb.id, { radiusM: parseFloat(e.target.value) || rb.radiusM })} style={inputStyleSmall} />
              </label>
              <label style={{ flex: 1, fontSize: '0.6rem', color: 'var(--cad-text-dim)' }}>
                Calzada
                <input type="number" min={1} step={0.5} value={rb.roadWidthM}
                  onChange={(e) => updateRoundabout(rb.id, { roadWidthM: parseFloat(e.target.value) || rb.roadWidthM })} style={inputStyleSmall} />
              </label>
            </div>
          </div>
        ))
      )}
    </div>
  );
}