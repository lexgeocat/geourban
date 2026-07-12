import React, { useState } from 'react';
import { useLayerStore } from '../store/layerStore';
import { BASE_MAP_DEFS } from '../map/baseMaps';
import type { BaseMapId } from '../map/baseMaps';
import TopologyValidator from './TopologyValidator';

/* ─── Icons ─── */

const IconLayers = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
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

/* ─── Iconos de mapas base inline ─── */

const IconMap = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: 14, height: 14 }}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

const IconCad = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: 14, height: 14 }}
  >
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </svg>
);

const BASE_MAP_ICONS: Record<BaseMapId, React.ReactNode> = {
  cad: <IconCad />,
  osm: <IconMap />,
  'esri-sat': <IconMap />,
  'carto-light': <IconMap />,
  'carto-dark': <IconMap />,
};

/* ─── Component ─── */

export default function LayerPanel() {
  const [open, setOpen] = useState(true);
  const baseMap = useLayerStore((s) => s.baseMap);
  const setBaseMap = useLayerStore((s) => s.setBaseMap);
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
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--cad-text-dim)',
              }}
            >
              Capas
            </span>
          </div>

          {/* Mapa base: radio buttons (solo uno activo) */}
          <span
            style={{
              fontSize: '0.6rem',
              fontWeight: 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--cad-text-muted)',
              marginBottom: 6,
              display: 'block',
            }}
          >
            Mapa base
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            {BASE_MAP_DEFS.map((def) => (
              <label
                key={def.id}
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
                  type="radio"
                  name="baseMap"
                  checked={baseMap === def.id}
                  onChange={() => setBaseMap(def.id)}
                  className="cad-radio"
                />
                <span
                  style={{ color: 'var(--cad-text-dim)', display: 'flex', alignItems: 'center' }}
                >
                  {BASE_MAP_ICONS[def.id]}
                </span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: baseMap === def.id ? 'var(--cad-text)' : 'var(--cad-text-muted)',
                  }}
                >
                  {def.label}
                </span>
              </label>
            ))}
          </div>

          {/* Capas de trabajo (overlays) */}
          <span
            style={{
              fontSize: '0.6rem',
              fontWeight: 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--cad-text-muted)',
              marginBottom: 6,
              display: 'block',
            }}
          >
            Capas de trabajo
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
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
                checked={visibility.measurements}
                onChange={(e) => setVisibility('measurements', e.target.checked)}
                className="cad-toggle"
              />
              <span style={{ color: 'var(--cad-text-dim)', display: 'flex', alignItems: 'center' }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ width: 14, height: 14 }}
                >
                  <path d="M4 19h16" />
                  <path d="M6 16V8" />
                  <path d="M18 16V8" />
                  <path d="M6 12h12" />
                  <path d="m8 10-2 2 2 2" />
                  <path d="m16 10 2 2-2 2" />
                </svg>
              </span>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: visibility.measurements ? 'var(--cad-text)' : 'var(--cad-text-muted)',
                }}
              >
                Cotas automáticas
              </span>
            </label>
            <label
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
                checked={visibility.gridSnap}
                onChange={(e) => setVisibility('gridSnap', e.target.checked)}
                className="cad-toggle"
              />
              <span style={{ color: 'var(--cad-text-dim)', display: 'flex', alignItems: 'center' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                  <circle cx="12" cy="12" r="1" />
                  <path d="M12 2v4" />
                  <path d="M12 18v4" />
                  <path d="M2 12h4" />
                  <path d="M18 12h4" />
                </svg>
              </span>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: visibility.gridSnap ? 'var(--cad-text)' : 'var(--cad-text-muted)',
                }}
              >
                Snap a grilla
              </span>
            </label>
          </div>

          <TopologyValidator />
        </div>
      )}
    </div>
  );
}
