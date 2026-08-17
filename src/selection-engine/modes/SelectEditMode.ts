import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import type { Coordinate } from 'ol/coordinate.js';
import { intersects as extentIntersects } from 'ol/extent.js';
import { HitTestSelect, type HitTestSelectEvent } from '../interactions/HitTestSelect';
import { LassoSelection, type LassoMode } from '../interactions/LassoSelection';
import { useSelectionStore } from '../store/selectionStore';
import { useDrawStore } from '@map-core/store/drawStore';
import { hitTestCandidatesInExtentAsync } from '../geometry/hitTest';
import { pointInPoly, segmentIntersectsPoly, type Pt } from '@kernel/geometry/polygonEngine';
import { extraSnapSources } from '@snap-engine/extension-points';
import type { ModeContext } from '@kernel/modes/ModeContext';

function seedFromStore(ctx: ModeContext, select: HitTestSelect) {
  useSelectionStore.getState().selectedIds.forEach((id) => {
    const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
    if (f) select.getFeatures().push(f);
  });
}

/**
 * Limpia por completo la selección actual, sincronizando tanto la Collection
 * interna de OpenLayers (source de verdad para los painters de highlight)
 * como el store de Zustand (source de verdad para los modos de edición y la UI).
 * Idempotente y barato si ya está vacío.
 */
export function clearSelection(ctx: ModeContext, select: HitTestSelect): boolean {
  const selected = select.getFeatures();
  const store = useSelectionStore.getState();
  const hadOl = selected.getLength() > 0;
  const hadStore = store.selectedIds.size > 0 || store.primaryId !== null;
  if (!hadOl && !hadStore) return false;

  selected.clear();
  store.clear();
  ctx.refreshLayers();
  return true;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function activateSelect(ctx: ModeContext): HitTestSelect {
  const select = new HitTestSelect({
    map: ctx.map,
    source: ctx.drawSource,
    pixelTolerance: 6,
    multi: true,
    filter: (feature) => !ctx.isLayerLocked(feature) && ctx.isLayerVisible(feature),
    getExtraFeatures: () => {
      if (useDrawStore.getState().mode === 'edit') return [];
      return extraSnapSources.collect().flat() as Feature<Geometry>[];
    },
  });

  seedFromStore(ctx, select);

  select.addEventListener('select', (evt) => {
    const e = evt as unknown as HitTestSelectEvent;
    const allSelected = select.getFeatures().getArray();
    const ids = allSelected.map((f) => f.getId()).filter((id): id is string | number => id != null);

    if (ids.length === 0) {
      useSelectionStore.getState().clear();
    } else {
      const justClickedId = e.selected[0]?.getId();
      const primary = (justClickedId != null ? justClickedId : ids[ids.length - 1]) as
        string | number;
      useSelectionStore.getState().setSelection(ids, primary);
    }
    ctx.refreshLayers();
  });

  ctx.map.addInteraction(select);
  ctx.selectInteractionRef.current = select;
  ctx.addCleanup(() => {
    ctx.map.removeInteraction(select);
    ctx.selectInteractionRef.current = null;
  });

  // ── Tecla Escape: limpia toda la selección ──
  const viewport = ctx.map.getViewport();
  if (!viewport.hasAttribute('tabindex')) viewport.setAttribute('tabindex', '0');
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (isEditableTarget(e.target)) return;
    if (useDrawStore.getState().mode !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
    if (clearSelection(ctx, select)) {
      ctx.postrenderPainter?.setLassoPreview(null);
      ctx.map.render();
    }
  };
  viewport.addEventListener('keydown', onKeyDown);
  ctx.addCleanup(() => viewport.removeEventListener('keydown', onKeyDown));

  const subMode = useSelectionStore.getState().selectMode;
  if (subMode === 'rect' || subMode === 'lasso') {
    activateLasso(ctx, select, subMode);
  }

  return select;
}

function activateLasso(ctx: ModeContext, select: HitTestSelect, lassoMode: LassoMode): void {
  const { map, drawSource: src } = ctx;
  const lasso = new LassoSelection({
    map,
    mode: lassoMode,
    onComplete: (result) => {
      ctx.postrenderPainter?.setLassoPreview(null);

      const extent: [number, number, number, number] =
        result.kind === 'rect'
          ? result.extent
          : (() => {
              let minX = Infinity,
                minY = Infinity,
                maxX = -Infinity,
                maxY = -Infinity;
              for (const p of result.polygon) {
                if (p[0] < minX) minX = p[0];
                if (p[1] < minY) minY = p[1];
                if (p[0] > maxX) maxX = p[0];
                if (p[1] > maxY) maxY = p[1];
              }
              return [minX, minY, maxX, maxY];
            })();

      void (async () => {
        const nearby = await hitTestCandidatesInExtentAsync(extent, src);
        const pool = nearby.length > 0 ? nearby : (src.getFeatures() as Feature<Geometry>[]);

        const candidates: Array<Feature<Geometry>> = [];
        for (const f of pool) {
          const id = f.getId();
          if (id == null) continue;
          if (ctx.isLayerLocked(f) || !ctx.isLayerVisible(f)) continue;
          const g = f.getGeometry();
          if (!g) continue;
          if (result.kind === 'rect') {
            const ext = g.getExtent();
            if (extentIntersects(ext, result.extent)) candidates.push(f as Feature<Geometry>);
          } else {
            const poly = result.polygon as [number, number][];
            const ext = g.getExtent();
            if (!extentIntersects(ext, extent)) continue;
            let inside = false;
            let coords: Coordinate[] | Coordinate[][] | Coordinate[][][];
            if (g instanceof Polygon) {
              coords = g.getCoordinates();
            } else if (g instanceof MultiPolygon) {
              coords = g.getCoordinates();
            } else {
              continue;
            }
            const walk = (arr: unknown) => {
              if (inside) return;
              if (Array.isArray(arr) && typeof arr[0] === 'number') {
                const x = arr[0] as number;
                const y = arr[1] as number;
                if (pointInPoly(x, y, poly)) inside = true;
                return;
              }
              if (Array.isArray(arr)) {
                if (
                  arr.length >= 2 &&
                  typeof arr[0] === 'object' &&
                  arr[0] !== null &&
                  typeof (arr[0] as number[])[0] === 'number'
                ) {
                  for (let k = 0; k < (arr as unknown[]).length - 1 && !inside; k++) {
                    const a = (arr as Pt[])[k];
                    const b = (arr as Pt[])[k + 1];
                    if (a && b && segmentIntersectsPoly([a[0], a[1]], [b[0], b[1]], poly))
                      inside = true;
                  }
                  return;
                }
                for (const c of arr) walk(c);
              }
            };
            walk(coords);
            if (inside) candidates.push(f as Feature<Geometry>);
          }
        }

        const ids = candidates
          .map((f) => f.getId())
          .filter((id): id is string | number => id != null);
        useSelectionStore.getState().setSelection(ids, ids[0] ?? null);

        select.getFeatures().clear();
        select.getFeatures().extend(candidates);
        ctx.refreshLayers();
      })();
    },
    onCancel: () => {
      ctx.postrenderPainter?.setLassoPreview(null);
      map.render();
    },
  });
  map.addInteraction(lasso);
  ctx.addCleanup(() => {
    map.removeInteraction(lasso);
    ctx.postrenderPainter?.setLassoPreview(null);
  });
  const onRender = () => {
    ctx.postrenderPainter?.setLassoPreview(lasso.getPreview());
  };
  map.on('postrender', onRender);
  ctx.addCleanup(() => map.un('postrender', onRender));
}
