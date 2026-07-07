import React from 'react';
import { useMapStore } from '../store/mapStore';
import { useDrawStore } from '../store/drawStore';

/* ─── Icons ─── */

const IconZoomIn = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const IconZoomOut = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

/* ─── Mode label map ─── */
const modeLabels: Record<string, { label: string; color: string }> = {
  select:  { label: 'SELECCIÓN',   color: 'var(--cad-text-dim)' },
  pan:     { label: 'MOVER',       color: 'var(--cad-text-dim)' },
  polygon: { label: 'POLÍGONO',    color: 'var(--cad-accent)' },
  line:    { label: 'LÍNEA',       color: 'var(--cad-accent)' },
  none:    { label: 'INACTIVO',    color: 'var(--cad-text-muted)' },
};

/* ─── Component ─── */

export default function TopBar() {
  const zoomIn = useMapStore((s) => s.zoomIn);
  const zoomOut = useMapStore((s) => s.zoomOut);
  const mode = useDrawStore((s) => s.mode);
  const modeInfo = modeLabels[mode] || modeLabels.none;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 'var(--cad-topbar-height)',
        background: 'var(--cad-bg-deep)',
        borderBottom: '1px solid var(--cad-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        zIndex: 100,
      }}
    >
      {/* Left: Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Logo mark */}
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: 'linear-gradient(135deg, var(--cad-accent), var(--cad-accent-violet))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 10px rgba(0, 212, 255, 0.3)',
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
          </svg>
        </div>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--cad-text)' }}>
          Geo<span style={{ color: 'var(--cad-accent)' }}>Urban</span>
        </span>

        {/* Separator */}
        <div style={{ width: 1, height: 16, background: 'var(--cad-border)', margin: '0 4px' }} />

        {/* Active tool badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            borderRadius: 4,
            background: 'var(--cad-bg-surface)',
            border: '1px solid var(--cad-border)',
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: modeInfo.color,
              boxShadow: mode === 'polygon' || mode === 'line' ? '0 0 6px var(--cad-accent)' : 'none',
            }}
          />
          <span
            className="font-mono-cad"
            style={{
              fontSize: '0.6rem',
              fontWeight: 500,
              letterSpacing: '0.08em',
              color: modeInfo.color,
            }}
          >
            {modeInfo.label}
          </span>
        </div>
      </div>

      {/* Right: Zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button
          onClick={zoomOut}
          className="cad-icon-btn cad-tooltip-bottom cad-tooltip"
          data-tooltip="Alejar"
          aria-label="Alejar"
          style={{ width: 28, height: 28 }}
        >
          <IconZoomOut />
        </button>
        <button
          onClick={zoomIn}
          className="cad-icon-btn cad-tooltip-bottom cad-tooltip"
          data-tooltip="Acercar"
          aria-label="Acercar"
          style={{ width: 28, height: 28 }}
        >
          <IconZoomIn />
        </button>
      </div>
    </div>
  );
}
