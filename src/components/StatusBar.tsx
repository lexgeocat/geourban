import React, { useState, useRef, useEffect } from 'react';
import { useMapStore } from '../store/mapStore';
import { useLayerStore } from '../store/layerStore';
import { useSnapSettingsStore } from '../store/snapSettingsStore';
import { BASE_MAP_DEFS, type BaseMapId } from '../map/baseMaps';
import { SNAP_LABELS, type SnapType } from '../map/advancedSnap';

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

const IconGrid = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <circle cx="12" cy="12" r="1" />
    <path d="M12 2v4" />
    <path d="M12 18v4" />
    <path d="M2 12h4" />
    <path d="M18 12h4" />
  </svg>
);

const IconSnap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <path d="M15.7 3.7a2.5 2.5 0 0 1 3.5 0l4 4a2.5 2.5 0 0 1 0 3.5l-4 4a2.5 2.5 0 0 1-3.5 0l-4-4a2.5 2.5 0 0 1 0-3.5z" />
    <path d="M8.3 11.3a2.5 2.5 0 0 0 0 3.5l4 4a2.5 2.5 0 0 0 3.5 0l4-4a2.5 2.5 0 0 0 0-3.5l-4-4a2.5 2.5 0 0 0-3.5 0z" />
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

const BASE_MAP_ICONS: Record<BaseMapId, React.ReactNode> = {
  cad: <IconCad />,
  osm: <IconMap />,
};

const BASE_MAP_LABELS: Record<BaseMapId, string> = {
  cad: 'CAD — Grilla',
  osm: 'OpenStreetMap',
};

const SNAP_TYPES: SnapType[] = ['endpoint', 'midpoint', 'nearest', 'perpendicular', 'extension', 'intersection', 'apparentIntersection', 'parallel'];

export default function StatusBar() {
  const coords = useMapStore((s) => s.cursorCoords);
  const zoom = useMapStore((s) => s.zoom);
  const baseMap = useLayerStore((s) => s.baseMap);
  const setBaseMap = useLayerStore((s) => s.setBaseMap);
  const baseVisibility = useLayerStore((s) => s.baseVisibility);
  const setBaseVisibility = useLayerStore((s) => s.setBaseVisibility);
  const panelVisibility = useLayerStore((s) => s.panelVisibility);
  const setPanelVisibility = useLayerStore((s) => s.setPanelVisibility);
  const snapSettings = useSnapSettingsStore((s) => s.settings);
  const toggleSnap = useSnapSettingsStore((s) => s.toggle);
  const anySnapEnabled = Object.values(snapSettings).some((v) => v);

  const [baseMapOpen, setBaseMapOpen] = useState(false);
  const [snapOpen, setSnapOpen] = useState(false);
  const baseMapRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (baseMapRef.current && !baseMapRef.current.contains(e.target as Node)) setBaseMapOpen(false);
      if (snapRef.current && !snapRef.current.contains(e.target as Node)) setSnapOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      {/* Left: coordinates */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
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
              <span style={{ color: 'var(--cad-accent)' }}>X</span> {coords.x.toFixed(4)}
              <span style={{ margin: '0 6px', opacity: 0.3 }}>│</span>
              <span style={{ color: 'var(--cad-accent)' }}>Y</span> {coords.y.toFixed(4)}
            </span>
          ) : (
            <span style={{ opacity: 0.5 }}>— sin posición —</span>
          )}
        </span>
      </div>

      {/* Center: CRS + Base Map + OSNAP + Grid Snap */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, justifyContent: 'center' }}>
        {/* CRS */}
        <span style={{ opacity: 0.6, marginRight: 8 }}>EPSG:3857</span>

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
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{baseMap === 'cad' ? 'CAD' : 'OSM'}</span>
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

        {/* Separator */}
        <span style={{ opacity: 0.2, margin: '0 4px' }}>│</span>

        {/* OSNAP Dropdown */}
        <div ref={snapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => setSnapOpen(!snapOpen)}
            className="cad-icon-btn cad-tooltip"
            data-tooltip="OSNAP — Tipos de snap"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 6px',
              borderRadius: 4,
              background: snapOpen || anySnapEnabled ? 'var(--cad-bg-active)' : 'transparent',
              border: '1px solid var(--cad-border)',
              color: anySnapEnabled ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
              fontSize: '0.65rem',
            }}
          >
            <IconSnap />
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>OSNAP</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 10, height: 10 }}><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {snapOpen && (
            <div
              className="cad-panel-glass animate-fade-in"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 4,
                minWidth: 180,
                padding: 6,
                borderRadius: 6,
                zIndex: 200,
              }}
            >
              <div style={{ padding: '2px 6px 6px', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cad-text-muted)', borderBottom: '1px solid var(--cad-border)', marginBottom: 4 }}>
                Tipos de snap
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {SNAP_TYPES.map((key) => (
                  <label
                    key={key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      padding: '4px 6px',
                      borderRadius: 4,
                      transition: 'background 100ms ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cad-bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <input
                      type="checkbox"
                      checked={snapSettings[key]}
                      onChange={() => toggleSnap(key)}
                      className="cad-toggle"
                    />
                    <span
                      style={{
                        fontSize: '0.7rem',
                        color: snapSettings[key] ? 'var(--cad-text)' : 'var(--cad-text-muted)',
                        textTransform: 'capitalize',
                      }}
                    >
                      {SNAP_LABELS[key]}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Separator */}
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

        {/* Separator */}
        <span style={{ opacity: 0.2, margin: '0 4px' }}>│</span>

        {/* Grid Snap */}
        <label
          className="cad-tooltip"
          data-tooltip="Snap a grilla"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 6px',
            borderRadius: 4,
            background: baseVisibility.gridSnap ? 'var(--cad-bg-active)' : 'transparent',
            border: '1px solid var(--cad-border)',
            color: baseVisibility.gridSnap ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
            fontSize: '0.65rem',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={baseVisibility.gridSnap}
            onChange={(e) => setBaseVisibility('gridSnap', e.target.checked)}
            className="cad-toggle"
            style={{ marginRight: 4 }}
          />
          <IconGrid />
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>Grilla</span>
        </label>
      </div>

      {/* Right: zoom */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 11, height: 11 }}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>Zoom <span style={{ color: 'var(--cad-accent)' }}>{zoom.toFixed(1)}</span></span>
      </div>
    </div>
  );
}
