import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Table2,
  Search,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
  ZoomIn,
  Tag,
} from 'lucide-react';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { Extent } from 'ol/extent.js';
import { useAttributeTableStore } from '../store/attributeTableStore';
import { readAttributeRows } from '../selectors/attributeRows';
import {
  FEATURE_COLUMNS_BY_KIND,
  STREET_COLUMNS,
  ROUNDABOUT_COLUMNS,
  type AttributeColumnDef,
} from '../model/attributeColumns';
import { UpdateFeaturePropertyCommand } from '../commands/UpdateFeaturePropertyCommand';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { MoveFeaturesToLayerCommand } from '@layers-engine/commands/MoveFeaturesToLayerCommand';
import { useMapStore } from '@map-core/store/mapStore';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { useDrawSourceTick } from '@shared-ui/hooks/useDrawSourceTick';
import { useIncrementalRender } from '@shared-ui/hooks/useIncrementalRender';
import { runCommand } from '@kernel/command/CommandStack';
import { DeleteFeaturesCommand } from '@drawing-engine/commands/DeleteFeaturesCommand';
import { useStreetStore, type Street } from '@vias-engine/store/streetStore';
import { useRoundaboutStore, type Roundabout } from '@vias-engine/store/roundaboutStore';
import type { RoundaboutParams } from '@vias-engine/geometry/roundaboutEngine';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { recomputeManzanos } from '@manzanos-engine/orchestration/recomputeManzanos';
import { toast } from '@shared-ui/store/toastStore';
import { useLabelClassStore } from '@label-engine/store/labelClassStore';
import { UpsertLabelClassCommand } from '@label-engine/commands/UpsertLabelClassCommand';
import { defaultLabelStyleConfig, defaultColorForKind } from '@label-engine/model/labelModel';

const PANEL_MIN_H = 180;
const PANEL_MAX_RATIO = 0.72;
const PANEL_DEFAULT_H = 300;

function extentFromPoints(pts: Array<[number, number]>, padM = 0): Extent {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX - padM, minY - padM, maxX + padM, maxY + padM];
}

interface RowDescriptor<T> {
  id: string | number;
  item: T;
}

interface AttributeGridProps<T> {
  columns: AttributeColumnDef<T>[];
  rows: RowDescriptor<T>[];
  isSelected: (id: string | number) => boolean;
  onSelectRow: (id: string | number) => void;
  onZoomRow: (item: T) => void;
  onCommitEdit: (id: string | number, key: string, value: unknown) => void;
  isLabelField?: (key: string) => boolean;
  onToggleLabelField?: (key: string) => void;
}

function AttributeGrid<T>({
  columns,
  rows,
  isSelected,
  onSelectRow,
  onZoomRow,
  onCommitEdit,
  isLabelField,
  onToggleLabelField,
}: AttributeGridProps<T>) {
  const search = useAttributeTableStore((s) => s.search);
  const sortKey = useAttributeTableStore((s) => s.sortKey);
  const sortDir = useAttributeTableStore((s) => s.sortDir);
  const toggleSort = useAttributeTableStore((s) => s.toggleSort);
  const onlySelected = useAttributeTableStore((s) => s.onlySelected);

  const filtered = useMemo(() => {
    let list = rows;
    if (onlySelected) list = list.filter((r) => isSelected(r.id));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => columns.some((c) => c.get(r.item).toLowerCase().includes(q)));
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        list = [...list].sort((a, b) => {
          const va = col.get(a.item);
          const vb = col.get(b.item);
          const na = parseFloat(va);
          const nb = parseFloat(vb);
          const cmp =
            Number.isFinite(na) && Number.isFinite(nb)
              ? na - nb
              : va.localeCompare(vb, undefined, { numeric: true });
          return sortDir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return list;
  }, [rows, search, sortKey, sortDir, onlySelected, columns, isSelected]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const { visibleCount, sentinelRef } = useIncrementalRender(filtered.length, 60, bodyRef);
  const [editing, setEditing] = useState<{ id: string | number; key: string } | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--cad-border)',
          flexShrink: 0,
          background: 'var(--cad-bg-panel)',
        }}
      >
        <div style={{ width: 34, flexShrink: 0 }} />
        {columns.map((col) => (
          <div
            key={col.key}
            style={{ flex: 1, minWidth: 90, display: 'flex', alignItems: 'center' }}
          >
            <button
              onClick={() => toggleSort(col.key)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start',
                padding: '6px 8px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.64rem',
                fontWeight: 700,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                color: sortKey === col.key ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
              }}
            >
              {col.label}
              {sortKey === col.key ? (
                sortDir === 'asc' ? (
                  <ArrowUp size={10} />
                ) : (
                  <ArrowDown size={10} />
                )
              ) : (
                <ArrowUpDown size={10} style={{ opacity: 0.35 }} />
              )}
            </button>
            {col.key !== 'fid' && onToggleLabelField && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLabelField(col.key);
                }}
                title={
                  isLabelField?.(col.key) ? 'Quitar de la etiqueta' : 'Usar como campo de etiqueta'
                }
                aria-label={
                  isLabelField?.(col.key) ? 'Quitar de la etiqueta' : 'Usar como campo de etiqueta'
                }
                className="cad-a11y-btn"
                style={{
                  padding: 3,
                  marginRight: 4,
                  color: isLabelField?.(col.key) ? 'var(--cad-accent)' : 'var(--cad-text-muted)',
                  flexShrink: 0,
                }}
              >
                <Tag size={10} />
              </button>
            )}
          </div>
        ))}
        <div style={{ width: 34, flexShrink: 0 }} />
      </div>

      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <p
            style={{
              padding: 16,
              fontSize: '0.7rem',
              color: 'var(--cad-text-muted)',
              textAlign: 'center',
            }}
          >
            Sin resultados.
          </p>
        ) : (
          filtered.slice(0, visibleCount).map((row) => {
            const selected = isSelected(row.id);
            return (
              <div
                key={String(row.id)}
                onClick={() => onSelectRow(row.id)}
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  cursor: 'pointer',
                  background: selected ? 'var(--cad-bg-active)' : 'transparent',
                  borderBottom: '1px solid var(--cad-border)',
                  boxShadow: selected ? 'inset 2px 0 0 var(--cad-accent-amber)' : 'none',
                }}
              >
                <div
                  style={{
                    width: 34,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onZoomRow(row.item);
                    }}
                    className="cad-a11y-btn"
                    title="Zoom a este elemento"
                    aria-label="Zoom a este elemento"
                    style={{ color: 'var(--cad-text-dim)', padding: 3 }}
                  >
                    <ZoomIn size={12} />
                  </button>
                </div>
                {columns.map((col) => {
                  const isEditingThis = editing?.id === row.id && editing.key === col.key;
                  return (
                    <div
                      key={col.key}
                      onDoubleClick={(e) => {
                        if (!col.editable) return;
                        e.stopPropagation();
                        setEditing({ id: row.id, key: col.key });
                      }}
                      style={{
                        flex: 1,
                        minWidth: 90,
                        padding: '6px 8px',
                        fontSize: '0.7rem',
                        color: 'var(--cad-text)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start',
                        overflow: 'hidden',
                      }}
                    >
                      {isEditingThis ? (
                        <input
                          autoFocus
                          defaultValue={col.get(row.item)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            const parsed = col.parse ? col.parse(e.target.value) : e.target.value;
                            onCommitEdit(row.id, col.key, parsed);
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          className="cad-input cad-input-sm"
                          style={{
                            marginTop: 0,
                            textAlign: col.align === 'right' ? 'right' : 'left',
                          }}
                        />
                      ) : (
                        <span
                          title={col.get(row.item)}
                          style={{
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            cursor: col.editable ? 'text' : 'default',
                          }}
                        >
                          {col.get(row.item)}
                        </span>
                      )}
                    </div>
                  );
                })}
                <div style={{ width: 34, flexShrink: 0 }} />
              </div>
            );
          })
        )}
        {filtered.length > visibleCount && <div ref={sentinelRef} style={{ height: 1 }} />}
      </div>
    </div>
  );
}

export default function AttributeTablePanel() {
  const open = useAttributeTableStore((s) => s.open);
  const layerId = useAttributeTableStore((s) => s.layerId);
  const close = useAttributeTableStore((s) => s.close);
  const search = useAttributeTableStore((s) => s.search);
  const setSearch = useAttributeTableStore((s) => s.setSearch);
  const onlySelected = useAttributeTableStore((s) => s.onlySelected);
  const setOnlySelected = useAttributeTableStore((s) => s.setOnlySelected);

  const layers = useLayersStore((s) => s.layers);
  const layer = layerId ? layers.find((l) => l.id === layerId) : undefined;

  const drawSource = useMapStore((s) => s.drawSource);
  const mapInstance = useMapStore((s) => s.mapInstance);
  useDrawSourceTick(drawSource);
  const streets = useStreetStore((s) => s.streets);
  const roundabouts = useRoundaboutStore((s) => s.roundabouts);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const setSelection = useSelectionStore((s) => s.setSelection);
  const labelClass = useLabelClassStore((s) => (layer ? s.byLayerId[layer.id] : undefined));

  const [height, setHeight] = useState(PANEL_DEFAULT_H);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    if (open && layerId && !layer) close();
  }, [open, layerId, layer, close]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const maxH = window.innerHeight * PANEL_MAX_RATIO;
      setHeight(Math.min(maxH, Math.max(PANEL_MIN_H, d.startH + (d.startY - e.clientY))));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  if (!open || !layer) return null;

  const fitExtent = (ext: Extent) => {
    if (!mapInstance || !ext.every((v) => Number.isFinite(v))) return;
    mapInstance
      .getView()
      .fit(ext, { size: mapInstance.getSize(), maxZoom: 20, padding: [80, 80, 80, 80] });
  };

  const activeFieldKeys = new Set(labelClass?.style.fieldBindings ?? []);
  const toggleLabelField = (key: string) => {
    const base =
      labelClass?.style ?? defaultLabelStyleConfig({ color: defaultColorForKind(layer.kind) });
    const next = new Set(base.fieldBindings ?? []);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    void runCommand(
      new UpsertLabelClassCommand({
        layerId: layer.id,
        style: { ...base, fieldBindings: Array.from(next) },
        enabled: labelClass?.enabled ?? true,
        numbering: labelClass?.numbering,
        priority: labelClass?.priority,
        visibleMinZoom: labelClass?.visibleMinZoom,
        visibleMaxZoom: labelClass?.visibleMaxZoom,
      })
    );
  };
  const isLabelField = (key: string) => activeFieldKeys.has(key);

  let gridEl: React.JSX.Element;
  let selectedCountInScope = 0;
  let onMoveToLayer: ((targetId: string) => void) | null = null;
  let onDeleteSelected: (() => void) | null = null;
  let moveTargets: Array<{ id: string; name: string }> = [];

  if (layer.kind === 'via') {
    const fallbackViaId = useLayersStore.getState().getLayerForKind('via')?.id;
    const rows = streets
      .filter((s) => (s.layerId ?? fallbackViaId) === layer.id)
      .map((s) => ({ id: s.id, item: s }));
    selectedCountInScope = rows.filter((r) => selectedIds.has(r.id)).length;
    moveTargets = layers
      .filter((l) => l.kind === 'via' && l.id !== layer.id)
      .map((l) => ({ id: l.id, name: l.name }));
    onMoveToLayer = (targetId) => {
      for (const r of rows) {
        if (selectedIds.has(r.id))
          useStreetStore.getState().updateStreet(r.id, { layerId: targetId });
      }
    };
    onDeleteSelected = () => {
      const ids = rows.filter((r) => selectedIds.has(r.id)).map((r) => r.id);
      for (const id of ids) {
        useStreetStore.getState().removeStreet(id);
        useEntityLabelStore.getState().remove(id);
      }
      if (ids.length > 0) void recomputeManzanos();
    };
    gridEl = (
      <AttributeGrid<Street>
        columns={STREET_COLUMNS}
        rows={rows}
        isSelected={(id) => selectedIds.has(id)}
        onSelectRow={(id) => setSelection([id], id)}
        onZoomRow={(s) =>
          fitExtent(
            extentFromPoints(
              [s.start, ...(s.waypoints ?? []), s.end],
              s.widthM / 2 + (s.sideWidthM ?? 0) + 10
            )
          )
        }
        onCommitEdit={(id, key, value) =>
          useStreetStore
            .getState()
            .updateStreet(id as string, { [key]: value } as unknown as Partial<Omit<Street, 'id'>>)
        }
        isLabelField={isLabelField}
        onToggleLabelField={toggleLabelField}
      />
    );
  } else if (layer.kind === 'rotonda') {
    const fallbackViaId = useLayersStore.getState().getLayerForKind('via')?.id;
    const rows = roundabouts
      .filter((r) => (r.layerId ?? fallbackViaId) === layer.id)
      .map((r) => ({ id: r.id, item: r }));
    selectedCountInScope = rows.filter((r) => selectedIds.has(r.id)).length;
    moveTargets = layers
      .filter((l) => l.kind === 'rotonda' && l.id !== layer.id)
      .map((l) => ({ id: l.id, name: l.name }));
    onMoveToLayer = (targetId) => {
      for (const r of rows) {
        if (selectedIds.has(r.id))
          useRoundaboutStore
            .getState()
            .updateRoundabout(r.id, { layerId: targetId } as unknown as Partial<RoundaboutParams>);
      }
    };
    onDeleteSelected = () => {
      const ids = rows.filter((r) => selectedIds.has(r.id)).map((r) => r.id);
      for (const id of ids) {
        useRoundaboutStore.getState().removeRoundabout(id);
        useEntityLabelStore.getState().remove(id);
      }
    };
    gridEl = (
      <AttributeGrid<Roundabout>
        columns={ROUNDABOUT_COLUMNS}
        rows={rows}
        isSelected={(id) => selectedIds.has(id)}
        onSelectRow={(id) => setSelection([id], id)}
        onZoomRow={(r) => {
          const half = r.radiusM + r.roadWidthM + Math.max(0, r.sidewalkWidthM) + 10;
          fitExtent([
            r.center[0] - half,
            r.center[1] - half,
            r.center[0] + half,
            r.center[1] + half,
          ]);
        }}
        onCommitEdit={(id, key, value) =>
          useRoundaboutStore
            .getState()
            .updateRoundabout(
              id as string,
              { [key]: value } as unknown as Partial<RoundaboutParams>
            )
        }
        isLabelField={isLabelField}
        onToggleLabelField={toggleLabelField}
      />
    );
  } else {
    const columns = FEATURE_COLUMNS_BY_KIND[layer.kind] ?? [];
    const rows = readAttributeRows(drawSource, layer.id).map((r) => ({
      id: r.id,
      item: r.feature,
    }));
    selectedCountInScope = rows.filter((r) => selectedIds.has(r.id)).length;
    moveTargets = layers
      .filter((l) => l.kind === layer.kind && l.id !== layer.id)
      .map((l) => ({ id: l.id, name: l.name }));
    onMoveToLayer = (targetId) => {
      const ids = rows.filter((r) => selectedIds.has(r.id)).map((r) => r.id);
      if (ids.length > 0) void runCommand(new MoveFeaturesToLayerCommand(ids, targetId));
    };
    onDeleteSelected = () => {
      const ids = rows.filter((r) => selectedIds.has(r.id)).map((r) => r.id);
      if (ids.length === 0) return;
      const cmd = new DeleteFeaturesCommand(ids);
      void runCommand(cmd);
      if (cmd.skippedCount > 0) {
        toast(
          `${cmd.skippedCount} elemento(s) no se borraron (capa bloqueada o sin edición activa).`,
          {
            variant: 'warning',
          }
        );
      }
    };
    gridEl = (
      <AttributeGrid<Feature<Geometry>>
        columns={columns}
        rows={rows}
        isSelected={(id) => selectedIds.has(id)}
        onSelectRow={(id) => setSelection([id], id)}
        onZoomRow={(f) => {
          const geom = f.getGeometry();
          if (geom) fitExtent(geom.getExtent());
        }}
        onCommitEdit={(id, key, value) =>
          void runCommand(new UpdateFeaturePropertyCommand(id, key, value))
        }
        isLabelField={isLabelField}
        onToggleLabelField={toggleLabelField}
      />
    );
  }

  return (
    <div
      className="cad-panel-glass"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'var(--cad-statusbar-height)',
        height,
        zIndex: 130,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: 'none',
      }}
    >
      <div
        onMouseDown={(e) => {
          dragRef.current = { startY: e.clientY, startH: height };
        }}
        style={{ height: 6, cursor: 'ns-resize', flexShrink: 0 }}
        title="Arrastrar para redimensionar"
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--cad-border)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <Table2 size={14} style={{ color: layer.color }} />
        <strong style={{ fontSize: '0.76rem', color: 'var(--cad-text)' }}>{layer.name}</strong>
        <span style={{ fontSize: '0.6rem', color: 'var(--cad-text-muted)' }}>
          Tabla de atributos
        </span>

        <div style={{ position: 'relative', marginLeft: 12 }}>
          <Search
            size={11}
            style={{
              position: 'absolute',
              left: 7,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--cad-text-muted)',
            }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="cad-input cad-input-sm"
            style={{ marginTop: 0, paddingLeft: 22, width: 160 }}
          />
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: '0.65rem',
            color: 'var(--cad-text-dim)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            className="cad-toggle"
            checked={onlySelected}
            onChange={(e) => setOnlySelected(e.target.checked)}
          />
          Solo seleccionados
        </label>

        <div style={{ flex: 1 }} />

        {selectedCountInScope > 0 && (
          <span style={{ fontSize: '0.62rem', color: 'var(--cad-accent-amber)' }}>
            {selectedCountInScope} seleccionado(s)
          </span>
        )}

        {onMoveToLayer && moveTargets.length > 0 && (
          <select
            disabled={selectedCountInScope === 0}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onMoveToLayer!(e.target.value);
              e.target.value = '';
            }}
            className="cad-input cad-input-sm"
            style={{ marginTop: 0, width: 'auto', opacity: selectedCountInScope === 0 ? 0.45 : 1 }}
            title="Mover seleccionados a otra capa"
          >
            <option value="" disabled>
              Mover a…
            </option>
            {moveTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}

        {onDeleteSelected && (
          <button
            onClick={onDeleteSelected}
            disabled={selectedCountInScope === 0}
            className="cad-icon-btn"
            title="Eliminar seleccionados"
            aria-label="Eliminar seleccionados"
            style={{
              width: 28,
              height: 28,
              color: selectedCountInScope > 0 ? 'var(--cad-accent-red)' : undefined,
            }}
          >
            <Trash2 size={13} />
          </button>
        )}

        <button
          onClick={close}
          className="cad-icon-btn"
          title="Cerrar tabla de atributos"
          aria-label="Cerrar"
          style={{ width: 28, height: 28 }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>{gridEl}</div>
    </div>
  );
}
