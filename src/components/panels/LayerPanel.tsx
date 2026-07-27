import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { LayerKind } from '../../core/objectModel';
import { useDisplayLayersStore, type OverlayLayerId } from '../../store/ui/displayLayersStore';
import { useLayerPickerStore } from '../../store/ui/layerPickerStore';
import { useLayerPanelUiStore } from '../../store/ui/layerPanelUiStore';
import { useIncrementalRender } from '../../hooks/useIncrementalRender';
import { useViewportWidth } from '../../hooks/useViewportWidth';
import { useDrawSourceTick } from '../../hooks/useDrawSourceTick';
import { manzanoDisplayColor } from '../../geo/manzanoColor';
import { computeLayerFeatureCounts, computeLayerExtent } from '../../geo/selectors/layerStats';
import { useMapStore } from '../../store/map/mapStore';
import { useSelectionStore } from '../../store/map/selectionStore';
import LayerDeleteModal, { type LayerDeleteRequest } from '../modals/LayerDeleteModal';
import AddLayerModal from '../modals/AddLayerModal';
import { runCommand } from '../../commands/core/CommandStack';
import { UpdateLayerCommand } from '../../commands/layers/UpdateLayerCommand';
import { ReorderLayersCommand } from '../../commands/layers/ReorderLayersCommand';
import { DuplicateLayerCommand } from '../../commands/layers/DuplicateLayerCommand';
import { MoveFeaturesToLayerCommand } from '../../commands/layers/MoveFeaturesToLayerCommand';

/* ─────────── Icons (decorativos — aria-hidden en su punto de uso) ─────────── */

const IconLayers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }} aria-hidden="true">
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11, transition: 'transform 150ms ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const IconEye = ({ visible }: { visible: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={visible ? '2' : '1.5'} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13, opacity: visible ? 1 : 0.4, transition: 'opacity 150ms ease' }} aria-hidden="true">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconLock = ({ locked }: { locked: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12, opacity: locked ? 1 : 0.3, transition: 'opacity 150ms ease' }} aria-hidden="true">
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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }} aria-hidden="true">
    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

const IconGear = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }} aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconGrip = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 10, height: 10 }} aria-hidden="true">
    <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
    <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
    <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
  </svg>
);

const IconChevronSmall = ({ dir }: { dir: 'up' | 'down' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 9, height: 9 }} aria-hidden="true">
    {dir === 'up' ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
  </svg>
);
const IconTarget = ({ filled }: { filled: boolean }) => (
  <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" style={{ width: 12, height: 12 }} aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
  </svg>
);

const IconPolygonKind = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 11, height: 11 }} aria-hidden="true">
    <path d="M12 2 21 8.5 17.5 20H6.5L3 8.5Z" />
  </svg>
);
const IconLineKind = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" style={{ width: 11, height: 11 }} aria-hidden="true">
    <path d="M4 20 20 4" />
  </svg>
);
const IconPointKind = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 9, height: 9 }} aria-hidden="true">
    <circle cx="12" cy="12" r="6" />
  </svg>
);

function geometryIconForKind(kind: LayerKind) {
  if (kind === 'calle' || kind === 'linea' || kind === 'cota') return <IconLineKind />;
  if (kind === 'texto') return <IconPointKind />;
  return <IconPolygonKind />;
}

function geometryLabelForKind(kind: LayerKind): string {
  if (kind === 'calle' || kind === 'linea' || kind === 'cota') return 'línea';
  if (kind === 'texto') return 'punto';
  return 'polígono';
}

const IconIsolate = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }} aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
  </svg>
);
const IconZoomTo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.35-4.35" />
    <path d="M11 8v6M8 11h6" />
  </svg>
);
const IconDuplicate = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }} aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M4 16V4a2 2 0 0 1 2-2h10" />
  </svg>
);
const IconMoveToLayer = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }} aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/* ─────────── Color Picker (Fase 8: botón real, no span) ─────────── */

function ColorDot({ color, onChange, title, warn }: { color: string; onChange: (c: string) => void; title?: string; warn?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const label = `${title ?? 'Color'}: ${color}${warn ? ' — atención: similar al de otra capa' : ''}`;
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="cad-a11y-btn"
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        aria-label={label}
        title={label}
        style={{
          width: 12, height: 12, borderRadius: 3, background: color,
          border: '1.5px solid rgba(255,255,255,0.25)',
        }}
      />
      <input
        ref={inputRef}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        value={color.startsWith('#') ? color : '#58a6ff'}
        onChange={(e) => { e.stopPropagation(); onChange(e.target.value); }}
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
      />
      {warn && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', top: -4, right: -4, width: 7, height: 7, borderRadius: '50%',
            background: 'var(--cad-accent-amber)', border: '1px solid var(--cad-bg-deepest)',
          }}
        />
      )}
    </span>
  );
}

/* ─────────── Opacity slider ─────────── */

function OpacitySlider({ value, onChange, layerName }: { value: number; onChange: (v: number) => void; layerName: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        type="range" min={0} max={1} step={0.05} value={value}
        onChange={(e) => { e.stopPropagation(); onChange(Number.parseFloat(e.target.value)); }}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Opacidad de la capa ${layerName}`}
        style={{ width: 42, height: 3, accentColor: 'var(--cad-accent)', cursor: 'pointer', opacity: 0.8 }}
      />
      <span aria-hidden="true" style={{ fontSize: '0.55rem', color: 'var(--cad-text-dim)', fontFamily: 'JetBrains Mono, monospace', minWidth: 24, textAlign: 'right' }}>
        {Math.round(value * 100)}%
      </span>
    </span>
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
  hideCota?: boolean;
  kind: LayerKind;
  colorMode: 'solid' | 'colorIdx';
  reorderable: boolean;
  featureCount?: number;
  isDataLayer: boolean;
  colorDuplicated?: boolean;
  isIsolated?: boolean;
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
  onIsolate?: () => void;
  onZoomToExtent?: () => void;
  onDuplicate?: () => void;
  onMoveSelectionHere?: () => void;
}

const gearLabelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px',
  fontSize: '0.68rem', color: 'var(--cad-text-dim)', cursor: 'pointer', whiteSpace: 'nowrap',
};

function LayerRow({
  data, isActive, onToggleActive, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onDragHandleStart, onDragHandleEnd, hasSelection,
}: {
  data: LayerRowData;
  isActive?: boolean;
  onToggleActive?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onDragHandleStart?: () => void;
  onDragHandleEnd?: () => void;
  hasSelection?: boolean;
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

  const startEditing = () => { setNameDraft(data.name); setEditingName(true); };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: 4 }}>
      {data.reorderable && (
        <>
          {/* Fase 8: drag&drop es un método adicional para mouse; los
              botones subir/bajar (abajo) son la vía 100% por teclado —
              el handle queda oculto a lectores de pantalla para no
              anunciar un control que no pueden operar. */}
          <span
            draggable
            onDragStart={(e) => { e.stopPropagation(); onDragHandleStart?.(); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={onDragHandleEnd}
            aria-hidden="true"
            tabIndex={-1}
            style={{ display: 'flex', color: 'var(--cad-text-muted)', cursor: 'grab', touchAction: 'none' }}
          >
            <IconGrip />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <button
              type="button"
              className="cad-a11y-btn"
              onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
              disabled={!canMoveUp}
              aria-label={`Subir capa ${data.name} (dibujar encima)`}
              title="Subir (dibujar encima)"
              style={{ height: 9, opacity: canMoveUp ? 0.75 : 0.2, color: 'var(--cad-text-dim)' }}
            >
              <IconChevronSmall dir="up" />
            </button>
            <button
              type="button"
              className="cad-a11y-btn"
              onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
              disabled={!canMoveDown}
              aria-label={`Bajar capa ${data.name} (dibujar debajo)`}
              title="Bajar (dibujar debajo)"
              style={{ height: 9, opacity: canMoveDown ? 0.75 : 0.2, color: 'var(--cad-text-dim)' }}
            >
              <IconChevronSmall dir="down" />
            </button>
          </div>
        </>
      )}

      <button
        type="button"
        className="cad-a11y-btn"
        onClick={(e) => { e.stopPropagation(); data.onToggleVisible(); }}
        aria-pressed={data.visible}
        aria-label={`${data.visible ? 'Ocultar' : 'Mostrar'} capa ${data.name}`}
      >
        <IconEye visible={data.visible} />
      </button>

      {onToggleActive && (() => {
        const activationBlocked = !isActive && !!data.locked;
        return (
          <button
            type="button"
            className="cad-a11y-btn"
            onClick={(e) => { e.stopPropagation(); if (!activationBlocked) onToggleActive(); }}
            disabled={activationBlocked}
            title={activationBlocked ? 'Capa bloqueada — desbloqueala para activarla' : (isActive ? 'Quitar como capa activa' : 'Usar como capa activa (los nuevos trazos van acá)')}
            aria-label={activationBlocked ? `${data.name}: capa bloqueada, no se puede activar` : (isActive ? `${data.name}: capa activa — click para quitar` : `Activar capa ${data.name}`)}
            aria-pressed={!!isActive}
            style={{
              width: 16, height: 16,
              color: isActive ? 'var(--cad-accent)' : 'var(--cad-text-muted)',
              opacity: activationBlocked ? 0.35 : 1,
            }}
          >
            <IconTarget filled={!!isActive} />
          </button>
        );
      })()}

      <span title={`Geometría: ${geometryLabelForKind(data.kind)}`} aria-hidden="true" style={{ display: 'flex', color: 'var(--cad-text-muted)', flexShrink: 0 }}>
        {geometryIconForKind(data.kind)}
      </span>

      <ColorDot color={data.strokeColor} onChange={data.onStrokeColor} title="Color de contorno" warn={data.colorDuplicated} />
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
          aria-label={`Nuevo nombre para la capa ${data.name}`}
          style={{ flex: 1, fontSize: '0.72rem', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--cad-border)', borderRadius: 3, padding: '1px 4px', color: 'var(--cad-text)', outline: 'none', minWidth: 0 }}
        />
      ) : data.editableName ? (
        // Fase 8: antes solo dblclick (mouse-only). Ahora es un <button>
        // real, activable con Enter/Espacio, con foco visible.
        <button
          type="button"
          className="cad-a11y-btn"
          onDoubleClick={startEditing}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditing(); } }}
          aria-label={`Renombrar capa ${data.name} (doble click o Enter)`}
          style={{ flex: 1, justifyContent: 'flex-start', fontSize: '0.72rem', color: data.visible ? 'var(--cad-text)' : 'var(--cad-text-dim)', minWidth: 0, textAlign: 'left' }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5, width: '100%' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.name}</span>
            {isActive && (
              <span aria-hidden="true" style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>
                ACTIVA
              </span>
            )}
            {data.isDataLayer && !!data.featureCount && (
              <span
                title={`${data.featureCount} elemento(s) en esta capa`}
                aria-hidden="true"
                style={{ fontSize: '0.55rem', color: 'var(--cad-text-dim)', border: '1px solid var(--cad-border)', borderRadius: 8, padding: '0 5px', flexShrink: 0, fontFamily: 'JetBrains Mono, monospace' }}
              >
                {data.featureCount}
              </span>
            )}
          </span>
        </button>
      ) : (
        <span style={{ flex: 1, fontSize: '0.72rem', color: data.visible ? 'var(--cad-text)' : 'var(--cad-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.name}
        </span>
      )}

      <OpacitySlider value={data.opacity} onChange={data.onOpacity} layerName={data.name} />

      {data.isDataLayer && data.onIsolate && (
        <button
          type="button"
          className="cad-a11y-btn"
          onClick={(e) => { e.stopPropagation(); data.onIsolate?.(); }}
          aria-pressed={!!data.isIsolated}
          aria-label={data.isIsolated ? `Quitar aislamiento de capa ${data.name}` : `Aislar capa ${data.name} (ocultar el resto)`}
          title={data.isIsolated ? 'Quitar aislamiento' : 'Aislar esta capa (ocultar el resto)'}
          style={{ color: data.isIsolated ? 'var(--cad-accent)' : 'var(--cad-text-muted)' }}
        >
          <IconIsolate />
        </button>
      )}
      {data.isDataLayer && data.onZoomToExtent && (data.featureCount ?? 0) > 0 && (
        <button
          type="button"
          className="cad-a11y-btn"
          onClick={(e) => { e.stopPropagation(); data.onZoomToExtent?.(); }}
          aria-label={`Zoom a la extensión de la capa ${data.name}`}
          title="Zoom a extensión de la capa"
          style={{ color: 'var(--cad-text-muted)' }}
        >
          <IconZoomTo />
        </button>
      )}
      {data.isDataLayer && data.onDuplicate && (
        <button
          type="button"
          className="cad-a11y-btn"
          onClick={(e) => { e.stopPropagation(); data.onDuplicate?.(); }}
          aria-label={`Duplicar capa ${data.name}`}
          title="Duplicar capa"
          style={{ color: 'var(--cad-text-muted)' }}
        >
          <IconDuplicate />
        </button>
      )}
      {data.isDataLayer && data.onMoveSelectionHere && hasSelection && !data.locked && (
        <button
          type="button"
          className="cad-a11y-btn"
          onClick={(e) => { e.stopPropagation(); data.onMoveSelectionHere?.(); }}
          aria-label={`Mover la selección actual a la capa ${data.name}`}
          title="Mover la selección actual a esta capa"
          style={{ color: 'var(--cad-accent-green)' }}
        >
          <IconMoveToLayer />
        </button>
      )}

      <div ref={gearRef} style={{ position: 'relative', display: 'flex' }}>
        <button
          type="button"
          className="cad-a11y-btn"
          onClick={() => setGearOpen((v) => !v)}
          aria-haspopup="true"
          aria-expanded={gearOpen}
          aria-label={`Opciones de la capa ${data.name}`}
          style={{ opacity: gearOpen ? 1 : 0.55 }}
        >
          <IconGear />
        </button>
        {gearOpen && (
          <div
            className="cad-panel-glass animate-fade-in"
            role="menu"
            aria-label={`Opciones de ${data.name}`}
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
                <div style={{ fontSize: '0.62rem', color: 'var(--cad-text-dim)', marginBottom: 4 }}>Color de manzanos</div>
                <label style={{ ...gearLabelStyle, padding: '2px 0' }}>
                  <input type="radio" name={`cm-${data.id}`} className="cad-toggle" checked={data.colorMode === 'solid'} onChange={() => data.onSetColorMode('solid')} />
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: data.strokeColor, flexShrink: 0 }} />
                  Sólido (capa)
                </label>
                <label style={{ ...gearLabelStyle, padding: '2px 0' }}>
                  <input type="radio" name={`cm-${data.id}`} className="cad-toggle" checked={data.colorMode === 'colorIdx'} onChange={() => data.onSetColorMode('colorIdx')} />
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: manzanoDisplayColor(0), flexShrink: 0 }} />
                  Por manzano
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {data.lockable && (
        <button
          type="button"
          className="cad-a11y-btn"
          onClick={(e) => { e.stopPropagation(); data.onToggleLock?.(); }}
          aria-pressed={!!data.locked}
          aria-label={`${data.locked ? 'Desbloquear' : 'Bloquear'} capa ${data.name}`}
        >
          <IconLock locked={!!data.locked} />
        </button>
      )}
      {data.removable && (
        <button
          type="button"
          className="cad-a11y-btn"
          onClick={(e) => { e.stopPropagation(); data.onRemove?.(); }}
          aria-label={`Eliminar capa ${data.name}`}
          style={{ opacity: 0.4 }}
        >
          <IconTrash />
        </button>
      )}
    </div>
  );
}

/* ─────────── Adaptadores de cada store ─────────── */

const NON_REMOVABLE = new Set(['lots', 'manzanas', 'streets', 'equipment', 'greenareas']);

function computeDuplicatedColorIds(layers: Array<{ id: string; color: string }>): Set<string> {
  const byColor = new globalThis.Map<string, string[]>();
  for (const l of layers) {
    const key = l.color.trim().toLowerCase();
    if (!byColor.has(key)) byColor.set(key, []);
    byColor.get(key)!.push(l.id);
  }
  const dup = new Set<string>();
  for (const ids of byColor.values()) {
    if (ids.length > 1) ids.forEach((id) => dup.add(id));
  }
  return dup;
}

function useRegistryRows(
  onRequestRemove: (request: LayerDeleteRequest) => void,
  featureCounts: Record<string, number>,
  isolatedLayerId: string | null,
): Array<LayerRowData & { zIndex: number }> {
  const layers = useLayersStore((s) => s.layers);
  const toggleIsolate = useLayersStore((s) => s.toggleIsolate);
  const duplicatedColorIds = useMemo(() => computeDuplicatedColorIds(layers), [layers]);

  const handleZoomToLayer = (layerId: string) => {
    const map = useMapStore.getState().mapInstance;
    const drawSource = useMapStore.getState().drawSource;
    if (!map || !drawSource) return;
    const ext = computeLayerExtent(drawSource, layerId);
    if (!ext || !isFinite(ext[0])) return;
    map.getView().fit(ext, { size: map.getSize() ?? undefined, maxZoom: 19, padding: [60, 60, 60, 60] });
  };

  const handleDuplicate = (layer: { id: string; name: string }) => {
    const newName = window.prompt('Nombre para la copia:', `${layer.name} (copia)`);
    if (!newName) return;
    const duplicateFeatures = window.confirm('¿Duplicar también los elementos de esta capa?\n\nAceptar = copiar elementos · Cancelar = capa vacía');
    const newId = `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    void runCommand(new DuplicateLayerCommand({ sourceLayerId: layer.id, newLayerId: newId, newName, duplicateFeatures }));
  };

  const handleMoveSelectionHere = (layerId: string) => {
    const ids = Array.from(useSelectionStore.getState().selectedIds);
    if (ids.length === 0) return;
    void runCommand(new MoveFeaturesToLayerCommand(ids, layerId));
  };

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
    isDataLayer: true,
    featureCount: featureCounts[l.id] ?? 0,
    colorDuplicated: duplicatedColorIds.has(l.id),
    isIsolated: isolatedLayerId === l.id,
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
    onIsolate: () => toggleIsolate(l.id),
    onZoomToExtent: () => handleZoomToLayer(l.id),
    onDuplicate: () => handleDuplicate({ id: l.id, name: l.name }),
    onMoveSelectionHere: () => handleMoveSelectionHere(l.id),
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
      isDataLayer: false,
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

/* ─────────── Header de sección ─────────── */

function SectionHeader({ label, count, expanded, onToggle, isRef, panelId }: { label: string; count: number; expanded: boolean; onToggle: () => void; isRef?: boolean; panelId: string }) {
  return (
    <button
      type="button"
      className="cad-a11y-btn"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={panelId}
      style={{ width: '100%', justifyContent: 'flex-start', gap: 5, padding: '3px 0' }}
    >
      <IconChevron open={expanded} />
      {isRef && (
        <span aria-hidden="true" style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--cad-text-dim)', fontStyle: 'italic' }}>Σ</span>
      )}
      <span style={{ fontSize: '0.68rem', color: 'var(--cad-text-dim)', fontWeight: 500, fontStyle: isRef ? 'italic' : 'normal' }}>{label}</span>
      <span aria-hidden="true" style={{ fontSize: '0.6rem', color: 'var(--cad-text-dim)', marginLeft: 'auto' }}>{count}</span>
    </button>
  );
}

/* ─────────── Panel principal ─────────── */

export default function LayerPanel() {
  const open = useLayerPanelUiStore((s) => s.open);
  const setOpen = useLayerPanelUiStore((s) => s.setOpen);
  const expandedData = useLayerPanelUiStore((s) => s.expandedData);
  const setExpandedData = useLayerPanelUiStore((s) => s.setExpandedData);
  const expandedRefs = useLayerPanelUiStore((s) => s.expandedRefs);
  const setExpandedRefs = useLayerPanelUiStore((s) => s.setExpandedRefs);

  const [deleteRequest, setDeleteRequest] = useState<LayerDeleteRequest | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

  const setActiveLayer = useLayersStore((s) => s.setActiveLayer);
  const activeLayerId = useLayersStore((s) => s.activeLayerId);
  const isolatedLayerId = useLayersStore((s) => s.isolatedLayerId);

  const askOnCreate = useLayerPickerStore((s) => s.askEnabled);
  const setAskOnCreate = useLayerPickerStore((s) => s.setAskEnabled);

  const drawSource = useMapStore((s) => s.drawSource);
  const tick = useDrawSourceTick(drawSource);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const featureCounts = useMemo(() => computeLayerFeatureCounts(drawSource), [drawSource, tick]);
  const selectedCount = useSelectionStore((s) => s.selectedIds.size);

  const registryRows = useRegistryRows(setDeleteRequest, featureCounts, isolatedLayerId);
  const overlayRows = useOverlayRows();

  const registryRowsDisplay = [...registryRows].sort((a, b) => b.zIndex - a.zIndex);

  const viewportWidth = useViewportWidth();
  const panelMinWidth = Math.min(250, viewportWidth - 24);

  const panelRef = useRef<HTMLDivElement>(null);
  const allRowsForIncremental = [...(expandedData ? registryRowsDisplay : []), ...(expandedRefs ? overlayRows : [])];
  const { visibleCount, sentinelRef } = useIncrementalRender(allRowsForIncremental.length, 60, panelRef);

  const [addLayerOpen, setAddLayerOpen] = useState(false);

  const moveLayer = (id: string, direction: 'up' | 'down') => {
    const layers = useLayersStore.getState().layers;
    const idx = layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx + 1 : idx - 1;
    if (targetIdx < 0 || targetIdx >= layers.length) return;
    void runCommand(new ReorderLayersCommand([id], targetIdx));
  };

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

  // Fase 8: navegación por teclado entre filas (roving focus). Cada fila
  // es un contenedor focuseable (role="group"); ArrowUp/ArrowDown mueve
  // el foco entre filas visibles, Enter/Espacio activa la acción
  // principal (mostrar/ocultar), igual que un listbox nativo.
  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, row: LayerRowData) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const panel = panelRef.current;
      if (!panel) return;
      e.preventDefault();
      const rows = Array.from(panel.querySelectorAll<HTMLElement>('[data-layer-row="true"]'));
      const idx = rows.findIndex((el) => el === e.currentTarget);
      if (idx === -1) return;
      const nextIdx = e.key === 'ArrowDown' ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1);
      rows[nextIdx]?.focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      row.onToggleVisible();
    }
  };

  const renderRow = (row: LayerRowData, isRegistryRow: boolean) => {
    const displayIndex = registryRowsDisplay.findIndex((r) => r.id === row.id);
    const canMoveUp = row.reorderable && displayIndex > 0;
    const canMoveDown = row.reorderable && displayIndex !== -1 && displayIndex < registryRowsDisplay.length - 1;
    const isDropBefore = dropTarget?.id === row.id && dropTarget.position === 'before';
    const isDropAfter = dropTarget?.id === row.id && dropTarget.position === 'after';
    const isActive = isRegistryRow && activeLayerId === row.id;

    return (
      <div
        key={row.id}
        data-layer-row="true"
        role="group"
        tabIndex={0}
        aria-label={`Capa ${row.name}${row.isDataLayer ? '' : ' (capa de referencia)'}`}
        onKeyDown={(e) => handleRowKeyDown(e, row)}
        onDragOver={row.reorderable ? (e) => {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
          setDropTarget({ id: row.id, position });
        } : undefined}
        onDragLeave={row.reorderable ? () => setDropTarget((dt) => (dt?.id === row.id ? null : dt)) : undefined}
        onDrop={row.reorderable ? (e) => { e.preventDefault(); handleDrop(row.id, dropTarget?.position ?? 'before'); } : undefined}
        style={{
          borderRadius: 4,
          background: isActive ? 'rgba(0,212,255,0.08)' : row.isIsolated ? 'rgba(0,212,255,0.05)' : 'transparent',
          border: isActive ? '1px solid rgba(0,212,255,0.25)' : row.isIsolated ? '1px dashed rgba(0,212,255,0.4)' : '1px solid transparent',
          borderTop: isDropBefore ? '2px solid var(--cad-accent)' : undefined,
          borderBottom: isDropAfter ? '2px solid var(--cad-accent)' : undefined,
          opacity: dragId === row.id ? 0.4 : !row.isDataLayer ? 0.85 : 1,
        }}
      >
        <LayerRow
          data={row}
          isActive={isActive}
          hasSelection={selectedCount > 0}
          onToggleActive={isRegistryRow ? () => setActiveLayer(isActive ? null : row.id) : undefined}
          onMoveUp={canMoveUp ? () => moveLayer(row.id, 'up') : undefined}
          onMoveDown={canMoveDown ? () => moveLayer(row.id, 'down') : undefined}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onDragHandleStart={() => setDragId(row.id)}
          onDragHandleEnd={() => { setDragId(null); setDropTarget(null); }}
        />
      </div>
    );
  };

  let renderedSoFar = 0;

  return (
    <>
    <div style={{ position: 'absolute', top: 'calc(var(--cad-topbar-height) + 12px)', right: 12, zIndex: 90, minWidth: open ? panelMinWidth : 'auto' }}>
      <button
        onClick={() => setOpen(!open)}
        className="cad-icon-btn cad-tooltip"
        data-tooltip="Capas"
        aria-expanded={open}
        aria-label={open ? 'Cerrar panel de capas' : 'Abrir panel de capas'}
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
        <div ref={panelRef} className="cad-panel-glass animate-fade-in" role="region" aria-label="Panel de capas" style={{ padding: '10px 12px', minWidth: panelMinWidth, maxWidth: Math.min(340, viewportWidth - 20), maxHeight: '65vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--cad-border)' }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cad-text-dim)' }}>
              Capas
            </span>
            <button onClick={() => setAddLayerOpen(true)} className="cad-icon-btn cad-tooltip" data-tooltip="Nueva capa" aria-label="Crear nueva capa" style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconPlus />
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6rem', color: 'var(--cad-text-dim)', cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" className="cad-toggle" checked={askOnCreate} onChange={(e) => setAskOnCreate(e.target.checked)} />
            Preguntar capa al crear geometría
          </label>

          {isolatedLayerId && (
            <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', marginBottom: 6, borderRadius: 6, background: 'rgba(0,212,255,0.08)', border: '1px dashed var(--cad-accent)', fontSize: '0.62rem', color: 'var(--cad-accent)' }}>
              <IconIsolate />
              <span style={{ flex: 1 }}>Aislando: {registryRows.find((r) => r.id === isolatedLayerId)?.name ?? isolatedLayerId}</span>
              <button
                onClick={() => useLayersStore.getState().toggleIsolate(isolatedLayerId)}
                className="cad-icon-btn"
                aria-label="Mostrar todas las capas (quitar aislamiento)"
                style={{ width: 'auto', height: 'auto', padding: '2px 6px', fontSize: '0.58rem', color: 'var(--cad-accent)' }}
              >
                Mostrar todas
              </button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', marginBottom: 8, borderRadius: 6, background: 'var(--cad-bg-surface)', border: '1px solid var(--cad-border)', fontSize: '0.65rem' }}>
            <IconTarget filled={activeLayerId != null} />
            <span style={{ color: 'var(--cad-text-dim)', flexShrink: 0 }}>Capa activa:</span>
            {activeLayerId ? (
              <span style={{ color: 'var(--cad-accent)', fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {registryRows.find((r) => r.id === activeLayerId)?.name ?? activeLayerId}
              </span>
            ) : (
              <span style={{ color: 'var(--cad-text-dim)', fontStyle: 'italic', flex: 1 }}>
                Ninguna (se asigna por tipo)
              </span>
            )}
            {activeLayerId && (
              <button
                onClick={() => setActiveLayer(null)}
                className="cad-icon-btn"
                aria-label="Quitar capa activa"
                style={{ width: 'auto', height: 'auto', padding: '2px 6px', fontSize: '0.58rem', color: 'var(--cad-text-dim)' }}
              >
                Quitar
              </button>
            )}
          </div>

          <div>
            <SectionHeader panelId="layerpanel-data-section" label="Capas de datos" count={registryRowsDisplay.length} expanded={expandedData} onToggle={() => setExpandedData(!expandedData)} />
            {expandedData && (
              <div id="layerpanel-data-section" style={{ marginTop: 2 }}>
                {registryRowsDisplay.map((row) => {
                  if (renderedSoFar >= visibleCount) return null;
                  renderedSoFar++;
                  return renderRow(row, true);
                })}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--cad-border)' }}>
            <SectionHeader panelId="layerpanel-refs-section" label="Capas de referencia" count={overlayRows.length} expanded={expandedRefs} onToggle={() => setExpandedRefs(!expandedRefs)} isRef />
            {expandedRefs && (
              <div id="layerpanel-refs-section" style={{ marginTop: 2 }}>
                {overlayRows.map((row) => {
                  if (renderedSoFar >= visibleCount) return null;
                  renderedSoFar++;
                  return renderRow(row, false);
                })}
              </div>
            )}
          </div>

          {allRowsForIncremental.length > visibleCount && <div ref={sentinelRef} style={{ height: 1 }} />}

          <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--cad-border)', fontSize: '0.6rem', color: 'var(--cad-text-dim)' }}>
            {registryRows.filter((r) => r.visible).map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, background: r.fillColor, borderRadius: 2, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                {r.locked && <span aria-hidden="true" style={{ fontSize: '0.55rem', opacity: 0.5, marginLeft: 'auto' }}>🔒</span>}
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