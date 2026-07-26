import React, { useState } from 'react';
import { useStreetStore } from '../../../store/entities/streetStore';
import { setMaxFilletRadius, getMaxFilletRadius } from '../../../geo/roads/streetEngine';

export default function StreetParamsCard() {
  const defaultWidthM = useStreetStore((s) => s.defaultWidthM);
  const setDefaultWidth = useStreetStore((s) => s.setDefaultWidth);
  const defaultSideWidthM = useStreetStore((s) => s.defaultSideWidthM);
  const setDefaultSideWidth = useStreetStore((s) => s.setDefaultSideWidth);
  const [maxFilletR, setMaxFilletR] = useState(() => getMaxFilletRadius());

  return (
    <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
        ◼ PARÁMETROS DE VÍA
      </div>
      <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Ancho de vía (m)</label>
      <input type="number" min={1} value={defaultWidthM} onChange={(e) => setDefaultWidth(parseFloat(e.target.value) || defaultWidthM)} className="cad-input" />
      <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>Ancho de vereda (m)</label>
      <input type="number" min={0} step={0.5} value={defaultSideWidthM} onChange={(e) => setDefaultSideWidth(Math.max(0, parseFloat(e.target.value) || 0))} className="cad-input" />
      <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>Radio máx. de ochave (m)</label>
      <input
        type="number" min={1} step={0.5} value={maxFilletR}
        onChange={(e) => {
          const v = parseFloat(e.target.value) || maxFilletR;
          setMaxFilletR(v);
          setMaxFilletRadius(v);
        }}
        className="cad-input"
      />
    </div>
  );
}