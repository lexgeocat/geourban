import React from 'react';
import { useMapStore } from '../store/mapStore';

export default function StatusBar() {
  const coords = useMapStore((s) => s.cursorCoords);
  const zoom = useMapStore((s) => s.zoom);

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
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ width: 11, height: 11 }}
          >
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

      {/* Center: CRS */}
      <span style={{ opacity: 0.6 }}>EPSG:3857</span>

      {/* Right: zoom */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ width: 11, height: 11 }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>
          Zoom <span style={{ color: 'var(--cad-accent)' }}>{zoom.toFixed(1)}</span>
        </span>
      </div>
    </div>
  );
}
