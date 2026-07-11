import React from 'react';
import { useDrawStore, type DrawMode } from '../store/drawStore';
import { useHistoryStore } from '../store/historyStore';
import { useMapStore } from '../store/mapStore';
import { useSelectionStore } from '../store/selectionStore';
import { useSubdivisionStore } from '../store/subdivisionStore';

/* ─── SVG Icon Components (inline, no dependencies) ─── */

const IconCursor = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    <path d="M13 13l6 6" />
  </svg>
);

const IconPan = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
);

const IconPolygon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2l8.5 6.2-3.2 9.8H6.7L3.5 8.2z" />
  </svg>
);

const IconLine = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="5" cy="19" r="2" />
    <circle cx="19" cy="5" r="2" />
    <line x1="6.4" y1="17.6" x2="17.6" y2="6.4" />
  </svg>
);

const IconEraser = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </svg>
);

const IconUndo = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </svg>
);

const IconRedo = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
  </svg>
);

const IconTrash = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const IconMerge = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 3v3a4 4 0 0 0 4 4 4 4 0 0 1 4 4v3" />
    <path d="M4 7h4" />
    <path d="M16 17h4" />
    <path d="m19 14 2 3-2 3" />
    <path d="m5 4-2 3 2 3" />
  </svg>
);

const IconSubdivide = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);

/* ─── Tool definitions ─── */

type ToolDef = {
  mode: DrawMode;
  icon: React.ReactNode;
  tooltip: string;
  shortcut?: string;
};

const navTools: ToolDef[] = [
  { mode: 'select', icon: <IconCursor />, tooltip: 'Seleccionar', shortcut: 'V' },
  { mode: 'pan', icon: <IconPan />, tooltip: 'Mover mapa', shortcut: 'H' },
];

const drawTools: ToolDef[] = [
  { mode: 'polygon', icon: <IconPolygon />, tooltip: 'Dibujar polígono', shortcut: 'P' },
  { mode: 'line', icon: <IconLine />, tooltip: 'Dibujar línea', shortcut: 'L' },
  { mode: 'erase', icon: <IconEraser />, tooltip: 'Borrar features (click)', shortcut: 'E' },
];

/* ─── Component ─── */

export default function Toolbar() {
  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const selectedCount = useSelectionStore((s) => s.selectedIds.size);
  const primarySelected = useSelectionStore((s) => s.primaryId !== null);
  const openSubdivision = useSubdivisionStore((s) => s.open);
  const [mergeBusy, setMergeBusy] = React.useState(false);

  const renderTool = (tool: ToolDef) => {
    const tip = tool.shortcut ? `${tool.tooltip} (${tool.shortcut})` : tool.tooltip;
    return (
      <button
        key={tool.mode}
        onClick={() => setMode(tool.mode)}
        className={`cad-icon-btn cad-tooltip ${mode === tool.mode ? 'active' : ''}`}
        data-tooltip={tip}
        aria-label={tip}
      >
        {tool.icon}
      </button>
    );
  };

  const handleUndo = () => {
    const state = useHistoryStore.getState().undo();
    if (state) {
      useMapStore.getState().restoreDrawFeatures(state);
    }
  };

  const handleRedo = () => {
    const state = useHistoryStore.getState().redo();
    if (state) {
      useMapStore.getState().restoreDrawFeatures(state);
    }
  };

  const handleDeleteSelected = () => {
    const removed = useMapStore.getState().deleteSelected();
    if (removed === 0 && primarySelected) {
      useSelectionStore.getState().clear();
    }
  };

  const handleMergeSelected = async () => {
    if (mergeBusy) return;
    setMergeBusy(true);
    try {
      const newId = await useMapStore.getState().mergeSelected();
      if (newId) {
        // Seleccionar el feature resultante
        useSelectionStore.getState().setSelection([newId], newId);
      } else {
        alert('Necesitás seleccionar al menos 2 polígonos contiguos para fusionar.');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al fusionar');
    } finally {
      setMergeBusy(false);
    }
  };

  const handleOpenSubdivision = () => {
    const primaryId = useSelectionStore.getState().primaryId;
    if (!primaryId) {
      alert('Seleccioná un polígono para subdividir.');
      return;
    }
    openSubdivision(primaryId);
  };

  const tooltip = (txt: string, suffix = ' (Del)') => `${txt}${suffix}`;

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

      <div className="cad-separator" />

      {/* Fusionar / Subdividir */}
      <button
        onClick={handleMergeSelected}
        disabled={selectedCount < 2 || mergeBusy}
        className={`cad-icon-btn cad-tooltip ${selectedCount < 2 || mergeBusy ? 'disabled' : ''}`}
        data-tooltip={
          selectedCount < 2
            ? 'Fusionar (selecciona 2+ polígonos)'
            : `Fusionar ${selectedCount} polígonos`
        }
        aria-label="Fusionar selección"
      >
        <IconMerge />
      </button>
      <button
        onClick={handleOpenSubdivision}
        disabled={!primarySelected}
        className={`cad-icon-btn cad-tooltip ${!primarySelected ? 'disabled' : ''}`}
        data-tooltip="Subdividir selección"
        aria-label="Subdividir selección"
      >
        <IconSubdivide />
      </button>

      <div className="cad-separator" />

      {/* Borrar seleccion (solo si hay algo seleccionado) */}
      <button
        onClick={handleDeleteSelected}
        disabled={selectedCount === 0}
        className={`cad-icon-btn cad-tooltip ${selectedCount === 0 ? 'disabled' : ''}`}
        data-tooltip={
          selectedCount > 0
            ? tooltip(`Borrar ${selectedCount} seleccionado${selectedCount > 1 ? 's' : ''}`)
            : 'Borrar seleccionados'
        }
        aria-label="Borrar seleccionados"
        style={{ position: 'relative' }}
      >
        <IconTrash />
        {selectedCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 14,
              height: 14,
              padding: '0 3px',
              borderRadius: 7,
              background: 'var(--cad-accent-red)',
              color: '#fff',
              fontSize: '0.55rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            {selectedCount}
          </span>
        )}
      </button>

      <div className="cad-separator" />

      {/* Undo / Redo */}
      <button
        onClick={handleUndo}
        disabled={!canUndo}
        className={`cad-icon-btn cad-tooltip ${!canUndo ? 'disabled' : ''}`}
        data-tooltip="Deshacer (Ctrl+Z)"
        aria-label="Deshacer"
      >
        <IconUndo />
      </button>
      <button
        onClick={handleRedo}
        disabled={!canRedo}
        className={`cad-icon-btn cad-tooltip ${!canRedo ? 'disabled' : ''}`}
        data-tooltip="Rehacer (Ctrl+Y)"
        aria-label="Rehacer"
      >
        <IconRedo />
      </button>
    </div>
  );
}
