import React, { useState, useRef, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Undo2, Redo2 } from 'lucide-react';
import { useMapStore } from '../store/mapStore';
import { useLayerStore } from '../store/layerStore';
import { undo, redo, useCommandStack } from '../commands/CommandStack';

import { useProjectCrsStore, type ProjectCrsMode } from '../store/projectCrsStore';
import { BASE_MAP_DEFS, type BaseMapId } from '../map/baseMaps';
import SnapPanel from './SnapPanel';

/* ─── Icons ─── */

const IconCad = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </svg>
);

const IconMap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

const IconSatellite = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <path d="m2 22 20-20" />
    <path d="M12 2a10 10 0 0 1 10 10" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconGoogleMaps = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <path d="M12 2a8 8 0 0 0-8 8c0 5 4 11 8 13 4-2 8-8 8-13a8 8 0 0 0-8-8z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const IconProperties = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const IconCrs = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const BASE_MAP_ICONS: Record<BaseMapId, React.ReactNode> = {
  cad: <IconCad />,
  osm: <IconMap />,
  googleSatellite: <IconSatellite />,
  googleRoadmap: <IconGoogleMaps />,
};

const BASE_MAP_LABELS: Record<BaseMapId, string> = {
  cad: 'CAD — Grilla',
  osm: 'OpenStreetMap',
  googleSatellite: 'Google Satelital',
  googleRoadmap: 'Google Maps',
};

const CRS_MODE_LABELS: Record<ProjectCrsMode, string> = {
  utm: 'UTM (zona proyectada)',
  none: 'Dibujo libre (plano local)',
};

export default function StatusBar() {
  const coords = useMapStore((s) => s.cursorCoords);
  const zoom = useMapStore((s) => s.zoom);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const baseMap = useLayerStore((s) => s.baseMap);
  const setBaseMap = useLayerStore((s) => s.setBaseMap);
  const panelVisibility = useLayerStore((s) => s.panelVisibility);
  const setPanelVisibility = useLayerStore((s) => s.setPanelVisibility);

  const crsMode = useProjectCrsStore((s) => s.mode);
  const utmZone = useProjectCrsStore((s) => s.utmZone);
  const utmHemisphere = useProjectCrsStore((s) => s.utmHemisphere);
  const exportEpsg = useProjectCrsStore((s) => s.exportEpsg);
  const setCrsMode = useProjectCrsStore((s) => s.setMode);
  const setUtmZone = useProjectCrsStore((s) => s.setUtmZone);
  const autoDetectFromLonLat = useProjectCrsStore((s) => s.autoDetectFromLonLat);
  const requestReconfigure = useProjectCrsStore((s) => s.requestReconfigure);

  const [baseMapOpen, setBaseMapOpen] = useState(false);
  const [crsOpen, setCrsOpen] = useState(false);
  const baseMapRef = useRef<HTMLDivElement>(null);
  const crsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (baseMapRef.current && !baseMapRef.current.contains(e.target as Node)) setBaseMapOpen(false);
      if (crsRef.current && !crsRef.current.contains(e.target as Node)) setCrsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const epsgLabel = crsMode === 'utm' ? (exportEpsg ?? 'EPSG:UTM') : 'Local';

  // History controls (Undo / Redo)
  const canUndo = useCommandStack((s) => s.canUndo);
  const canRedo = useCommandStack((s) => s.canRedo);
  const zoomIn = useMapStore((s) => s.zoomIn);
  const zoomOut = useMapStore((s) => s.zoomOut);
  const fitToExtent = useMapStore((s) => s.fitToExtent);

  const handleCrsModeSelect = (m: ProjectCrsMode) => {
    setCrsMode(m);
    // Al pasar a UTM activamos OSM para tener contexto real de ubicación
    // (mapa de calles/satélite) en vez de la grilla CAD abstracta —
    // ayuda a ubicarse antes de confiar en la zona detectada/elegida.
    if (m === 'utm') setBaseMap('osm');
  };

  const handleCrsAutoDetect = () => {
    const [lon, lat] = viewConfig.center;
    autoDetectFromLonLat(lon, lat);
    setBaseMap('osm');
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 'var(--cad-statusbar-height)',
        background: 'var(--cad-bg-deep)',
        borderTop: '1px solid var(--cad-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        zIndex: 100,
        fontSize: '0.65rem',
        color: 'var(--cad-text-muted)',
      }}
      className="font-mono-cad"
    >
      {/* Left: Undo/Redo + coordinates */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {/* Undo / Redo (moved from TopBar) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            className="cad-icon-btn cad-tooltip"
            onClick={undo}
            disabled={!canUndo}
            data-tooltip="Deshacer (Ctrl+Z)"
            aria-label="Deshacer"
            title="Deshacer (Ctrl+Z)"
            style={{
              width: 22,
              height: 22,
              opacity: canUndo ? 1 : 0.35,
              cursor: canUndo ? 'pointer' : 'not-allowed',
            }}
          >
            <Undo2 size={12} />
          </button>
          <button
            className="cad-icon-btn cad-tooltip"
            onClick={redo}
            disabled={!canRedo}
            data-tooltip="Rehacer (Ctrl+Y)"
            aria-label="Rehacer"
            title="Rehacer (Ctrl+Y)"
            style={{
              width: 22,
              height: 22,
              opacity: canRedo ? 1 : 0.35,
              cursor: canRedo ? 'pointer' : 'not-allowed',
            }}
          >
            <Redo2 size={12} />
          </button>
        </div>

        <span style={{ opacity: 0.2 }}>│</span>

        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 11, height: 11 }}>
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
          </svg>
          {coords ? (
            <span>
              <span style={{ color: 'var(--cad-accent)' }}>X</span>{' '}
              {coords.isProjected ? coords.x.toFixed(2) : coords.x.toFixed(4)}
              <span style={{ margin: '0 6px', opacity: 0.3 }}>│</span>
              <span style={{ color: 'var(--cad-accent)' }}>Y</span>{' '}
              {coords.isProjected ? coords.y.toFixed(2) : coords.y.toFixed(4)}
              {coords.isProjected && <span style={{ marginLeft: 6, opacity: 0.5 }}>m</span>}
            </span>
          ) : (
            <span style={{ opacity: 0.5 }}>— sin posición —</span>
          )}
        </span>
      </div>

      {/* Center: CRS + Base Map + OSNAP + Grid Snap */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, justifyContent: 'center' }}>
        {/* CRS del proyecto — antes era un panel flotante aparte + un texto
            fijo "EPSG:3857" acá; ahora es un único badge vivo que muestra
            el EPSG real (o "Local" en modo dibujo libre). */}
        <div ref={crsRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => setCrsOpen(!crsOpen)}
            className="cad-icon-btn cad-tooltip"
            data-tooltip="CRS del proyecto"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 6px',
              borderRadius: 4,
              background: crsOpen ? 'var(--cad-bg-active)' : 'transparent',
              border: '1px solid var(--cad-border)',
              color: crsMode === 'utm' ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
              fontSize: '0.65rem',
            }}
          >
            <IconCrs />
            <span style={{ letterSpacing: '0.03em' }}>{epsgLabel}</span>
          </button>
          {crsOpen && (
            <div
              className="cad-panel-glass animate-fade-in"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 4,
                minWidth: 230,
                padding: 10,
                borderRadius: 6,
                zIndex: 200,
              }}
            >
              <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cad-text-dim)', marginBottom: 8, borderBottom: '1px solid var(--cad-border)', paddingBottom: 6 }}>
                CRS del proyecto
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {(Object.keys(CRS_MODE_LABELS) as ProjectCrsMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => handleCrsModeSelect(m)}
                    className="cad-icon-btn"
                    style={{
                      width: '100%', height: 'auto', padding: '6px 8px', fontSize: '0.7rem', fontWeight: 500,
                      textAlign: 'left', justifyContent: 'flex-start',
                      background: crsMode === m ? 'var(--cad-bg-active)' : 'var(--cad-bg-surface)',
                      border: `1px solid ${crsMode === m ? 'var(--cad-accent)' : 'var(--cad-border)'}`,
                      color: crsMode === m ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
                      borderRadius: 4,
                    }}
                  >
                    {CRS_MODE_LABELS[m]}
                  </button>
                ))}
              </div>

              {crsMode === 'utm' && (
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
                    onClick={handleCrsAutoDetect}
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
                  {crsMode === 'utm' ? exportEpsg : 'Plano local (centrado en la vista actual)'}
                </strong>
                <button
                  onClick={() => { requestReconfigure(); setCrsOpen(false); }}
                  className="cad-icon-btn"
                  style={{ width: '100%', height: 'auto', padding: '5px 8px', fontSize: '0.65rem', color: 'var(--cad-text-muted)', border: '1px solid var(--cad-border)', borderRadius: 4, marginTop: 6 }}
                >
                  Reconfigurar (reabrir asistente)
                </button>
              </div>
            </div>
          )}
        </div>

        <span style={{ opacity: 0.2, margin: '0 4px' }}>│</span>

        {/* Base Map Selector */}
        <div ref={baseMapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => setBaseMapOpen(!baseMapOpen)}
            className="cad-icon-btn cad-tooltip"
            data-tooltip="Mapa base"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 6px',
              borderRadius: 4,
              background: baseMapOpen ? 'var(--cad-bg-active)' : 'transparent',
              border: '1px solid var(--cad-border)',
              color: 'var(--cad-text)',
              fontSize: '0.65rem',
            }}
          >
            {BASE_MAP_ICONS[baseMap]}
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{baseMap === 'cad' ? 'CAD' : baseMap === 'osm' ? 'OSM' : baseMap === 'googleSatellite' ? 'SAT' : 'MAPS'}</span>
          </button>
          {baseMapOpen && (
            <div
              className="cad-panel-glass animate-fade-in"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 4,
                minWidth: 160,
                padding: 6,
                borderRadius: 6,
                zIndex: 200,
              }}
            >
              {BASE_MAP_DEFS.map((def) => (
                <button
                  key={def.id}
                  onClick={() => { setBaseMap(def.id); setBaseMapOpen(false); }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    border: 'none',
                    background: baseMap === def.id ? 'var(--cad-bg-hover)' : 'transparent',
                    borderRadius: 4,
                    color: baseMap === def.id ? 'var(--cad-accent)' : 'var(--cad-text)',
                    fontSize: '0.7rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {BASE_MAP_ICONS[def.id]}
                  {BASE_MAP_LABELS[def.id]}
                </button>
              ))}
            </div>
          )}
        </div>

        <span style={{ opacity: 0.2, margin: '0 4px' }}>│</span>

        {/* OSNAP — panel unificado: tipos de snap + grilla + master switch (F3) */}
        <SnapPanel />

        <span style={{ opacity: 0.2, margin: '0 4px' }}>│</span>

        {/* Properties Panel */}
        <label
          className="cad-tooltip"
          data-tooltip="Panel de propiedades"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 6px',
            borderRadius: 4,
            background: panelVisibility.properties ? 'var(--cad-bg-active)' : 'transparent',
            border: '1px solid var(--cad-border)',
            color: panelVisibility.properties ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
            fontSize: '0.65rem',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={panelVisibility.properties}
            onChange={(e) => setPanelVisibility('properties', e.target.checked)}
            className="cad-toggle"
            style={{ marginRight: 4 }}
          />
          <IconProperties />
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>Props</span>
        </label>
      </div>

      {/* Right: Zoom controls + zoom level indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {/* Zoom controls (moved from TopBar) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            className="cad-icon-btn cad-tooltip"
            onClick={zoomOut}
            data-tooltip="Alejar (-)"
            aria-label="Alejar"
            title="Alejar"
            style={{ width: 22, height: 22 }}
          >
            <ZoomOut size={12} />
          </button>
          <button
            className="cad-icon-btn cad-tooltip"
            onClick={fitToExtent}
            data-tooltip="Centrar vista (Home)"
            aria-label="Centrar vista"
            title="Centrar vista"
            style={{ width: 22, height: 22 }}
          >
            <Maximize2 size={12} />
          </button>
          <button
            className="cad-icon-btn cad-tooltip"
            onClick={zoomIn}
            data-tooltip="Acercar (+)"
            aria-label="Acercar"
            title="Acercar"
            style={{ width: 22, height: 22 }}
          >
            <ZoomIn size={12} />
          </button>
        </div>

        <span style={{ opacity: 0.2, margin: '0 2px' }}>│</span>

        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 11, height: 11 }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Zoom <span style={{ color: 'var(--cad-accent)' }}>{zoom.toFixed(1)}</span></span>
        </span>
      </div>
    </div>
  );
}