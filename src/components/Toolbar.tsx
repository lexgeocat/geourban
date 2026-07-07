import React from 'react';
import { useDrawStore, type DrawMode } from '../store/drawStore';

/* ─── SVG Icon Components (inline, no dependencies) ─── */

const IconCursor = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    <path d="M13 13l6 6" />
  </svg>
);

const IconPan = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
);

const IconPolygon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l8.5 6.2-3.2 9.8H6.7L3.5 8.2z" />
  </svg>
);

const IconLine = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="19" r="2" />
    <circle cx="19" cy="5" r="2" />
    <line x1="6.4" y1="17.6" x2="17.6" y2="6.4" />
  </svg>
);

const IconEraser = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </svg>
);

/* ─── Tool definitions ─── */

type ToolDef = {
  mode: DrawMode;
  icon: React.ReactNode;
  tooltip: string;
};

const navTools: ToolDef[] = [
  { mode: 'select', icon: <IconCursor />, tooltip: 'Seleccionar (V)' },
  { mode: 'pan',    icon: <IconPan />,    tooltip: 'Mover mapa (H)' },
];

const drawTools: ToolDef[] = [
  { mode: 'polygon', icon: <IconPolygon />, tooltip: 'Dibujar Polígono (P)' },
  { mode: 'line',    icon: <IconLine />,    tooltip: 'Dibujar Línea (L)' },
  { mode: 'none',    icon: <IconEraser />,  tooltip: 'Parar dibujo (Esc)' },
];

/* ─── Component ─── */

export default function Toolbar() {
  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);

  const renderTool = (tool: ToolDef) => (
    <button
      key={tool.mode}
      onClick={() => setMode(tool.mode)}
      className={`cad-icon-btn cad-tooltip ${mode === tool.mode ? 'active' : ''}`}
      data-tooltip={tool.tooltip}
      aria-label={tool.tooltip}
    >
      {tool.icon}
    </button>
  );

  return (
    <div
      className="cad-panel-glass animate-fade-in"
      style={{
        position: 'absolute',
        left: 10,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 6px',
        gap: '2px',
      }}
    >
      {/* Navigation tools */}
      {navTools.map(renderTool)}

      <div className="cad-separator" />

      {/* Drawing tools */}
      {drawTools.map(renderTool)}
    </div>
  );
}
