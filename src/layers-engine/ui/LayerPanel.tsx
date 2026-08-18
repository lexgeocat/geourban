// src/layers-engine/ui/LayerPanel.tsx
import { useState, useRef, useEffect, useMemo, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Layers,
  ChevronRight,
  Eye,
  Lock,
  LockOpen,
  Plus,
  Trash2,
  Target,
  Hexagon,
  Slash,
  Focus,
  ZoomIn,
  Copy,
  ArrowRight,
  Tag,
  Ruler,
  Pencil,
  Circle,
  MapPin,
  GripVertical,
} from 'lucide-react';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import type { LayerKind } from '@kernel/domain-model/featureModel';
import { useLayerPanelUiStore } from '@layers-engine/store/layerPanelUiStore';
import { useIncrementalRender } from '@shared-ui/hooks/useIncrementalRender';
import { useViewportWidth } from '@shared-ui/hooks/useViewportWidth';
import { useDrawSourceTick } from '@shared-ui/hooks/useDrawSourceTick';
import { computeLayerFeatureCounts, computeLayerExtent } from '@layers-engine/selectors/layerStats';
import { useMapStore } from '@map-core/store/mapStore';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import LayerDeleteModal, { type LayerDeleteRequest } from './LayerDeleteModal';
import AddLayerModal from './AddLayerModal';
import { LayerReorderPill } from './LayerReorderPill';
import { LayerDropIndicator } from './LayerDropIndicator';
import {
  usePointerLayerReorder,
  type PointerReorderRow,
  type DropPosition,
} from '@layers-engine/hooks/usePointerLayerReorder';
import { runCommand } from '@kernel/command/CommandStack';
import { UpdateLayerCommand } from '@layers-engine/commands/UpdateLayerCommand';
import { ReorderLayersCommand } from '@layers-engine/commands/ReorderLayersCommand';
import { DuplicateLayerCommand } from '@layers-engine/commands/DuplicateLayerCommand';
import { MoveFeaturesToLayerCommand } from '@layers-engine/commands/MoveFeaturesToLayerCommand';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { confirmAsync } from '@shared-ui/store/confirmDialogStore';
import { toast } from '@shared-ui/store/toastStore';
import { newId } from '@kernel/id/id';
import { useLabelConfigModalStore } from '@label-engine/store/labelConfigModalStore';
import { useLabelClassStore } from '@label-engine/store/labelClassStore';
import { defaultColorForKind, defaultLabelStyleConfig } from '@label-engine/model/labelModel';
import { useEditSessionStore } from '@layers-engine/store/editSessionStore';

/* ----------- Icons ----------- */

const IconChevron = ({ open }: { open: boolean }) => (
  <ChevronRight
    size={11}
    aria-hidden="true"
    style={{
      transition: 'transform 150ms ease',
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
    }}
  />
);

const IconEye = ({ visible }: { visible: boolean }) => (
  <Eye
    size={13}
    strokeWidth={visible ? 2 : 1.5}
    aria-hidden="true"
    style={{ opacity: visible ? 1 : 0.4, transition: 'opacity 150ms ease' }}
  />
);

const IconLock = ({ locked }: { locked: boolean }) =>
  locked ? (
    <Lock size={12} strokeWidth={1.5} aria-hidden="true" />
  ) : (
    <LockOpen size={12} strokeWidth={1.5} aria-hidden="true" />
  );

const IconPlus = () => <Plus size={13} aria-hidden="true" />;
const IconTrash = () => <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />;
const IconTarget = ({ filled }: { filled: boolean }) => (
  <Target size={12} strokeWidth={1.75} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />
);
const IconPolygonKind = () => <Hexagon size={11} strokeWidth={1.5} aria-hidden="true" />;
const IconLineKind = () => <Slash size={11} strokeWidth={1.75} aria-hidden="true" />;
const IconCircleKind = () => <Circle size={11} strokeWidth={1.5} aria-hidden="true" />;
const IconPointKind = () => <MapPin size={11} strokeWidth={1.5} aria-hidden="true" />;

function geometryIconForKind(kind: LayerKind) {
  if (kind === 'via' || kind === 'linea' || kind === 'polilinea' || kind === 'rotonda')
    return <IconLineKind />;
  if (kind === 'punto') return <IconPointKind />;
  if (kind === 'circulo') return <IconCircleKind />;
  return <IconPolygonKind />;
}

function geometryLabelForKind(kind: LayerKind): string {
  if (kind === 'via' || kind === 'linea' || kind === 'polilinea' || kind === 'rotonda')
    return 'línea';
  if (kind === 'punto') return 'punto';
  if (kind === 'circulo') return 'círculo';
  return 'polígono';
}

/* ----------- Color Picker (contorno de capa) ----------- */

function ColorDot({
  color,
  onChange,
  title,
  warn,
}: {
  color: string;
  onChange: (c: string) => void;
  title?: string;
  warn?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localColor, setLocalColor] = useState(color);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) setLocalColor(color);
  }, [color]);

  const label = `${title ?? 'Color de capa'}: ${localColor}${warn ? ' ⚠ atención: similar al de otra capa' : ''}`;

  const scheduleCommit = (c: string) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      onChange(c);
      draggingRef.current = false;
    }, 120);
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="cad-a11y-btn"
        onClick={(e) => {
          e.stopPropagation();
          inputRef.current?.click();
        }}
        aria-label={label}
        title={label}
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          background: localColor,
          border: '1.5px solid rgba(255,255,255,0.25)',
        }}
      />
      <input
        ref={inputRef}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        value={localColor.startsWith('#') ? localColor : '#58a6ff'}
        onChange={(e) => {
          e.stopPropagation();
          draggingRef.current = true;
          const c = e.target.value;
          setLocalColor(c);
          scheduleCommit(c);
        }}
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
      />
      {warn && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--cad-accent-amber)',
            border: '1px solid var(--cad-bg-deepest)',
          }}
        />
      )}
    </span>
  );
}

function OpacitySlider({
  value,
  onChange,
  layerName,
  full,
}: {
  value: number;
  onChange: (v: number) => void;
  layerName: string;
  full?: boolean;
}) {
  const [localValue, setLocalValue] = useState(value);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) setLocalValue(value);
  }, [value]);

  const pct = Math.round(localValue * 100);

  const scheduleCommit = (v: number) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      onChange(v);
      draggingRef.current = false;
    }, 100);
  };

  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={localValue}
      onChange={(e) => {
        e.stopPropagation();
        draggingRef.current = true;
        const v = Number.parseFloat(e.target.value);
        setLocalValue(v);
        scheduleCommit(v);
      }}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Opacidad de la capa ${layerName}`}
      aria-valuetext={`${pct}%`}
      title={`Opacidad: ${pct}%`}
      style={{
        width: full ? '100%' : 52,
        height: 4,
        accentColor: 'var(--cad-accent)',
        cursor: 'pointer',
      }}
    />
  );
}

/* ----------- Fila de capa (minimal: ojo + color + nombre) ----------- */

interface LayerRowData {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  color: string;
  showLabel: boolean;
  showCota: boolean;
  editableName: boolean;
  removable: boolean;
  lockable: boolean;
  locked?: boolean;
  editing: boolean;
  kind: LayerKind;
  reorderable: boolean;
  featureCount?: number;
  isDataLayer: boolean;
  colorDuplicated?: boolean;
  isIsolated?: boolean;
  onToggleVisible: () => void;
  onOpacity: (v: number) => void;
  onColor: (c: string) => void;
  onToggleLabel: () => void;
  onToggleCota: () => void;
  onRename?: (name: string) => void;
  onToggleLock?: () => void;
  onToggleEditing: () => void;
  onRemove?: () => void;
  onIsolate?: () => void;
  onZoomToExtent?: () => void;
  onDuplicate?: () => void;
  onMoveSelectionHere?: () => void;
  onConfigureLabels?: () => void;
}

function LayerRow({
  data,
  isActive,
  editing,
  nameDraft,
  dragging,
  canMoveSelection,
  onNameDraftChange,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onOpenContextMenu,
  onRowKeyDown,
  onRowPointerDown,
  rowRef,
}: {
  data: LayerRowData;
  isActive?: boolean;
  editing: boolean;
  nameDraft: string;
  dragging: boolean;
  canMoveSelection?: boolean;
  onNameDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onOpenContextMenu: (e: React.MouseEvent) => void;
  onRowKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onRowPointerDown: (e: React.PointerEvent) => void;
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={rowRef}
      data-layer-row="true"
      role="group"
      tabIndex={0}
      aria-grabbed={dragging || undefined}
      aria-label={`Capa ${data.name} — mantener presionado y arrastrar para reordenar, click derecho para más opciones`}
      onContextMenu={onOpenContextMenu}
      onKeyDown={onRowKeyDown}
      onPointerDown={onRowPointerDown}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 6px',
        borderRadius: 4,
        cursor: 'default',
        opacity: dragging ? 0.35 : 1,
        position: 'relative',
        touchAction: 'none', // crítico para que el pointermove no se pierda en pan/scroll del browser
      }}
    >
      <span
        aria-hidden="true"
        title="Arrastrar para reordenar"
        className="layer-row-grip"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 12,
          height: 14,
          flexShrink: 0,
          color: 'var(--cad-text-muted)',
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <GripVertical size={11} strokeWidth={1.75} />
      </span>

      <button
        type="button"
        className="cad-a11y-btn"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          data.onToggleVisible();
        }}
        aria-pressed={data.visible}
        aria-label={`${data.visible ? 'Ocultar' : 'Mostrar'} capa ${data.name}`}
      >
        <IconEye visible={data.visible} />
      </button>
      <button
        type="button"
        className="cad-a11y-btn"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          data.onToggleLabel();
        }}
        aria-pressed={data.showLabel}
        aria-label={`${data.showLabel ? 'Ocultar' : 'Mostrar'} etiquetas de la capa ${data.name}`}
        title={`${data.showLabel ? 'Ocultar' : 'Mostrar'} etiquetas`}
      >
        <Tag
          size={12}
          strokeWidth={data.showLabel ? 2 : 1.5}
          aria-hidden="true"
          style={{
            opacity: data.showLabel ? 1 : 0.4,
            transition: 'opacity 150ms ease',
          }}
        />
      </button>
      <button
        type="button"
        className="cad-a11y-btn"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          data.onToggleCota();
        }}
        aria-pressed={data.showCota}
        aria-label={`${data.showCota ? 'Ocultar' : 'Mostrar'} acotaciones de la capa ${data.name}`}
        title={`${data.showCota ? 'Ocultar' : 'Mostrar'} acotaciones`}
      >
        <Ruler
          size={12}
          strokeWidth={data.showCota ? 2 : 1.5}
          aria-hidden="true"
          style={{
            opacity: data.showCota ? 1 : 0.4,
            transition: 'opacity 150ms ease',
          }}
        />
      </button>
      {canMoveSelection && data.onMoveSelectionHere && (
        <button
          type="button"
          className="cad-a11y-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            data.onMoveSelectionHere?.();
          }}
          aria-label={`Mover selección a la capa ${data.name}`}
          title="Mover selección aquí"
        >
          <ArrowRight
            size={12}
            strokeWidth={1.75}
            aria-hidden="true"
            style={{
              color: 'var(--cad-accent)',
              transition: 'opacity 150ms ease',
            }}
          />
        </button>
      )}

      <ColorDot
        color={data.color}
        onChange={data.onColor}
        title="Color de capa"
        warn={data.colorDuplicated}
      />

      {data.editableName && editing ? (
        <input
          autoFocus
          value={nameDraft}
          onChange={(e) => onNameDraftChange(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Nuevo nombre para la capa ${data.name}`}
          style={{
            flex: '1 1 120px',
            fontSize: '0.72rem',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid var(--cad-border)',
            borderRadius: 3,
            padding: '1px 4px',
            color: 'var(--cad-text)',
            outline: 'none',
            minWidth: 80,
          }}
        />
      ) : (
        <button
          type="button"
          className="cad-a11y-btn layer-row-name-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={onStartEdit}
          onContextMenu={onOpenContextMenu}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault();
              onStartEdit();
            }
          }}
          aria-label={`Capa ${data.name} — doble click para renombrar, click derecho para opciones`}
          style={{
            flex: '1 1 140px',
            justifyContent: 'flex-start',
            fontSize: '0.72rem',
            color: data.visible ? 'var(--cad-text)' : 'var(--cad-text-dim)',
            minWidth: 0,
            textAlign: 'left',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              width: '100%',
              minWidth: 0,
            }}
          >
            <span
              title={data.name}
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              {data.name}
            </span>
            {isActive && (
              <span
                aria-hidden="true"
                style={{
                  fontSize: '0.55rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: 'var(--cad-accent)',
                  border: '1px solid var(--cad-accent)',
                  borderRadius: 3,
                  padding: '0 4px',
                  flexShrink: 0,
                }}
              >
                ACTIVA
              </span>
            )}
            {data.locked && (
              <Lock size={9} aria-hidden="true" style={{ opacity: 0.6, flexShrink: 0 }} />
            )}
            {!!data.featureCount && (
              <span
                title={`${data.featureCount} elemento(s) en esta capa`}
                aria-hidden="true"
                style={{
                  fontSize: '0.55rem',
                  color: 'var(--cad-text-dim)',
                  border: '1px solid var(--cad-border)',
                  borderRadius: 8,
                  padding: '0 5px',
                  flexShrink: 0,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {data.featureCount}
              </span>
            )}
          </span>
        </button>
      )}
    </div>
  );
}

/* ----------- Menú contextual (click derecho) ----------- */

const ICON_BOX: React.CSSProperties = {
  width: 18,
  height: 18,
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--cad-text-dim)',
};
const ITEM_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  width: '100%',
  padding: '7px 10px',
  borderRadius: 5,
  fontSize: '0.72rem',
  fontWeight: 500,
  color: 'var(--cad-text-dim)',
  cursor: 'pointer',
  textAlign: 'left',
  background: 'transparent',
  border: '1px solid transparent',
  transition: 'background 100ms ease, color 100ms ease, border-color 100ms ease',
  position: 'relative',
};

interface LayerContextMenuProps {
  row: LayerRowData;
  x: number;
  y: number;
  isIsolated: boolean;
  onClose: () => void;
  onRename: () => void;
}

function LayerRowMenuItem({
  icon,
  children,
  onClick,
  disabled,
  destructive,
  hint,
  onClose,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  hint?: string;
  onClose?: () => void;
}) {
  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.currentTarget.style.background = destructive
      ? 'rgba(239, 68, 68, 0.12)'
      : 'var(--cad-bg-hover)';
    e.currentTarget.style.color = destructive ? 'var(--cad-accent-red)' : 'var(--cad-text)';
    e.currentTarget.style.borderColor = destructive
      ? 'rgba(239, 68, 68, 0.25)'
      : 'var(--cad-border)';
    const iconEl = e.currentTarget.querySelector('span[data-role="icon"]') as HTMLElement | null;
    if (iconEl) iconEl.style.color = destructive ? 'var(--cad-accent-red)' : 'var(--cad-accent)';
  };
  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.color = 'var(--cad-text-dim)';
    e.currentTarget.style.borderColor = 'transparent';
    const iconEl = e.currentTarget.querySelector('span[data-role="icon"]') as HTMLElement | null;
    if (iconEl) iconEl.style.color = 'var(--cad-text-dim)';
  };
  const handleClick = () => {
    if (disabled) return;
    onClick?.();
    onClose?.();
  };
  return (
    <button
      type="button"
      role="menuitem"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      disabled={disabled}
      style={{
        ...ITEM_BASE,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: destructive ? 'var(--cad-accent-red)' : 'var(--cad-text-dim)',
      }}
    >
      <span data-role="icon" style={ICON_BOX}>
        {icon}
      </span>
      <span style={{ flex: 1, lineHeight: 1.2 }}>{children}</span>
      {hint && (
        <span
          style={{
            fontSize: '0.58rem',
            fontWeight: 600,
            color: 'var(--cad-text-muted)',
            padding: '1px 6px',
            borderRadius: 3,
            background: 'var(--cad-bg-deepest)',
            border: '1px solid var(--cad-border)',
            letterSpacing: '0.04em',
          }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

function LayerContextMenu({
  row,
  x,
  y,
  isIsolated,
  onClose,
  onRename,
}: LayerContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [onClose]);

  const MENU_WIDTH = 280;
  const maxHeight = Math.max(180, Math.min(560, window.innerHeight - y - 12));
  const left = Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(Math.max(8, y), window.innerHeight - 120);

  const opacityPct = Math.round(row.opacity * 100);

  const headerAccent = row.color || 'var(--cad-accent)';

  return createPortal(
    <div
      ref={ref}
      className="cad-panel-glass animate-fade-in"
      role="menu"
      aria-label={`Opciones de la capa ${row.name}`}
      style={{
        position: 'fixed',
        top,
        left,
        width: MENU_WIDTH,
        maxHeight,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: 6,
        borderRadius: 8,
        zIndex: 'var(--z-ribbon-dropdown)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)',
      }}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <div
        style={{
          marginBottom: 5,
          padding: '8px 12px 8px 14px',
          borderRadius: 6,
          background:
            'linear-gradient(180deg, var(--cad-bg-surface) 0%, rgba(33, 45, 69, 0.4) 100%)',
          borderLeft: `3px solid ${headerAccent}`,
          boxShadow: `0 0 12px ${headerAccent}33`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 22,
              height: 22,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--cad-accent)',
              background: 'var(--cad-bg-deepest)',
              borderRadius: 4,
              border: '1px solid var(--cad-border)',
            }}
          >
            {geometryIconForKind(row.kind)}
          </span>
          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 700,
              color: 'var(--cad-text)',
              lineHeight: 1.15,
              flex: 1,
              minWidth: 0,
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            {row.name}
          </div>
          <span
            style={{
              fontSize: '0.58rem',
              color: 'var(--cad-text-dim)',
              fontWeight: 600,
              fontFamily: 'JetBrains Mono, monospace',
              padding: '1px 6px',
              borderRadius: 3,
              background: 'var(--cad-bg-deepest)',
              border: '1px solid var(--cad-border)',
              flexShrink: 0,
            }}
          >
            {row.featureCount ?? 0} elem.
          </span>
        </div>
      </div>

      {/* ── Acciones principales ─────────────────────────────── */}
      <LayerRowMenuItem
        icon={<ZoomIn size={13} />}
        onClick={row.onZoomToExtent}
        disabled={!row.onZoomToExtent || (row.featureCount ?? 0) === 0}
        onClose={onClose}
      >
        Zoom a extensión
      </LayerRowMenuItem>
      <LayerRowMenuItem icon={<Pencil size={13} />} onClick={onRename} onClose={onClose}>
        Renombrar
      </LayerRowMenuItem>
      {row.removable && (
        <LayerRowMenuItem
          icon={<IconTrash />}
          onClick={row.onRemove}
          onClose={onClose}
          destructive
        >
          Eliminar
        </LayerRowMenuItem>
      )}
      {row.onConfigureLabels && (
        <LayerRowMenuItem
          icon={<Tag size={13} />}
          onClick={row.onConfigureLabels}
          onClose={onClose}
          hint="…"
        >
          Etiquetado de capa
        </LayerRowMenuItem>
      )}
      {row.onIsolate && (
        <LayerRowMenuItem icon={<Focus size={13} />} onClick={row.onIsolate} onClose={onClose}>
          {isIsolated ? 'Quitar aislamiento' : 'Aislar esta capa'}
        </LayerRowMenuItem>
      )}
      <LayerRowMenuItem
        icon={<Pencil size={13} />}
        onClick={row.onToggleEditing}
        onClose={onClose}
        hint={row.editing && !row.locked ? 'activa' : undefined}
      >
        {row.editing ? 'Detener edición' : 'Iniciar edición'}
      </LayerRowMenuItem>
      {row.onDuplicate && (
        <LayerRowMenuItem
          icon={<Copy size={13} />}
          onClick={row.onDuplicate}
          onClose={onClose}
          hint="Ctrl+D"
        >
          Duplicar capa
        </LayerRowMenuItem>
      )}
      {row.lockable && (
        <LayerRowMenuItem
          icon={<IconLock locked={!!row.locked} />}
          onClick={row.onToggleLock}
          onClose={onClose}
        >
          {row.locked ? 'Desbloquear capa' : 'Bloquear capa'}
        </LayerRowMenuItem>
      )}

      {/* ── Opacidad (compacta) ───────────────────────────────── */}
      <div
        style={{
          marginTop: 3,
          padding: '7px 10px 8px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.6rem',
            color: 'var(--cad-text-dim)',
            marginBottom: 5,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={ICON_BOX}>
              <Ruler size={12} />
            </span>
            Opacidad
          </span>
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--cad-accent)',
              fontWeight: 700,
              fontSize: '0.62rem',
              padding: '1px 6px',
              borderRadius: 3,
              background: 'var(--cad-bg-deepest)',
              border: '1px solid var(--cad-border)',
            }}
          >
            {opacityPct}%
          </span>
        </div>
        <OpacitySlider value={row.opacity} onChange={row.onOpacity} layerName={row.name} full />
      </div>
    </div>,
    document.body
  );
}

/* ----------- Adaptador del store ----------- */

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
  isolatedLayerId: string | null
): Array<LayerRowData & { zIndex: number }> {
  const layers = useLayersStore((s) => s.layers);
  const toggleIsolate = useLayersStore((s) => s.toggleIsolate);
  const editingLayerIds = useEditSessionStore((s) => s.editingLayerIds); // NEW
  const toggleEditingLayer = useEditSessionStore((s) => s.toggleEditing);
  const duplicatedColorIds = useMemo(() => computeDuplicatedColorIds(layers), [layers]);
  const handleZoomToLayer = (layerId: string) => {
    const map = useMapStore.getState().mapInstance;
    const drawSource = useMapStore.getState().drawSource;
    if (!map || !drawSource) return;
    const ext = computeLayerExtent(drawSource, layerId);
    if (!ext || !isFinite(ext[0])) return;
    map
      .getView()
      .fit(ext, { size: map.getSize() ?? undefined, maxZoom: 19, padding: [60, 60, 60, 60] });
  };

  const handleDuplicate = (layer: { id: string; name: string }) => {
    const newName = `${layer.name} (copia)`;
    void (async () => {
      const duplicateFeatures = await confirmAsync(
        `¿Duplicar también los elementos de "${layer.name}" a la capa nueva?\n\nAceptar = copiar elementos · Cancelar = capa vacía`,
        { title: 'Duplicar capa', confirmLabel: 'Copiar elementos', cancelLabel: 'Capa vacía' }
      );
      const newLayerId = newId('layer-dup');
      await runCommand(
        new DuplicateLayerCommand({
          sourceLayerId: layer.id,
          newLayerId,
          newName,
          duplicateFeatures,
        })
      );
      toast(`Capa "${newName}" creada.`, { variant: 'success' });
    })();
  };

  const handleMoveSelectionHere = (layerId: string) => {
    const ids = Array.from(useSelectionStore.getState().selectedIds);
    if (ids.length === 0) return;
    void runCommand(new MoveFeaturesToLayerCommand(ids, layerId));
  };

  const handleConfigureLabels = (layer: { id: string; kind: LayerKind }) => {
    const savedStyle = useLabelClassStore.getState().getForLayer(layer.id)?.style;
    const modal = useLabelConfigModalStore.getState();
    if (layer.kind === 'lote') {
      const style =
        savedStyle ??
        modal.lastLotsConfig ??
        defaultLabelStyleConfig({ prefix: 'Lote', color: defaultColorForKind('lote') });
      modal.openForLotsBatch(undefined, style, layer.id);
      return;
    }
    if (layer.kind === 'manzana') {
      const style =
        savedStyle ??
        modal.lastManzanoConfig ??
        defaultLabelStyleConfig({ prefix: 'Mzo.', color: defaultColorForKind('manzana') });
      modal.openForManzanoBatch(style, layer.id);
      return;
    }
    const style = savedStyle ?? defaultLabelStyleConfig({ color: defaultColorForKind(layer.kind) });
    modal.openForLayerBatch(layer.id, style);
  };

  return layers.map((l): LayerRowData & { zIndex: number } => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    color: l.color,
    showLabel: l.showLabel,
    showCota: l.showCota,
    editableName: true,
    removable: true,
    lockable: true,
    locked: l.locked,
    editing: editingLayerIds.has(l.id),
    kind: l.kind,
    reorderable: true,
    isDataLayer: true,
    featureCount: featureCounts[l.id] ?? 0,
    colorDuplicated: duplicatedColorIds.has(l.id),
    isIsolated: isolatedLayerId === l.id,
    zIndex: l.zIndex,
    onToggleVisible: () =>
      void runCommand(new UpdateLayerCommand(l.id, { visible: !l.visible }, 'Visibilidad de capa')),
    onOpacity: (v) =>
      void runCommand(new UpdateLayerCommand(l.id, { opacity: v }, 'Opacidad de capa')),
    onColor: (c) => void runCommand(new UpdateLayerCommand(l.id, { color: c }, 'Color de capa')),
    onToggleLabel: () =>
      void runCommand(
        new UpdateLayerCommand(l.id, { showLabel: !l.showLabel }, 'Mostrar etiqueta de capa')
      ),
    onToggleCota: () =>
      void runCommand(
        new UpdateLayerCommand(l.id, { showCota: !l.showCota }, 'Mostrar acotación de capa')
      ),
    onRename: (name) => void runCommand(new UpdateLayerCommand(l.id, { name }, 'Renombrar capa')),
    onToggleLock: () =>
      void runCommand(new UpdateLayerCommand(l.id, { locked: !l.locked }, 'Bloqueo de capa')),
    onToggleEditing: () => toggleEditingLayer(l.id),
    onRemove: () => onRequestRemove({ id: l.id, name: l.name }),
    onIsolate: () => toggleIsolate(l.id),
    onZoomToExtent: () => handleZoomToLayer(l.id),
    onDuplicate: () => handleDuplicate({ id: l.id, name: l.name }),
    onMoveSelectionHere: () => handleMoveSelectionHere(l.id),
    onConfigureLabels: () => handleConfigureLabels(l),
  }));
}

/* ----------- Header de sección ----------- */

function SectionHeader({
  label,
  count,
  expanded,
  onToggle,
  panelId,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  panelId: string;
}) {
  return (
    <button
      type="button"
      className="cad-a11y-btn layer-section-header"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={panelId}
      style={{ width: '100%', justifyContent: 'flex-start', gap: 5, padding: '3px 0' }}
    >
      <IconChevron open={expanded} />
      <span style={{ fontSize: '0.68rem', color: 'var(--cad-text-dim)', fontWeight: 500 }}>
        {label}
      </span>
      <span
        aria-hidden="true"
        style={{ fontSize: '0.6rem', color: 'var(--cad-text-dim)', marginLeft: 'auto' }}
      >
        {count}
      </span>
    </button>
  );
}

/* ----------- Panel principal ----------- */
export default function LayerPanel() {
  const open = useLayerPanelUiStore((s) => s.open);
  const setOpen = useLayerPanelUiStore((s) => s.setOpen);
  const expandedData = useLayerPanelUiStore((s) => s.expandedData);
  const setExpandedData = useLayerPanelUiStore((s) => s.setExpandedData);

  const [deleteRequest, setDeleteRequest] = useState<LayerDeleteRequest | null>(null);

  const activeLayerId = useLayersStore((s) => s.activeLayerId);
  const isolatedLayerId = useLayersStore((s) => s.isolatedLayerId);
  const setActiveLayer = useLayersStore((s) => s.setActiveLayer);

  const drawSource = useMapStore((s) => s.drawSource);
  const tick = useDrawSourceTick(drawSource);
  const streets = useStreetStore((s) => s.streets);
  const roundabouts = useRoundaboutStore((s) => s.roundabouts);
  const featureCounts = useMemo(
    () => computeLayerFeatureCounts(drawSource),
    [drawSource, tick, streets, roundabouts]
  );
  const selectedCount = useSelectionStore((s) => s.selectedIds.size);

  const registryRows = useRegistryRows(setDeleteRequest, featureCounts, isolatedLayerId);
  const registryRowsDisplay = [...registryRows].sort((a, b) => b.zIndex - a.zIndex);

  const viewportWidth = useViewportWidth();
  const panelMinWidth = Math.min(240, viewportWidth - 24);

  const panelRef = useRef<HTMLDivElement>(null);
  const allRowsForIncremental = expandedData ? registryRowsDisplay : [];
  const { visibleCount, sentinelRef } = useIncrementalRender(
    allRowsForIncremental.length,
    60,
    panelRef
  );
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [rowRects, setRowRects] = useState<Record<string, DOMRect>>({});

  const reorderRows = useMemo<PointerReorderRow[]>(
    () =>
      registryRowsDisplay.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        rect: rowRects[r.id] ?? new DOMRect(0, 0, 0, 0),
      })),
    [registryRowsDisplay, rowRects]
  );
  const refreshRects = useCallback(() => {
    const next: Record<string, DOMRect> = {};
    for (const [id, el] of rowRefs.current) {
      next[id] = el.getBoundingClientRect();
    }
    setRowRects((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) return next;
      for (const id of nextKeys) {
        const a = prev[id];
        const b = next[id];
        if (
          !a ||
          a.top !== b.top ||
          a.bottom !== b.bottom ||
          a.left !== b.left ||
          a.width !== b.width ||
          a.height !== b.height
        ) {
          return next;
        }
      }
      return prev;
    });
  }, []);

  const setRowRef = useCallback(
    (id: string, el: HTMLDivElement | null) => {
      if (el) {
        const isNew = !rowRefs.current.has(id);
        rowRefs.current.set(id, el);
        if (isNew) {
          requestAnimationFrame(refreshRects);
        }
      } else {
        rowRefs.current.delete(id);
      }
    },
    [refreshRects]
  );

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(refreshRects);
    };
    panel.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      panel.removeEventListener('scroll', onScroll);
    };
  }, [open, refreshRects]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(refreshRects);
    });
    ro.observe(panel);
    return () => ro.disconnect();
  }, [open, refreshRects]);

  const handleReorderDrop = useCallback(
    (sourceId: string, targetId: string, position: DropPosition) => {
      if (sourceId === targetId) return;
      const layers = useLayersStore.getState().layers;
      const targetStoreIdx = layers.findIndex((l) => l.id === targetId);
      if (targetStoreIdx === -1) return;
      const targetStorePos = position === 'before' ? targetStoreIdx + 1 : targetStoreIdx;
      void runCommand(new ReorderLayersCommand([sourceId], targetStorePos));
    },
    []
  );

  const {
    state: dragState,
    rowProps: dragRowProps,
    scrollerRef,
  } = usePointerLayerReorder({
    rows: reorderRows,
    getLiveRect: useCallback((id: string) => {
      const el = rowRefs.current.get(id);
      return el ? el.getBoundingClientRect() : null;
    }, []),
    threshold: 4,
    onDrop: handleReorderDrop,
    enabled: open && expandedData && registryRowsDisplay.length > 1,
  });

  const measureRef = useRef<HTMLSpanElement>(null);
  const [autoPanelWidth, setAutoPanelWidth] = useState<number>(panelMinWidth);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = measureRef.current;
    if (!measure) return;
    const longest =
      registryRowsDisplay.length === 0
        ? '—'
        : registryRowsDisplay.reduce((acc, r) => (r.name.length > acc.length ? r.name : acc), '');
    measure.textContent = longest;
    const max = viewportWidth - 24;
    const w = Math.max(240, Math.min(max, Math.round(measure.scrollWidth + 88)));
    setAutoPanelWidth(w);
  }, [registryRowsDisplay, open, viewportWidth]);

  const [addLayerOpen, setAddLayerOpen] = useState(false);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  const startEditingLayer = (id: string, currentName: string) => {
    setEditingLayerId(id);
    setNameDraft(currentName);
  };
  const commitEditingLayer = () => {
    if (editingLayerId) {
      const row = registryRowsDisplay.find((r) => r.id === editingLayerId);
      const trimmed = nameDraft.trim();
      if (trimmed && row) row.onRename?.(trimmed);
    }
    setEditingLayerId(null);
  };
  const cancelEditingLayer = () => setEditingLayerId(null);
  const [contextMenu, setContextMenu] = useState<{ layerId: string; x: number; y: number } | null>(
    null
  );
  const openContextMenu = (e: React.MouseEvent, layerId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 250;
    const x = Math.min(Math.max(8, e.clientX), window.innerWidth - menuWidth - 8);
    const y = Math.min(Math.max(8, e.clientY), window.innerHeight - 40);
    setContextMenu({ layerId, x, y });
  };
  const closeContextMenu = () => setContextMenu(null);

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, row: LayerRowData) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const panel = panelRef.current;
      if (!panel) return;
      e.preventDefault();
      const rows = Array.from(panel.querySelectorAll<HTMLElement>('[data-layer-row="true"]'));
      const idx = rows.findIndex((el) => el === e.currentTarget);
      if (idx === -1) return;
      const nextIdx =
        e.key === 'ArrowDown' ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1);
      rows[nextIdx]?.focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      row.onToggleVisible();
    }
  };

  const contextMenuRow = contextMenu
    ? (registryRowsDisplay.find((r) => r.id === contextMenu.layerId) ?? null)
    : null;

  let renderedSoFar = 0;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 'calc(var(--cad-topbar-height) + 12px)',
          right: 12,
          zIndex: 90,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
        }}
      >
        <button
          onClick={() => setOpen(!open)}
          className="cad-icon-btn cad-tooltip"
          data-tooltip="Capas"
          aria-expanded={open}
          aria-label={open ? 'Cerrar panel de capas' : 'Abrir panel de capas'}
          style={{
            display: 'flex',
            marginBottom: open ? 6 : 0,
            background: open ? 'var(--cad-bg-active)' : 'rgba(26, 34, 54, 0.85)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--cad-border)',
            color: open ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
          }}
        >
          <Layers size={14} aria-hidden="true" />
        </button>

        {open && (
          <div
            ref={(el) => {
              panelRef.current = el;
              scrollerRef.current = el;
            }}
            className="cad-panel-glass animate-fade-in"
            role="region"
            aria-label="Panel de capas"
            style={{
              padding: '10px 12px',
              width: autoPanelWidth,
              maxWidth: viewportWidth - 24,
              maxHeight: '65vh',
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          >
            <span
              ref={measureRef}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: -9999,
                top: -9999,
                visibility: 'hidden',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                fontSize: '0.72rem',
                fontWeight: 600,
                fontFamily: 'Inter, system-ui, sans-serif',
                letterSpacing: 'normal',
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
                paddingBottom: 6,
                borderBottom: '1px solid var(--cad-border)',
              }}
            >
              <span
                style={{
                  fontSize: '0.6rem',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--cad-text-dim)',
                }}
              >
                Capas
              </span>
              <button
                onClick={() => setAddLayerOpen(true)}
                className="cad-icon-btn cad-tooltip"
                data-tooltip="Nueva capa"
                aria-label="Crear nueva capa"
                style={{
                  width: 22,
                  height: 22,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconPlus />
              </button>
            </div>

            {isolatedLayerId && (
              <div
                role="status"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  marginBottom: 6,
                  borderRadius: 6,
                  background: 'rgba(0,212,255,0.08)',
                  border: '1px dashed var(--cad-accent)',
                  fontSize: '0.62rem',
                  color: 'var(--cad-accent)',
                }}
              >
                <Focus size={12} aria-hidden="true" />
                <span style={{ flex: 1 }}>
                  Aislando:{' '}
                  {registryRows.find((r) => r.id === isolatedLayerId)?.name ?? isolatedLayerId}
                </span>
                <button
                  onClick={() => useLayersStore.getState().toggleIsolate(isolatedLayerId)}
                  className="cad-icon-btn"
                  aria-label="Mostrar todas las capas (quitar aislamiento)"
                  style={{
                    width: 'auto',
                    height: 'auto',
                    padding: '2px 6px',
                    fontSize: '0.58rem',
                    color: 'var(--cad-accent)',
                  }}
                >
                  Mostrar todas
                </button>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                marginBottom: 8,
                borderRadius: 6,
                background: 'var(--cad-bg-surface)',
                border: '1px solid var(--cad-border)',
                fontSize: '0.65rem',
              }}
            >
              <IconTarget filled={activeLayerId != null} />
              <select
                value={activeLayerId ?? ''}
                onChange={(e) => setActiveLayer(e.target.value || null)}
                title="Capa activa — los nuevos trazos se asignan acá"
                aria-label="Capa activa"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'var(--cad-bg-deepest)',
                  border: '1px solid var(--cad-border)',
                  borderRadius: 3,
                  color: activeLayerId ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
                  fontSize: '0.7rem',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontWeight: 600,
                  padding: '2px 6px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="">— Sin capa activa —</option>
                {registryRowsDisplay.map((r) => (
                  <option key={r.id} value={r.id} disabled={r.locked}>
                    {r.name}
                    {r.locked ? ' 🔒' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <SectionHeader
                panelId="layerpanel-data-section"
                label="Capas de datos"
                count={registryRowsDisplay.length}
                expanded={expandedData}
                onToggle={() => setExpandedData(!expandedData)}
              />
              {expandedData && (
                <div id="layerpanel-data-section" style={{ marginTop: 2 }}>
                  {registryRowsDisplay.length === 0 ? (
                    <p
                      style={{
                        fontSize: '0.65rem',
                        color: 'var(--cad-text-muted)',
                        padding: '6px 2px',
                        fontStyle: 'italic',
                      }}
                    >
                      Todavía no hay capas. Se crean automáticamente al dibujar o generar tu primera
                      entidad · o con el botón "+" de arriba.
                    </p>
                  ) : (
                    registryRowsDisplay.map((row) => {
                      if (renderedSoFar >= visibleCount) return null;
                      renderedSoFar++;
                      const isActive = activeLayerId === row.id;
                      const props = dragRowProps(row.id);
                      const showIndicatorBefore =
                        dragState.dropTarget?.id === row.id &&
                        dragState.dropTarget.position === 'before';
                      const showIndicatorAfter =
                        dragState.dropTarget?.id === row.id &&
                        dragState.dropTarget.position === 'after';
                      return (
                        <div key={row.id}>
                          {showIndicatorBefore && (
                            <LayerDropIndicator color={dragState.draggingRow?.color} />
                          )}
                          <div
                            style={{
                              borderRadius: 4,
                              background:
                                row.editing && !row.locked
                                  ? 'rgba(245,158,11,0.08)'
                                  : isActive
                                    ? 'rgba(0,212,255,0.08)'
                                    : row.isIsolated
                                      ? 'rgba(0,212,255,0.05)'
                                      : 'transparent',
                              border:
                                row.editing && !row.locked
                                  ? '1px solid rgba(245,158,11,0.35)'
                                  : isActive
                                    ? '1px solid rgba(0,212,255,0.25)'
                                    : row.isIsolated
                                      ? '1px dashed rgba(0,212,255,0.4)'
                                      : '1px solid transparent',
                            }}
                          >
                            <LayerRow
                              data={row}
                              isActive={isActive}
                              editing={editingLayerId === row.id}
                              nameDraft={nameDraft}
                              dragging={
                                dragState.draggingId === row.id && dragState.draggingRow != null
                              }
                              canMoveSelection={selectedCount > 0 && !row.locked}
                              onNameDraftChange={setNameDraft}
                              onStartEdit={() => startEditingLayer(row.id, row.name)}
                              onCommitEdit={commitEditingLayer}
                              onCancelEdit={cancelEditingLayer}
                              onOpenContextMenu={(e) => openContextMenu(e, row.id)}
                              onRowKeyDown={(e) => handleRowKeyDown(e, row)}
                              onRowPointerDown={props.onPointerDown}
                              rowRef={(el) => setRowRef(row.id, el)}
                            />
                          </div>
                          {showIndicatorAfter && (
                            <LayerDropIndicator color={dragState.draggingRow?.color} />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {allRowsForIncremental.length > visibleCount && (
              <div ref={sentinelRef} style={{ height: 1 }} />
            )}
          </div>
        )}
      </div>

      {contextMenu && contextMenuRow && (
        <LayerContextMenu
          row={contextMenuRow}
          x={contextMenu.x}
          y={contextMenu.y}
          isIsolated={isolatedLayerId === contextMenuRow.id}
          onClose={closeContextMenu}
          onRename={() => startEditingLayer(contextMenuRow.id, contextMenuRow.name)}
        />
      )}

      <LayerDeleteModal request={deleteRequest} onClose={() => setDeleteRequest(null)} />
      <AddLayerModal open={addLayerOpen} onOpenChange={setAddLayerOpen} />
      <LayerReorderPill row={dragState.draggingRow} pointer={dragState.pointer} />
    </>
  );
}
