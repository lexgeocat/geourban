import React, { useState, useRef, useEffect } from 'react';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { Layer } from '../../core/objectModel';
import { useDisplayLayersStore, type OverlayLayerId } from '../../store/ui/displayLayersStore';
import { useLayerPickerStore } from '../../store/ui/layerPickerStore';
import { useIncrementalRender } from '../../hooks/useIncrementalRender';
import LayerDeleteModal, { type LayerDeleteRequest } from '../modals/LayerDeleteModal';

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

/* ─────────── Predefined colors ─────────── */

const LAYER_COLORS = [
  '#58a6ff', '#3fb950', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
  '#a78bfa', '#fb7185',
];

function nextColor(existing: Layer[]): string {
  const used = new Set(existing.map((l) => l.color));
  return LAYER_COLORS.find((c) => !used.has(c)) ?? LAYER_COLORS[existing.length % LAYER_COLORS.length];
}

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
  onToggleVisible: () => void;
  onOpacity: (v: number) => void;
  onStrokeColor: (c: string) => void;
  onFillColor: (c: string) => void;
  onShowLabel: (v: boolean) => void;
  onShowCota: (v: boolean) => void;
  onRename?: (name: string) => void;
  onToggleLock?: () => void;
  onRemove?: () => void;
}

const gearLabelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px',
  fontSize: '0.68rem', color: 'var(--cad-text-dim)', cursor: 'pointer', whiteSpace: 'nowrap',
};

function LayerRow({ data }: { data: LayerRowData }) {
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

function useRegistryRows(onRequestRemove: (request: LayerDeleteRequest) => void): LayerRowData[] {
  const layers = useLayersStore((s) => s.layers);
  const updateLayer = useLayersStore((s) => s.update);
  const toggleVisibility = useLayersStore((s) => s.toggleVisibility);
  const toggleLock = useLayersStore((s) => s.toggleLock);

  return layers.map((l): LayerRowData => ({
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
    onToggleVisible: () => toggleVisibility(l.id),
    onOpacity: (v) => updateLayer({ id: l.id, opacity: v }),
    onStrokeColor: (c) => updateLayer({ id: l.id, color: c }),
    onFillColor: (c) => updateLayer({ id: l.id, fillColor: c }),
    onShowLabel: (v) => updateLayer({ id: l.id, showLabel: v }),
    onShowCota: (v) => updateLayer({ id: l.id, showCota: v }),
    onRename: (name) => updateLayer({ id: l.id, name }),
    onToggleLock: () => toggleLock(l.id),
    // Fase 2 (persistencia/integridad): ya no borra directo — abre el
    // modal de confirmación con conteo de features afectadas.
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
      onToggleVisible: () => setVisible(id, !o.visible),
      onOpacity: (v) => setOpacity(id, v),
      onStrokeColor: (c) => setStroke(id, c),
      onFillColor: (c) => setFill(id, c),
      onShowLabel: (v) => setOption(id, 'showLabel', v),
      onShowCota: (v) => setOption(id, 'showCota', v),
    };
  });
}

/* ─────────── Panel principal ─────────── */

export default function LayerPanel() {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [deleteRequest, setDeleteRequest] = useState<LayerDeleteRequest | null>(null);

  const layers = useLayersStore((s) => s.layers);
  const addLayer = useLayersStore((s) => s.add);
  const setActiveLayer = useLayersStore((s) => s.setActiveLayer);
  const activeLayerId = useLayersStore((s) => s.activeLayerId);

  const askOnCreate = useLayerPickerStore((s) => s.askEnabled);
  const setAskOnCreate = useLayerPickerStore((s) => s.setAskEnabled);

  const registryRows = useRegistryRows(setDeleteRequest);
  const overlayRows = useOverlayRows();
  const allRows = [...registryRows, ...overlayRows];

  const panelRef = useRef<HTMLDivElement>(null);
  const { visibleCount, sentinelRef } = useIncrementalRender(allRows.length, 60, panelRef);

  const handleAddLayer = () => {
    const id = `layer-${Date.now().toString(36)}`;
    const color = nextColor(layers);
    addLayer({
      id, name: `Capa ${layers.length + 1}`, kind: 'lote', color, fillColor: color,
      visible: true, locked: false, opacity: 1, showLabel: true, showCota: true,
    });
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
            <button onClick={handleAddLayer} className="cad-icon-btn cad-tooltip" data-tooltip="Nueva capa" style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                {allRows.slice(0, visibleCount).map((row) => (
                  <div
                    key={row.id}
                    onClick={() => { if (registryRows.some((r) => r.id === row.id)) setActiveLayer(activeLayerId === row.id ? null : row.id); }}
                    style={{
                      borderRadius: 4,
                      background: activeLayerId === row.id ? 'rgba(0,212,255,0.08)' : 'transparent',
                      border: activeLayerId === row.id ? '1px solid rgba(0,212,255,0.25)' : '1px solid transparent',
                    }}
                  >
                    <LayerRow data={row} />
                  </div>
                ))}
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
    </>
  );
}