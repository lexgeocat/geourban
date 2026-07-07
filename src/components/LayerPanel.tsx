import React, { useState } from 'react';
import { useLayerStore } from '../store/layerStore';

/* ─── Icons ─── */

const IconLayers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      width: 14,
      height: 14,
      transition: 'transform 150ms ease',
      transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
    }}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const IconMap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

const IconSatellite = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
    <path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13" />
    <path d="M11 17l4.3 4.3a2.41 2.41 0 0 0 3.4 0l2.6-2.6a2.41 2.41 0 0 0 0-3.4L17 11" />
    <path d="M8 11l4 4" />
    <path d="m16 8-1.5-1.5" />
    <path d="M2 22l4.5-4.5" />
  </svg>
);

/* ─── Layer options config ─── */

type LayerOption = {
  key: 'osm' | 'satellite';
  label: string;
  icon: React.ReactNode;
};

const layerOptions: LayerOption[] = [
  { key: 'osm',       label: 'OpenStreetMap',  icon: <IconMap /> },
  { key: 'satellite',  label: 'Topográfico',   icon: <IconSatellite /> },
];

/* ─── Component ─── */

export default function LayerPanel() {
  const [open, setOpen] = useState(true);
  const visibility = useLayerStore((s) => s.visibility);
  const setVisibility = useLayerStore((s) => s.setVisibility);

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 100,
        minWidth: open ? 200 : 'auto',
      }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="cad-icon-btn cad-tooltip"
        data-tooltip="Capas"
        style={{
          marginLeft: 'auto',
          display: 'flex',
          marginBottom: open ? 6 : 0,
          background: open ? 'var(--cad-bg-active)' : 'rgba(26, 34, 54, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--cad-border)',
          color: open ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
        }}
      >
        <IconLayers />
      </button>

      {/* Panel body */}
      {open && (
        <div className="cad-panel-glass animate-fade-in" style={{ padding: '10px 12px' }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
              paddingBottom: 8,
              borderBottom: '1px solid var(--cad-border)',
            }}
          >
            <span style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cad-text-dim)' }}>
              Capas
            </span>
          </div>

          {/* Layer toggles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {layerOptions.map((opt) => (
              <label
                key={opt.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '4px 6px',
                  borderRadius: 6,
                  transition: 'background 150ms ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cad-bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <input
                  type="checkbox"
                  checked={visibility[opt.key]}
                  onChange={(e) => setVisibility(opt.key, e.target.checked)}
                  className="cad-toggle"
                />
                <span style={{ color: 'var(--cad-text-dim)', display: 'flex', alignItems: 'center' }}>
                  {opt.icon}
                </span>
                <span style={{ fontSize: '0.75rem', color: visibility[opt.key] ? 'var(--cad-text)' : 'var(--cad-text-muted)' }}>
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
