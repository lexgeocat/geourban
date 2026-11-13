import { useState } from 'react';
import { Globe2, Compass, Sparkles, LocateFixed, ArrowRight } from 'lucide-react';
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
      width="min(500px, 92vw)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              background: 'var(--ui-10-gradient-soft)',
              border: '1px solid rgba(255, 107, 74, 0.42)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 4px 16px rgba(255, 107, 74, 0.2)',
            }}
          >
            <Globe2 size={20} color="#FF6B4A" />
          </div>
          <div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1rem',
                fontWeight: 700,
                color: 'var(--cad-text)',
                lineHeight: 1.2,
              }}
            >
              Sistema de Coordenadas del Proyecto
            </h2>
            <p style={{ fontSize: '0.69rem', color: 'var(--cad-text-muted)', marginTop: 2 }}>
              Definí la proyección métrica antes de iniciar el modelado territorial
            </p>
          </div>
        </div>

        <p style={{ fontSize: '0.73rem', color: 'var(--cad-text-dim)', lineHeight: 1.5 }}>
          Internamente GeoUrban Studio opera sobre WGS84 para sincronizar mapas base y archivos GeoJSON/KML. Fijar la zona UTM garantiza precisión métrica real en áreas, ejes viales y lotes.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Option 1: UTM */}
          <button
            type="button"
            onClick={() => setLocalMode('utm')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 11,
              padding: '12px 14px',
              textAlign: 'left',
              background: localMode === 'utm' ? 'var(--ui-10-gradient-soft)' : 'var(--cad-bg-surface)',
              border: `1px solid ${localMode === 'utm' ? 'rgba(255, 107, 74, 0.5)' : 'var(--cad-border)'}`,
              borderRadius: 12,
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: 'rgba(10, 11, 15, 0.55)',
                border: '1px solid rgba(52, 211, 153, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              <Compass size={16} color="#34D399" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    color: localMode === 'utm' ? '#FFFFFF' : 'var(--cad-text)',
                  }}
                >
                  Zona UTM Proyectada
                </span>
                <span
                  style={{
                    fontSize: '0.58rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '1px 7px',
                    borderRadius: 999,
                    background: 'rgba(52, 211, 153, 0.16)',
                    border: '1px solid rgba(52, 211, 153, 0.38)',
                    color: '#34D399',
                  }}
                >
                  Recomendado
                </span>
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--cad-text-dim)', marginTop: 3, lineHeight: 1.4 }}>
                Coordenadas métricas reales compatibles con AutoCAD Civil 3D, QGIS y catastros oficiales.
              </div>
            </div>
          </button>

          {localMode === 'utm' && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '9px 12px',
                borderRadius: 10,
                background: 'rgba(10, 11, 15, 0.65)',
                border: '1px solid var(--cad-border)',
              }}
            >
              <span style={{ fontSize: '0.68rem', color: 'var(--cad-text-dim)', fontWeight: 600 }}>
                Zona:
              </span>
              <input
                type="number"
                min={1}
                max={60}
                value={localZone}
                onChange={(e) =>
                  setLocalZone(Math.min(60, Math.max(1, parseInt(e.target.value, 10) || 1)))
                }
                className="cad-input"
                style={{ width: 62, textAlign: 'center' }}
              />
              <select
                value={localHem}
                onChange={(e) => setLocalHem(e.target.value as UtmHemisphere)}
                className="cad-input"
                style={{ width: 100, fontFamily: 'var(--font-sans)' }}
              >
                <option value="N">Hemisferio N</option>
                <option value="S">Hemisferio S</option>
              </select>
              <button
                type="button"
                onClick={handleAutoDetect}
                className="cad-btn-secondary"
                style={{ marginLeft: 'auto', padding: '5px 10px', fontSize: '0.67rem' }}
              >
                <LocateFixed size={12} color="#38BDF8" />
                <span>Auto-detectar</span>
              </button>
            </div>
          )}

          {/* Option 2: Local Plane */}
          <button
            type="button"
            onClick={() => setLocalMode('none')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 11,
              padding: '12px 14px',
              textAlign: 'left',
              background: localMode === 'none' ? 'var(--ui-10-gradient-soft)' : 'var(--cad-bg-surface)',
              border: `1px solid ${localMode === 'none' ? 'rgba(255, 107, 74, 0.5)' : 'var(--cad-border)'}`,
              borderRadius: 12,
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: 'rgba(10, 11, 15, 0.55)',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              <Sparkles size={16} color="#A78BFA" />
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  color: localMode === 'none' ? '#FFFFFF' : 'var(--cad-text)',
                }}
              >
                Dibujo Libre (Plano Local)
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--cad-text-dim)', marginTop: 3, lineHeight: 1.4 }}>
                Lienzo cartesiano en metros sin anclaje geográfico fijo, ideal para bocetos conceptuales.
              </div>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={handleStart}
          className="cad-btn-primary"
          style={{ width: '100%', padding: '10px 16px', fontSize: '0.8rem', borderRadius: 10 }}
        >
          <span>Iniciar espacio de trabajo</span>
          <ArrowRight size={15} />
        </button>
      </div>
    </Modal>
  );
}
