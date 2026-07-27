import React, { useState, useRef, useEffect } from 'react';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { LayerKind } from '../../core/objectModel';
import { useDisplayLayersStore, type OverlayLayerId } from '../../store/ui/displayLayersStore';
import { useLayerPickerStore } from '../../store/ui/layerPickerStore';
import { useIncrementalRender } from '../../hooks/useIncrementalRender';
import { manzanoDisplayColor } from '../../geo/manzanoColor';
import LayerDeleteModal, { type LayerDeleteRequest } from '../modals/LayerDeleteModal';
import AddLayerModal from '../modals/AddLayerModal';
import { runCommand } from '../../commands/core/CommandStack';
import { UpdateLayerCommand } from '../../commands/layers/UpdateLayerCommand';
import { ReorderLayersCommand } from '../../commands/layers/ReorderLayersCommand';

/* ─────────── Icons ─────────── */

const IconLayers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11, transition: 'transform 150ms ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const IconEye = ({ visible }: { visible: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={visible ? '2' : '1.5'} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13, opacity: visible ? 1 : 0.4, cursor: 'pointer', transition: 'opacity 150ms ease' }}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconLock = ({ locked }: { locked: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12, opacity: locked ? 1 : 0.3, cursor: 'pointer', transition: 'opacity 150ms ease' }}>
    {locked ? (
      <>
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ) : (
      <>
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
      </>
    )}
  </svg>
);

const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

const IconGear = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconGrip = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 10, height: 10 }}>
    <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
    <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
    <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
  </svg>
);

const IconChevronSmall = ({ dir }: { dir: 'up' | 'down' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 9, height: 9 }}>
    {dir === 'up' ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
  </svg>
);

/* ─────────── Color Picker ─────────── */

function ColorDot({ color, onChange, title }: { color: string; onChange: (c: string) => void; title?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span
      onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
      title={title}
      style={{
        width: 12, height: 12, borderRadius: 3, background: color,
        border: '1.5px solid rgba(255,255,255,0.25)', cursor: 'pointer',
        display: 'inline-block', flexShrink: 0,
      }}
    >
      <input
        ref={inputRef}
        type="color"
        value={color.startsWith('#') ? color : '#58a6ff'}
        onChange={(e) => { e.stopPropagation(); onChange(e.target.value); }}
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
      />
    </span>
  );
}

/* ─────────── Opacity slider ─────────── */

function OpacitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range" min={0} max={1} step={0.05} value={value}
      onChange={(e) => { e.stopPropagation(); onChange(Number.parseFloat(e.target.value)); }}
      onClick={(e) => e.stopPropagation()}
      style={{ width: 46, height: 3, accentColor: 'var(--cad-accent)', cursor: 'pointer', opacity: 0.8 }}
    />
  );
}

/* ─────────── Fila genérica de capa ─────────── */

interface LayerRowData {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  strokeColor: string;
  fillColor: string;
  showLabel: boolean;
  showCota: boolean;
  editableName: boolean;
  removable: boolean;
  lockable: boolean;
  locked?: boolean;
  /** Oculta el toggle "Mostrar acotación" del menú engranaje (ej: Vértices). */
  hideCota?: boolean;
  kind: LayerKind;
  colorMode: 'solid' | 'colorIdx';
  /** Fase 5: solo las filas del registro participan del orden de dibujo
   *  real (drag&drop + botones subir/bajar). Los overlays computados
   *  (Urbanización/Georreferenciado/Vértices) no tienen zIndex propio. */
  reorderable: boolean;
  onToggleVisible: () => void;
  onOpacity: (v: number) => void;
  onStrokeColor: (c: string) => void;
  onFillColor: (c: string) => void;
  onShowLabel: (v: boolean) => void;
  onShowCota: (v: boolean) => void;
  onSetColorMode: (mode: 'solid' | 'colorIdx') => void;
  onRename?: (name: string) => void;
  onToggleLock?: () => void;
  onRemove?: () => void;
}

const gearLabelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px',
  fontSize: '0.68rem', color: 'var(--cad-text-dim)', cursor: 'pointer', whiteSpace: 'nowrap',
};

function LayerRow({
  data, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onDragHandleStart, onDragHandleEnd,
}: {
  data: LayerRowData;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onDragHandleStart?: () => void;
  onDragHandleEnd?: () => void;
}) {
  const [gearOpen, setGearOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(data.name);
  const gearRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gearOpen) return;
    const onClick = (e: MouseEvent) => {
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) setGearOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [gearOpen]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: 4 }}>
      {data.reorderable && (
        <>
          <span
            draggable
            onDragStart={(e) => { e.stopPropagation(); onDragHandleStart?.(); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={onDragHandleEnd}
            title="Arrastrar para reordenar"
            aria-label={`Reordenar capa ${data.name}`}
            style={{ display: 'flex', color: 'var(--cad-text-muted)', cursor: 'grab', touchAction: 'none' }}
          >
            <IconGrip />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
              disabled={!canMoveUp}
              aria-label={`Subir capa ${data.name} (dibujar encima)`}
              title="Subir (dibujar encima)"
              style={{ background: 'none', border: 'none', padding: 0, height: 9, display: 'flex', alignItems: 'center', cursor: canMoveUp ? 'pointer' : 'default', opacity: canMoveUp ? 0.75 : 0.2, color: 'var(--cad-text-dim)' }}
            >
              <IconChevronSmall dir="up" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
              disabled={!canMoveDown}
              aria-label={`Bajar capa ${data.name} (dibujar debajo)`}
              title="Bajar (dibujar debajo)"
              style={{ background: 'none', border: 'none', padding: 0, height: 9, display: 'flex', alignItems: 'center', cursor: canMoveDown ? 'pointer' : 'default', opacity: canMoveDown ? 0.75 : 0.2, color: 'var(--cad-text-dim)' }}
            >
              <IconChevronSmall dir="down" />
            </button>
          </div>
        </>
      )}

      <span onClick={data.onToggleVisible} style={{ display: 'flex', cursor: 'pointer' }}>
        <IconEye visible={data.visible} />
      </span>

      <ColorDot color={data.strokeColor} onChange={data.onStrokeColor} title="Color de contorno" />
      <ColorDot color={data.fillColor} onChange={data.onFillColor} title="Color de relleno" />

      {data.editableName && editingName ? (
        <input
          autoFocus
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => { data.onRename?.(nameDraft.trim() || data.name); setEditingName(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditingName(false);
          }}
          onClick={(e) => e.stopPropagation()}
          style={{ flex: 1, fontSize: '0.72rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--cad-border)', borderRadius: 3, padding: '1px 4px', color: 'var(--cad-text)', outline: 'none', minWidth: 0 }}
        />
      ) : (
        <span
          onDoubleClick={() => { if (data.editableName) { setNameDraft(data.name); setEditingName(true); } }}
          style={{ flex: 1, fontSize: '0.72rem', color: data.visible ? 'var(--cad-text)' : 'var(--cad-text-muted)', userSelect: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
        >
          {data.name}
        </span>
      )}

      <OpacitySlider value={data.opacity} onChange={data.onOpacity} />

      <div ref={gearRef} style={{ position: 'relative', display: 'flex' }}>
        <span onClick={() => setGearOpen((v) => !v)} style={{ cursor: 'pointer', opacity: gearOpen ? 1 : 0.55, display: 'flex' }}>
          <IconGear />
        </span>
        {gearOpen && (
          <div
            className="cad-panel-glass animate-fade-in"
            style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 190, padding: 8, borderRadius: 6, zIndex: 300 }}
          >
            <label style={gearLabelStyle}>
              <input type="checkbox" className="cad-toggle" checked={data.showLabel} onChange={(e) => data.onShowLabel(e.target.checked)} />
              Mostrar etiqueta
            </label>
            {!data.hideCota && (
              <label style={gearLabelStyle}>
                <input type="checkbox" className="cad-toggle" checked={data.showCota} onChange={(e) => data.onShowCota(e.target.checked)} />
                Mostrar acotación
              </label>
            )}
            {data.kind === 'manzana' && (
              <div style={{ borderTop: '1px solid var(--cad-border)', marginTop: 6, paddingTop: 6 }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--cad-text-muted)', marginBottom: 4 }}>Color de manzanos</div>
                <label style={{ ...gearLabelStyle, padding: '2px 0' }}>
                  <input type="radio" name={`cm-${data.id}`} className="cad-toggle" checked={data.colorMode === 'solid'} onChange={() => data.onSetColorMode('solid')} />
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: data.strokeColor, flexShrink: 0 }} />
                  Sólido (capa)
                </label>
                <label style={{ ...gearLabelStyle, padding: '2px 0' }}>
                  <input type="radio" name={`cm-${data.id}`} className="cad-toggle" checked={data.colorMode === 'colorIdx'} onChange={() => data.onSetColorMode('colorIdx')} />
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: manzanoDisplayColor(0), flexShrink: 0 }} />
                  Por manzano
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {data.lockable && (
        <span onClick={data.onToggleLock} style={{ display: 'flex', cursor: 'pointer' }}>
          <IconLock locked={!!data.locked} />
        </span>
      )}
      {data.removable && (
        <span onClick={data.onRemove} style={{ cursor: 'pointer', opacity: 0.4, display: 'flex' }}>
          <IconTrash />
        </span>
      )}
    </div>
  );
}

/* ─────────── Adaptadores de cada store ─────────── */

const NON_REMOVABLE = new Set(['lots', 'manzanas', 'streets', 'equipment', 'greenareas']);

function useRegistryRows(onRequestRemove: (request: LayerDeleteRequest) => void): Array<LayerRowData & { zIndex: number }> {
  const layers = useLayersStore((s) => s.layers);

  return layers.map((l): LayerRowData & { zIndex: number } => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    strokeColor: l.color,
    fillColor: l.fillColor ?? l.color,
    showLabel: l.showLabel,
    showCota: l.showCota,
    editableName: true,
    removable: !NON_REMOVABLE.has(l.id),
    lockable: true,
    locked: l.locked,
    kind: l.kind,
    colorMode: l.colorMode,
    reorderable: true,
    zIndex: l.zIndex,
    onToggleVisible: () => void runCommand(new UpdateLayerCommand(l.id, { visible: !l.visible }, 'Visibilidad de capa')),
    onOpacity: (v) => void runCommand(new UpdateLayerCommand(l.id, { opacity: v }, 'Opacidad de capa')),
    onStrokeColor: (c) => void runCommand(new UpdateLayerCommand(l.id, { color: c }, 'Color de capa')),
    onFillColor: (c) => void runCommand(new UpdateLayerCommand(l.id, { fillColor: c }, 'Color de relleno de capa')),
    onShowLabel: (v) => void runCommand(new UpdateLayerCommand(l.id, { showLabel: v }, 'Mostrar etiqueta de capa')),
    onShowCota: (v) => void runCommand(new UpdateLayerCommand(l.id, { showCota: v }, 'Mostrar acotación de capa')),
    onSetColorMode: (mode) => void runCommand(new UpdateLayerCommand(l.id, { colorMode: mode }, 'Modo de color de capa')),
    onRename: (name) => void runCommand(new UpdateLayerCommand(l.id, { name }, 'Renombrar capa')),
    onToggleLock: () => void runCommand(new UpdateLayerCommand(l.id, { locked: !l.locked }, 'Bloqueo de capa')),
    onRemove: () => onRequestRemove({ id: l.id, name: l.name }),
  }));
}

const OVERLAY_LABELS: Record<OverlayLayerId, string> = {
  urbanizacion: 'Urbanización',
  georreferenciado: 'Georreferenciado',
  vertices: 'Vértices',
};

function useOverlayRows(): LayerRowData[] {
  const overlays = useDisplayLayersStore((s) => s.overlays);
  const setVisible = useDisplayLayersStore((s) => s.setOverlayVisible);
  const setOpacity = useDisplayLayersStore((s) => s.setOverlayOpacity);
  const setStroke = useDisplayLayersStore((s) => s.setOverlayStrokeColor);
  const setFill = useDisplayLayersStore((s) => s.setOverlayFillColor);
  const setOption = useDisplayLayersStore((s) => s.setOverlayOption);

  return (Object.keys(overlays) as OverlayLayerId[]).map((id): LayerRowData => {
    const o = overlays[id];
    return {
      id,
      name: OVERLAY_LABELS[id],
      visible: o.visible,
      opacity: o.opacity,
      strokeColor: o.strokeColor,
      fillColor: o.fillColor,
      showLabel: o.showLabel,
      showCota: o.showCota,
      editableName: false,
      removable: false,
      lockable: false,
      hideCota: id === 'vertices',
      kind: 'linea' as LayerKind,
      colorMode: 'solid' as const,
      reorderable: false,
      onToggleVisible: () => setVisible(id, !o.visible),
      onOpacity: (v) => setOpacity(id, v),
      onStrokeColor: (c) => setStroke(id, c),
      onFillColor: (c) => setFill(id, c),
      onShowLabel: (v) => setOption(id, 'showLabel', v),
      onShowCota: (v) => setOption(id, 'showCota', v),
      onSetColorMode: () => {},
    };
  });
}

/* ─────────── Panel principal ─────────── */

export default function LayerPanel() {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [deleteRequest, setDeleteRequest] = useState<LayerDeleteRequest | null>(null);
  // Fase 5: estado de drag&drop de filas del registro.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

  const setActiveLayer = useLayersStore((s) => s.setActiveLayer);
  const activeLayerId = useLayersStore((s) => s.activeLayerId);

  const askOnCreate = useLayerPickerStore((s) => s.askEnabled);
  const setAskOnCreate = useLayerPickerStore((s) => s.setAskEnabled);

  const registryRows = useRegistryRows(setDeleteRequest);
  const overlayRows = useOverlayRows();

  // Fase 5: la fila de ARRIBA del panel es la que se dibuja ENCIMA en el
  // mapa (zIndex más alto) — mismo criterio que QGIS/Photoshop. El store
  // guarda zIndex ASCENDENTE (índice del array = zIndex); acá solo se
  // invierte para MOSTRAR. Antes el orden de la lista no tenía ningún
  // efecto visual, así que esto no rompe ninguna convención previa real.
  const registryRowsDisplay = [...registryRows].sort((a, b) => b.zIndex - a.zIndex);
  const allRows: LayerRowData[] = [...registryRowsDisplay, ...overlayRows];

  const panelRef = useRef<HTMLDivElement>(null);
  const { visibleCount, sentinelRef } = useIncrementalRender(allRows.length, 60, panelRef);

  const [addLayerOpen, setAddLayerOpen] = useState(false);

  // Mover una capa un paso. El store guarda zIndex ASCENDENTE (índice 0
  // = fondo del mapa); "subir" en el panel (dibujar encima) = mover
  // hacia el FINAL del array del store.
  const moveLayer = (id: string, direction: 'up' | 'down') => {
    const layers = useLayersStore.getState().layers;
    const idx = layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx + 1 : idx - 1;
    if (targetIdx < 0 || targetIdx >= layers.length) return;
    void runCommand(new ReorderLayersCommand([id], targetIdx));
  };

  // Soltar `dragId` sobre `targetId`: arma el nuevo orden completo a
  // partir del orden DESCENDENTE que se ve en pantalla (más simple y
  // robusto que calcular un índice parcial), lo pasa a ASCENDENTE y lo
  // aplica con un solo comando.
  const handleDrop = (targetId: string, position: 'before' | 'after') => {
    if (dragId && dragId !== targetId) {
      const displayIds = registryRowsDisplay.map((r) => r.id);
      const withoutDragged = displayIds.filter((id) => id !== dragId);
      const targetIdx = withoutDragged.indexOf(targetId);
      const insertAt = position === 'before' ? targetIdx : targetIdx + 1;
      const newDisplayOrder = [...withoutDragged];
      newDisplayOrder.splice(insertAt, 0, dragId);
      const newAscendingOrder = [...newDisplayOrder].reverse();
      void runCommand(new ReorderLayersCommand(newAscendingOrder, 0));
    }
    setDragId(null);
    setDropTarget(null);
  };

  return (
    <>
    <div style={{ position: 'absolute', top: 'calc(var(--cad-topbar-height) + 12px)', right: 12, zIndex: 90, minWidth: open ? 250 : 'auto' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="cad-icon-btn cad-tooltip"
        data-tooltip="Capas"
        style={{
          marginLeft: 'auto', display: 'flex', marginBottom: open ? 6 : 0,
          background: open ? 'var(--cad-bg-active)' : 'rgba(26, 34, 54, 0.85)',
          backdropFilter: 'blur(16px)', border: '1px solid var(--cad-border)',
          color: open ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
        }}
      >
        <IconLayers />
      </button>

      {open && (
        <div ref={panelRef} className="cad-panel-glass animate-fade-in" style={{ padding: '10px 12px', minWidth: 250, maxHeight: '65vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--cad-border)' }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cad-text-dim)' }}>
              Capas
            </span>
            <button onClick={() => setAddLayerOpen(true)} className="cad-icon-btn cad-tooltip" data-tooltip="Nueva capa" style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconPlus />
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6rem', color: 'var(--cad-text-dim)', cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" className="cad-toggle" checked={askOnCreate} onChange={(e) => setAskOnCreate(e.target.checked)} />
            Preguntar capa al crear geometría
          </label>

          <div>
            <div onClick={() => setExpanded((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 0', cursor: 'pointer', userSelect: 'none' }}>
              <IconChevron open={expanded} />
              <span style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)', fontWeight: 500 }}>Todas las capas</span>
              <span style={{ fontSize: '0.6rem', color: 'var(--cad-text-muted)', marginLeft: 'auto' }}>{allRows.length}</span>
            </div>

            {expanded && (
              <div style={{ marginTop: 2 }}>
                {allRows.slice(0, visibleCount).map((row) => {
                  const displayIndex = registryRowsDisplay.findIndex((r) => r.id === row.id);
                  const canMoveUp = row.reorderable && displayIndex > 0;
                  const canMoveDown = row.reorderable && displayIndex !== -1 && displayIndex < registryRowsDisplay.length - 1;
                  const isDropBefore = dropTarget?.id === row.id && dropTarget.position === 'before';
                  const isDropAfter = dropTarget?.id === row.id && dropTarget.position === 'after';

                  return (
                    <div
                      key={row.id}
                      onDragOver={row.reorderable ? (e) => {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
                        setDropTarget({ id: row.id, position });
                      } : undefined}
                      onDragLeave={row.reorderable ? () => setDropTarget((dt) => (dt?.id === row.id ? null : dt)) : undefined}
                      onDrop={row.reorderable ? (e) => { e.preventDefault(); handleDrop(row.id, dropTarget?.position ?? 'before'); } : undefined}
                      onClick={() => { if (registryRows.some((r) => r.id === row.id)) setActiveLayer(activeLayerId === row.id ? null : row.id); }}
                      style={{
                        borderRadius: 4,
                        background: activeLayerId === row.id ? 'rgba(0,212,255,0.08)' : 'transparent',
                        border: activeLayerId === row.id ? '1px solid rgba(0,212,255,0.25)' : '1px solid transparent',
                        borderTop: isDropBefore ? '2px solid var(--cad-accent)' : undefined,
                        borderBottom: isDropAfter ? '2px solid var(--cad-accent)' : undefined,
                        opacity: dragId === row.id ? 0.4 : 1,
                      }}
                    >
                      <LayerRow
                        data={row}
                        onMoveUp={canMoveUp ? () => moveLayer(row.id, 'up') : undefined}
                        onMoveDown={canMoveDown ? () => moveLayer(row.id, 'down') : undefined}
                        canMoveUp={canMoveUp}
                        canMoveDown={canMoveDown}
                        onDragHandleStart={() => setDragId(row.id)}
                        onDragHandleEnd={() => { setDragId(null); setDropTarget(null); }}
                      />
                    </div>
                  );
                })}
                {allRows.length > visibleCount && <div ref={sentinelRef} style={{ height: 1 }} />}
              </div>
            )}
          </div>

          <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--cad-border)', fontSize: '0.6rem', color: 'var(--cad-text-muted)' }}>
            {registryRows.filter((r) => r.visible).map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                <span style={{ width: 8, height: 8, background: r.fillColor, borderRadius: 2, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                {r.locked && <span style={{ fontSize: '0.55rem', opacity: 0.5, marginLeft: 'auto' }}>🔒</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    <LayerDeleteModal request={deleteRequest} onClose={() => setDeleteRequest(null)} />
    <AddLayerModal open={addLayerOpen} onOpenChange={setAddLayerOpen} />
    </>
  );
}