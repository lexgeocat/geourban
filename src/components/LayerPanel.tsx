import React, { useState, useRef, useCallback } from 'react';
import { useLayersStore } from '../store/layersRegistryStore';
import type { Layer } from '../core/objectModel';
import { useLayerStore } from '../store/layerStore';

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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={visible ? "2" : "1.5"} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13, opacity: visible ? 1 : 0.4, cursor: 'pointer', transition: 'opacity 150ms ease' }}>
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

/* ─────────── Predefined colors for new layers ─────────── */

const LAYER_COLORS = [
  '#58a6ff', '#3fb950', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
  '#a78bfa', '#fb7185',
];

function nextColor(existing: Layer[]): string {
  const used = new Set(existing.map((l) => l.color));
  return LAYER_COLORS.find((c) => !used.has(c)) ?? LAYER_COLORS[existing.length % LAYER_COLORS.length];
}

/* ─────────── Color Picker (tiny inline) ─────────── */

function ColorDot({
  color,
  onChange,
}: {
  color: string;
  onChange: (c: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span
      onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
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

/* ─────────── Opacity slider (tiny inline) ─────────── */

function OpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={value}
      onChange={(e) => { e.stopPropagation(); onChange(Number.parseFloat(e.target.value)); }}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 52, height: 3, accentColor: 'var(--cad-accent)',
        cursor: 'pointer', opacity: 0.8,
      }}
    />
  );
}

/* ─────────── Main Panel ─────────── */

export default function LayerPanel() {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const layers = useLayersStore((s) => s.layers);
  const activeLayerId = useLayersStore((s) => s.activeLayerId);
  const addLayer = useLayersStore((s) => s.add);
  const removeLayer = useLayersStore((s) => s.remove);
  const updateLayer = useLayersStore((s) => s.update);
  const toggleVisibility = useLayersStore((s) => s.toggleVisibility);
  const toggleLock = useLayersStore((s) => s.toggleLock);
  const setActiveLayer = useLayersStore((s) => s.setActiveLayer);

  // Sync layerStore.workVisibility ↔ registry visibility
  const setWorkVisibility = useLayerStore((s) => s.setWorkVisibility);

  const syncLegacyVisibility = useCallback((layer: Layer) => {
    if (layer.kind === 'lote') setWorkVisibility('lots', layer.visible);
    else if (layer.kind === 'calle') setWorkVisibility('streets', layer.visible);
    else if (layer.kind === 'manzana') setWorkVisibility('lots', layer.visible);
  }, [setWorkVisibility]);

  const handleToggleVisibility = (layer: Layer) => {
    toggleVisibility(layer.id);
    syncLegacyVisibility({ ...layer, visible: !layer.visible });
  };

  const handleAddLayer = () => {
    const id = `layer-${Date.now().toString(36)}`;
    const color = nextColor(layers);
    addLayer({ id, name: `Capa ${layers.length + 1}`, kind: 'lote', color, visible: true, locked: false, opacity: 1 });
  };

  const handleRemove = (id: string) => {
    if (layers.length <= 1) return;
    removeLayer(id);
    if (activeLayerId === id) setActiveLayer(layers[0]?.id ?? null);
  };

  const startRename = (layer: Layer) => {
    setEditingId(layer.id);
    setEditName(layer.name);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      updateLayer({ id: editingId, name: editName.trim() });
    }
    setEditingId(null);
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(var(--cad-topbar-height) + 12px)',
        right: 12,
        zIndex: 90,
        minWidth: open ? 230 : 'auto',
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

      {open && (
        <div className="cad-panel-glass animate-fade-in" style={{ padding: '10px 12px', minWidth: 230, maxHeight: '60vh', overflowY: 'auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--cad-border)' }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cad-text-dim)' }}>
              Capas
            </span>
            <button
              onClick={handleAddLayer}
              className="cad-icon-btn cad-tooltip"
              data-tooltip="Nueva capa"
              style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <IconPlus />
            </button>
          </div>

          {/* Layer group (collapsible) */}
          <div>
            <div
              onClick={() => setExpanded((v) => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 0', cursor: 'pointer', userSelect: 'none' }}
            >
              <IconChevron open={expanded} />
              <span style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)', fontWeight: 500 }}>Todas las capas</span>
              <span style={{ fontSize: '0.6rem', color: 'var(--cad-text-muted)', marginLeft: 'auto' }}>{layers.length}</span>
            </div>

            {expanded && (
              <div style={{ marginTop: 2 }}>
                {layers.map((layer) => {
                  const isActive = activeLayerId === layer.id;
                  return (
                    <div
                      key={layer.id}
                      onClick={() => setActiveLayer(isActive ? null : layer.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 6px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        background: isActive ? 'rgba(0,212,255,0.08)' : 'transparent',
                        border: isActive ? '1px solid rgba(0,212,255,0.25)' : '1px solid transparent',
                        transition: 'background 100ms, border 100ms',
                      }}
                    >
                      {/* Visibility toggle */}
                      <span onClick={(e) => { e.stopPropagation(); handleToggleVisibility(layer); }}>
                        <IconEye visible={layer.visible} />
                      </span>

                      {/* Color dot + picker */}
                      <ColorDot color={layer.color} onChange={(c) => updateLayer({ id: layer.id, color: c })} />

                      {/* Name (editable) */}
                      {editingId === layer.id ? (
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            flex: 1, fontSize: '0.72rem', background: 'rgba(0,0,0,0.3)',
                            border: '1px solid var(--cad-border)', borderRadius: 3,
                            padding: '1px 4px', color: 'var(--cad-text)', outline: 'none',
                          }}
                        />
                      ) : (
                        <span
                          onDoubleClick={(e) => { e.stopPropagation(); startRename(layer); }}
                          style={{
                            flex: 1, fontSize: '0.72rem',
                            color: layer.visible ? 'var(--cad-text)' : 'var(--cad-text-muted)',
                            userSelect: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                        >
                          {layer.name}
                        </span>
                      )}

                      {/* Opacity slider */}
                      <OpacitySlider
                        value={layer.opacity}
                        onChange={(v) => updateLayer({ id: layer.id, opacity: v })}
                      />

                      {/* Lock toggle */}
                      <span onClick={(e) => { e.stopPropagation(); toggleLock(layer.id); }}>
                        <IconLock locked={layer.locked} />
                      </span>

                      {/* Delete (hidden for default layers) */}
                      {layer.id !== 'lots' && layer.id !== 'manzanas' && layer.id !== 'streets' && (
                        <span onClick={(e) => { e.stopPropagation(); handleRemove(layer.id); }} style={{ cursor: 'pointer', opacity: 0.4, display: 'flex' }}>
                          <IconTrash />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--cad-border)', fontSize: '0.6rem', color: 'var(--cad-text-muted)' }}>
            {layers.filter((l) => l.visible).map((layer) => (
              <div key={layer.id} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                <span style={{ width: 8, height: 8, background: layer.color, borderRadius: 2, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer.name}</span>
                {layer.locked && <span style={{ fontSize: '0.55rem', opacity: 0.5, marginLeft: 'auto' }}>🔒</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
