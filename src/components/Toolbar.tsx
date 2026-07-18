import React from 'react';
import { useDrawStore, type DrawMode } from '../store/drawStore';
import { useCommandStack, undo, redo } from '../commands/CommandStack';
import { useMapStore } from '../store/mapStore';
import { useSelectionStore } from '../store/selectionStore';
import { useSubdivisionStore } from '../store/subdivisionStore';
import { useStreetStore } from '../store/streetStore';
import { GenerateLotsCommand } from '../commands/GenerateLotsCommand';

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

const IconEdit = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
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

const IconLots = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="2" width="9" height="9" rx="1" />
    <rect x="13" y="2" width="9" height="9" rx="1" />
    <rect x="2" y="13" width="9" height="9" rx="1" />
    <rect x="13" y="13" width="9" height="9" rx="1" />
  </svg>
);

const IconStreet = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 19L8 5" />
    <path d="M16 5l4 14" />
    <path d="M6 10h12" />
    <path d="M5 14h14" />
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
    <line x1="4" y1="20" x2="20" y2="4" />
  </svg>
);

const IconRect = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="4" y="6" width="16" height="12" />
  </svg>
);

const IconCircle = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="8" />
  </svg>
);

const IconArc = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 18 A10 10 0 0 1 20 10" />
  </svg>
);

const IconText = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
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
];

const drawTools: ToolDef[] = [
  { mode: 'polygon', icon: <IconPolygon />, tooltip: 'Dibujar polígono', shortcut: 'P' },
  { mode: 'line', icon: <IconLine />, tooltip: 'Dibujar línea', shortcut: 'L' },
  { mode: 'rectangle', icon: <IconRect />, tooltip: 'Dibujar rectángulo', shortcut: 'R' },
  { mode: 'circle', icon: <IconCircle />, tooltip: 'Dibujar círculo', shortcut: 'C' },
  { mode: 'arc', icon: <IconArc />, tooltip: 'Dibujar arco (3 clicks)', shortcut: 'A' },
  { mode: 'text', icon: <IconText />, tooltip: 'Insertar texto', shortcut: 'X' },
  { mode: 'street', icon: <IconStreet />, tooltip: 'Trazar calle (2 clicks)', shortcut: 'S' },
  { mode: 'erase', icon: <IconEraser />, tooltip: 'Borrar features (click)', shortcut: 'E' },
];

/* ─── Street Width Panel ─── */

function StreetWidthPanel() {
  const defaultWidthM = useStreetStore((s) => s.defaultWidthM);
  const setDefaultWidth = useStreetStore((s) => s.setDefaultWidth);
  const streets = useStreetStore((s) => s.streets);
  const clearStreets = useStreetStore((s) => s.clearStreets);

  return (
    <div
      className="cad-panel-glass"
      style={{
        position: 'absolute',
        left: 56,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 101,
        padding: '10px 12px',
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--cad-text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Ancho de vía
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <input
          type="number"
          value={defaultWidthM}
          min={1}
          max={50}
          step={1}
          onChange={(e) => setDefaultWidth(parseFloat(e.target.value) || 8)}
          style={{
            width: 60,
            padding: '4px 6px',
            background: 'var(--cad-bg-deepest)',
            border: '1px solid var(--cad-border)',
            borderRadius: 4,
            color: 'var(--cad-text)',
            fontSize: '0.75rem',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        />
        <span style={{ fontSize: '0.7rem', color: 'var(--cad-text-muted)' }}>m</span>
      </div>
      {streets.length > 0 && (
        <>
          <div style={{ fontSize: '0.65rem', color: 'var(--cad-text-muted)', marginBottom: 4 }}>
            {streets.length} calle{streets.length > 1 ? 's' : ''} trazada{streets.length > 1 ? 's' : ''}
          </div>
          <button
            onClick={clearStreets}
            className="cad-icon-btn"
            style={{
              width: '100%',
              height: 'auto',
              padding: '4px 8px',
              fontSize: '0.65rem',
              color: 'var(--cad-accent-red)',
            }}
          >
            Limpiar calles
          </button>
        </>
      )}
    </div>
  );
}

/* ─── Component ─── */

export default function Toolbar() {
  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);
  const canUndo = useCommandStack((s) => s.canUndo);
  const canRedo = useCommandStack((s) => s.canRedo);
  const selectedCount = useSelectionStore((s) => s.selectedIds.size);
  const primarySelected = useSelectionStore((s) => s.primaryId !== null);
  const openSubdivision = useSubdivisionStore((s) => s.open);
  const [mergeBusy, setMergeBusy] = React.useState(false);
  const [lotsBusy, setLotsBusy] = React.useState(false);

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
    undo();
  };

  const handleRedo = () => {
    redo();
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

  const handleGenerateLots = async () => {
    if (lotsBusy) return;
    const src = useMapStore.getState().drawSource;
    if (!src) return;

    // Encontrar todos los manzanos
    let manzanoCount = 0;
    src.forEachFeature((f) => {
      if (f.get('type') === 'manzana') manzanoCount++;
    });

    if (manzanoCount === 0) {
      alert('No hay manzanos para subdividir. Trazá calles primero para generar manzanos.');
      return;
    }

    setLotsBusy(true);
    try {
      const targetAreaM2 = 250;
      const frontMinM = 12;

      const result = await useCommandStack
        .getState()
        .run(new GenerateLotsCommand({ targetAreaM2, frontMinM }));

      if (!result.ok) {
        alert(result.error);
        return;
      }

      // El comando no devuelve el conteo (es fire-and-forget). Lo
      // recalculamos rápido contando los nuevos features con kind=lote.
      let newLotes = 0;
      src.forEachFeature((f) => {
        const k = (f.get('kind') as string | undefined) ?? (f.get('type') as string | undefined);
        if (k === 'lote' || (typeof f.get('label') === 'string' && f.get('label')?.toString().startsWith('Lote'))) {
          newLotes++;
        }
      });

      if (newLotes > 0) {
        alert(`${newLotes} lotes generados automáticamente.`);
      } else {
        alert('No se pudieron generar lotes. Verificá que los manzanos sean lo suficientemente grandes.');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al generar lotes');
    } finally {
      setLotsBusy(false);
    }
  };

  const handleToggleEdit = () => {
    if (mode === 'edit') {
      setMode('select');
      return;
    }
    const primaryId = useSelectionStore.getState().primaryId;
    if (!primaryId) {
      alert('Seleccioná un polígono para editar sus vértices.');
      return;
    }
    setMode('edit');
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

      {/* Fusionar / Subdividir / Editar */}
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
      <button
        onClick={handleGenerateLots}
        disabled={lotsBusy}
        className={`cad-icon-btn cad-tooltip ${lotsBusy ? 'disabled' : ''}`}
        data-tooltip={lotsBusy ? 'Generando lotes...' : 'Generar lotes automáticos (todos los manzanos)'}
        aria-label="Generar lotes automáticos"
      >
        <IconLots />
      </button>
      <button
        onClick={handleToggleEdit}
        disabled={!primarySelected}
        className={`cad-icon-btn cad-tooltip ${mode === 'edit' ? 'active' : ''} ${!primarySelected ? 'disabled' : ''}`}
        data-tooltip={
          mode === 'edit'
            ? 'Salir de edición (Esc)'
            : 'Editar vértices del seleccionado'
        }
        aria-label="Editar vértices"
      >
        <IconEdit />
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

      {/* Panel de ancho de vía (solo en modo street) */}
      {mode === 'street' && (
        <StreetWidthPanel />
      )}
    </div>
  );
}
