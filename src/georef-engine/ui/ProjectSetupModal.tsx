import React, { useState } from 'react';
import { Modal } from '@shared-ui/Modal';
import { useProjectCrsStore } from '../store/projectCrsStore';
import { useMapStore } from '@map-core/store/mapStore';
import { useUiShellStore } from '@app-shell/store/uiShellStore';
import { refreshSourceMetrics } from '../metrics';
import { utmZoneFromLonLat, type UtmHemisphere, type ProjectCrsMode } from '../crs/utmZones';

export default function ProjectSetupModal() {
  const confirmed = useProjectCrsStore((s) => s.confirmed);
  const mode = useProjectCrsStore((s) => s.mode);
  const utmZone = useProjectCrsStore((s) => s.utmZone);
  const utmHemisphere = useProjectCrsStore((s) => s.utmHemisphere);
  const setMode = useProjectCrsStore((s) => s.setMode);
  const setUtmZone = useProjectCrsStore((s) => s.setUtmZone);
  const confirm = useProjectCrsStore((s) => s.confirm);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const drawSource = useMapStore((s) => s.drawSource);
  const setBaseMap = useUiShellStore((s) => s.setBaseMap);

  const [localMode, setLocalMode] = useState<ProjectCrsMode>(mode);
  const [localZone, setLocalZone] = useState(utmZone);
  const [localHem, setLocalHem] = useState<UtmHemisphere>(utmHemisphere);

  const handleAutoDetect = () => {
    const [lon, lat] = viewConfig.center;
    const { zone, hemisphere } = utmZoneFromLonLat(lon, lat);
    setLocalZone(zone);
    setLocalHem(hemisphere);
  };

  const handleStart = () => {
    setMode(localMode);
    if (localMode === 'utm') {
      setUtmZone(localZone, localHem);
      setBaseMap('cad');
    }
    confirm();
    if (drawSource) refreshSourceMetrics(drawSource);
  };

  return (
    <Modal
      open={!confirmed}
      onOpenChange={() => {}}
      title="Configurar sistema de coordenadas del proyecto"
      visuallyHiddenTitle
      disableOutsideClose
      width="min(480px, 92vw)"
    >
      <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--cad-text)', marginBottom: 6 }}>
        Configurar sistema de coordenadas del proyecto
      </h2>
      <p style={{ fontSize: '0.75rem', color: 'var(--cad-text-dim)', marginBottom: 16, lineHeight: 1.5 }}>
        Elegí esto antes de dibujar. Internamente el proyecto siempre guarda WGS84
        (para el mapa base y GeoJSON/KML). Fijar la zona UTM ahora evita que
        la exportación e importación queden desincronizadas en un CRS real.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <button onClick={() => { setLocalMode('utm'); }} className="cad-icon-btn" style={{
          width: '100%', height: 'auto', padding: '10px 12px', textAlign: 'left', justifyContent: 'flex-start',
          background: localMode === 'utm' ? 'var(--cad-bg-active)' : 'var(--cad-bg-surface)',
          border: `1px solid ${localMode === 'utm' ? 'var(--cad-accent)' : 'var(--cad-border)'}`,
          color: localMode === 'utm' ? 'var(--cad-accent)' : 'var(--cad-text-dim)', borderRadius: 6,
        }}>
          <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>Zona UTM (recomendado)</div>
          <div style={{ fontSize: '0.68rem', opacity: 0.8, marginTop: 2 }}>
            Coordenadas reales en metros. Necesario para llevar el proyecto a
            un CRS georreferenciado (AutoCAD Civil3D / QGIS / etc.).
          </div>
        </button>

        {localMode === 'utm' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 8 }}>
            <input type="number" min={1} max={60} value={localZone}
              onChange={(e) => setLocalZone(Math.min(60, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              style={{ width: 60, padding: '5px 8px', background: 'var(--cad-bg-deepest)', border: '1px solid var(--cad-border)', borderRadius: 4, color: 'var(--cad-text)', fontSize: '0.75rem', fontFamily: 'JetBrains Mono, monospace' }} />
            <select value={localHem} onChange={(e) => setLocalHem(e.target.value as UtmHemisphere)}
              style={{ padding: '5px 8px', background: 'var(--cad-bg-deepest)', border: '1px solid var(--cad-border)', borderRadius: 4, color: 'var(--cad-text)', fontSize: '0.75rem' }}>
              <option value="N">Norte</option>
              <option value="S">Sur</option>
            </select>
            <button onClick={handleAutoDetect} className="cad-icon-btn" style={{ width: 'auto', height: 'auto', padding: '5px 10px', fontSize: '0.68rem', color: 'var(--cad-accent)' }}>
              Detectar desde vista actual
            </button>
          </div>
        )}

        <button onClick={() => setLocalMode('none')} className="cad-icon-btn" style={{
          width: '100%', height: 'auto', padding: '10px 12px', textAlign: 'left', justifyContent: 'flex-start',
          background: localMode === 'none' ? 'var(--cad-bg-active)' : 'var(--cad-bg-surface)',
          border: `1px solid ${localMode === 'none' ? 'var(--cad-accent)' : 'var(--cad-border)'}`,
          color: localMode === 'none' ? 'var(--cad-accent)' : 'var(--cad-text-dim)', borderRadius: 6,
        }}>
          <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>Dibujo libre (sin georreferenciar)</div>
          <div style={{ fontSize: '0.68rem', opacity: 0.8, marginTop: 2 }}>
            Plano local en metros. No tiene anclaje a un CRS real; se
            reposiciona a mano si después lo llevás a uno.
          </div>
        </button>
      </div>

      <button onClick={handleStart} className="cad-icon-btn" style={{
        width: '100%', height: 'auto', padding: '10px', fontSize: '0.8rem', fontWeight: 700,
        background: 'var(--cad-accent)', color: '#0d1117', border: '1px solid var(--cad-accent)', borderRadius: 6,
      }}>
        Empezar proyecto
      </button>
    </Modal>
  );
}