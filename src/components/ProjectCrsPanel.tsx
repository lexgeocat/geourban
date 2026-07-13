import React, { useState } from 'react';
import { useProjectCrsStore, type ProjectCrsMode } from '../store/projectCrsStore';
import { useMapStore } from '../store/mapStore';

const IconCrs = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

// MODE_LABELS pasa a solo estos dos:
const MODE_LABELS: Record<ProjectCrsMode, string> = {
  utm: 'UTM (zona proyectada)',
  none: 'Dibujo libre (plano local)',
};

export default function ProjectCrsPanel() {
  const [open, setOpen] = useState(false);
  const mode = useProjectCrsStore((s) => s.mode);
  const utmZone = useProjectCrsStore((s) => s.utmZone);
  const utmHemisphere = useProjectCrsStore((s) => s.utmHemisphere);
  const exportEpsg = useProjectCrsStore((s) => s.exportEpsg);
  const setMode = useProjectCrsStore((s) => s.setMode);
  const setUtmZone = useProjectCrsStore((s) => s.setUtmZone);
  const autoDetectFromLonLat = useProjectCrsStore((s) => s.autoDetectFromLonLat);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const requestReconfigure = useProjectCrsStore((s) => s.requestReconfigure);

  const handleAutoDetect = () => {
    const [lon, lat] = viewConfig.center;
    autoDetectFromLonLat(lon, lat);
    setMode('utm');
  };

  return (
    <div style={{ position: 'absolute', top: 'calc(var(--cad-topbar-height) + 10px)', right: 240, zIndex: 100 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="cad-icon-btn cad-tooltip"
        data-tooltip="CRS del proyecto"
        style={{
          display: 'flex',
          marginBottom: open ? 6 : 0,
          background: open ? 'var(--cad-bg-active)' : 'rgba(26, 34, 54, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--cad-border)',
          color: open ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
        }}
      >
        <IconCrs />
      </button>

      {open && (
        <div className="cad-panel-glass animate-fade-in" style={{ padding: '10px 12px', minWidth: 240 }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cad-text-dim)', marginBottom: 8, borderBottom: '1px solid var(--cad-border)', paddingBottom: 6 }}>
            CRS del proyecto
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            {(Object.keys(MODE_LABELS) as ProjectCrsMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="cad-icon-btn"
                style={{
                  width: '100%', height: 'auto', padding: '6px 8px', fontSize: '0.7rem', fontWeight: 500,
                  textAlign: 'left', justifyContent: 'flex-start',
                  background: mode === m ? 'var(--cad-bg-active)' : 'var(--cad-bg-surface)',
                  border: `1px solid ${mode === m ? 'var(--cad-accent)' : 'var(--cad-border)'}`,
                  color: mode === m ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
                  borderRadius: 4,
                }}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>

          {mode === 'utm' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <input
                type="number"
                min={1}
                max={60}
                value={utmZone}
                onChange={(e) => setUtmZone(Math.min(60, Math.max(1, parseInt(e.target.value, 10) || 1)), utmHemisphere)}
                style={{ width: 56, padding: '4px 6px', background: 'var(--cad-bg-deepest)', border: '1px solid var(--cad-border)', borderRadius: 4, color: 'var(--cad-text)', fontSize: '0.75rem', fontFamily: 'JetBrains Mono, monospace' }}
              />
              <select
                value={utmHemisphere}
                onChange={(e) => setUtmZone(utmZone, e.target.value as 'N' | 'S')}
                style={{ padding: '4px 6px', background: 'var(--cad-bg-deepest)', border: '1px solid var(--cad-border)', borderRadius: 4, color: 'var(--cad-text)', fontSize: '0.75rem' }}
              >
                <option value="N">Norte</option>
                <option value="S">Sur</option>
              </select>
              <button
                onClick={handleAutoDetect}
                className="cad-icon-btn cad-tooltip"
                data-tooltip="Detectar zona desde la vista actual"
                style={{ width: 'auto', height: 'auto', padding: '4px 8px', fontSize: '0.65rem', color: 'var(--cad-accent)' }}
              >
                Auto
              </button>
            </div>
          )}

          <div style={{ fontSize: '0.62rem', color: 'var(--cad-text-muted)' }}>
            Exportación DXF usa:{' '}
            <strong style={{ color: 'var(--cad-text-dim)' }}>
              {mode === 'utm' ? exportEpsg : 'Plano local (auto, centrado en el dibujo)'}
            </strong>
            <button
  onClick={requestReconfigure}
  className="cad-icon-btn"
  style={{ width: '100%', height: 'auto', padding: '5px 8px', fontSize: '0.65rem', color: 'var(--cad-text-muted)', border: '1px solid var(--cad-border)', borderRadius: 4, marginTop: 4 }}
>
  Reconfigurar (reabrir asistente)
</button>
          </div>
        </div>
      )}
    </div>
  );
}