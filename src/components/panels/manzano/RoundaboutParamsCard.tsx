import React from 'react';
import { useRoundaboutStore } from '../../../store/entities/roundaboutStore';

export default function RoundaboutParamsCard() {
  const rbRadiusM = useRoundaboutStore((s) => s.defaultRadiusM);
  const setRbRadius = useRoundaboutStore((s) => s.setDefaultRadius);
  const rbSides = useRoundaboutStore((s) => s.defaultSides);
  const setRbSides = useRoundaboutStore((s) => s.setDefaultSides);
  const rbRoadWidthM = useRoundaboutStore((s) => s.defaultRoadWidthM);
  const setRbRoadWidth = useRoundaboutStore((s) => s.setDefaultRoadWidth);
  const rbSidewalkM = useRoundaboutStore((s) => s.defaultSidewalkWidthM);
  const setRbSidewalk = useRoundaboutStore((s) => s.setDefaultSidewalkWidth);

  return (
    <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
        ◼ PARÁMETROS DE ROTONDA
      </div>
      <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Radio al eje (m)</label>
      <input type="number" min={3} value={rbRadiusM} onChange={(e) => setRbRadius(parseFloat(e.target.value) || rbRadiusM)} className="cad-input" />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Calzada (m)</label>
          <input type="number" min={1} step={0.5} value={rbRoadWidthM} onChange={(e) => setRbRoadWidth(parseFloat(e.target.value) || rbRoadWidthM)} className="cad-input" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Vereda (m)</label>
          <input type="number" min={0} step={0.5} value={rbSidewalkM} onChange={(e) => setRbSidewalk(parseFloat(e.target.value) || 0)} className="cad-input" />
        </div>
      </div>
      <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>Forma</label>
      <select value={rbSides} onChange={(e) => setRbSides(parseInt(e.target.value, 10))} className="cad-input" style={{ cursor: 'pointer' }}>
        <option value={0}>Círculo</option>
        <option value={3}>Triángulo</option>
        <option value={4}>Cuadrado</option>
        <option value={5}>Pentágono</option>
        <option value={6}>Hexágono</option>
        <option value={7}>Heptágono</option>
        <option value={8}>Octógono</option>
      </select>
    </div>
  );
}