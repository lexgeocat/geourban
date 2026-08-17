import { Fill, Stroke, Style } from 'ol/style.js';
import Modify from 'ol/interaction/Modify.js';
import Collection from 'ol/Collection.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import SafeTranslate, { type TranslateEvent } from '../interactions/safeTranslate';
import { useSelectionStore } from '../store/selectionStore';
import { ModifyGeometryCommand } from '@drawing-engine/commands/ModifyGeometryCommand';
import { RectangleResizeInteraction } from '@drawing-engine/interactions/RectangleResizeInteraction';
import { runCommand } from '@kernel/command/CommandStack';
import { updateFeatureMetrics } from '@georef-engine/metrics';
import { findNearestVertex, removeVertexFromFeature } from '@kernel/geometry/vertexEditing';
import { isVertexEditableKind, isRectangleFeature } from '@kernel/domain-model/featureModel';
import type { HitTestSelect } from '../interactions/HitTestSelect';
import type { ModeContext } from '@kernel/modes/ModeContext';
import { toast } from '@shared-ui/store/toastStore';

function commitPendingOrFallback(
  pending: ModifyGeometryCommand | null,
  select: HitTestSelect,
  ctx: ModeContext,
  label: string,
  warnMessage: string
): void {
  if (pending) {
    void runCommand(pending);
    return;
  }
  console.warn(warnMessage);
  const fallbackTargets = select
    .getFeatures()
    .getArray()
    .filter((f) => f.getId() != null) as Feature<Geometry>[];
  if (fallbackTargets.length > 0) {
    const fallbackCmd = new ModifyGeometryCommand(fallbackTargets, label);
    fallbackCmd.captureBefore();
    void runCommand(fallbackCmd);
  } else {
    select.getFeatures().forEach((f) => updateFeatureMetrics(f as Feature<Geometry>));
    ctx.refreshLayers();
  }
}

function createEditableMirror(
  source: Collection<Feature<Geometry>>,
  isEditable: (f: Feature<Geometry>) => boolean
): { collection: Collection<Feature<Geometry>>; dispose: () => void } {
  const mirror = new Collection<Feature<Geometry>>(source.getArray().filter(isEditable));

  const onAdd = (evt: { element: Feature<Geometry> }) => {
    const f = evt.element;
    if (isEditable(f) && mirror.getArray().indexOf(f) === -1) mirror.push(f);
  };
  const onRemove = (evt: { element: Feature<Geometry> }) => {
    const idx = mirror.getArray().indexOf(evt.element);
    if (idx !== -1) mirror.removeAt(idx);
  };

  source.on('add', onAdd as never);
  source.on('remove', onRemove as never);

  return {
    collection: mirror,
    dispose: () => {
      source.un('add', onAdd as never);
      source.un('remove', onRemove as never);
    },
  };
}

export function activateEdit(ctx: ModeContext, select: HitTestSelect): void {
  const { map, drawSource: src } = ctx;
  const primaryId = useSelectionStore.getState().primaryId;
  const selectedFeatures: Feature<Geometry>[] = [];
  useSelectionStore.getState().selectedIds.forEach((id) => {
    const f = src.getFeatureById(id) as Feature<Geometry> | null;
    if (f) selectedFeatures.push(f);
  });
  if (!primaryId || selectedFeatures.length === 0) return;

  const editableCount = selectedFeatures.filter((f) => ctx.isLayerEditable(f)).length;
  if (editableCount === 0) {
    toast(
      'Ningún elemento seleccionado se puede editar: activá "Iniciar edición" en su capa desde el panel de Capas.',
      { variant: 'warning', durationMs: 6000 }
    );
  } else if (editableCount < selectedFeatures.length) {
    toast(
      `${selectedFeatures.length - editableCount} de ${selectedFeatures.length} elemento(s) no se pueden editar (activá edición en su capa).`,
      { variant: 'info', durationMs: 5000 }
    );
  }

  const vertexUnsupportedCount = selectedFeatures.filter(
    (f) => ctx.isLayerEditable(f) && !isVertexEditableKind(f)
  ).length;
  if (vertexUnsupportedCount > 0) {
    toast(
      `${vertexUnsupportedCount} elemento(s) no muestran vértices editables (rotondas, círculos y puntos se ajustan por sus propios parámetros).`,
      { variant: 'info', durationMs: 5000 }
    );
  }

  const isVertexEditable = (f: Feature<Geometry>) =>
    ctx.isLayerEditable(f) && isVertexEditableKind(f) && !isRectangleFeature(f);

  const { collection: vertexEditableFeatures, dispose: disposeVertexMirror } = createEditableMirror(
    select.getFeatures(),
    isVertexEditable
  );
  ctx.addCleanup(disposeVertexMirror);

  const { collection: translatableFeatures, dispose: disposeTranslateMirror } =
    createEditableMirror(select.getFeatures(), ctx.isLayerEditable);
  ctx.addCleanup(disposeTranslateMirror);

  const isRectEligible = (f: Feature<Geometry>) => ctx.isLayerEditable(f) && isRectangleFeature(f);
  const rectInteraction = new RectangleResizeInteraction(
    map,
    select.getFeatures(),
    isRectEligible,
    src
  );
  const disposeRect = rectInteraction.install();
  map.addInteraction(rectInteraction);
  ctx.addCleanup(() => {
    map.removeInteraction(rectInteraction);
    disposeRect();
  });

  const modify = new Modify({
    features: vertexEditableFeatures,
    style: new Style({
      fill: new Fill({ color: 'rgba(245, 158, 11, 0.2)' }),
      stroke: new Stroke({ color: '#f59e0b', width: 2 }),
    }),
  });
  let pendingModify: ModifyGeometryCommand | null = null;
  modify.on('modifystart', (event) => {
    const targets = event.features.getArray().filter((f) => f.getId() != null);
    pendingModify = new ModifyGeometryCommand(targets, 'Editar vértices');
    pendingModify.captureBefore();
  });
  modify.on('modifyend', () => {
    commitPendingOrFallback(
      pendingModify,
      select,
      ctx,
      'Editar vértices',
      'Modify: modifyend sin modifystart previo — undo no será exacto para este cambio.'
    );
    pendingModify = null;
  });
  map.addInteraction(modify);
  ctx.addCleanup(() => map.removeInteraction(modify));

  const translate = new SafeTranslate({ features: translatableFeatures, hitTolerance: 6 });
  let pendingTranslate: ModifyGeometryCommand | null = null;

  translate.on('translatestart', (event) => {
    const feats =
      ((event as unknown as TranslateEvent).features.getArray() as Array<Feature<Geometry>>) ??
      translatableFeatures.getArray();
    pendingTranslate = new ModifyGeometryCommand(feats, 'Mover');
    pendingTranslate.captureBefore();
  });
  translate.on('translateend', () => {
    commitPendingOrFallback(
      pendingTranslate,
      select,
      ctx,
      'Mover',
      'Translate: translateend sin translatestart previo — undo no será exacto para este cambio.'
    );
    pendingTranslate = null;
  });
  map.addInteraction(translate);
  ctx.addCleanup(() => map.removeInteraction(translate));

  // ── Eliminar vértice con clic derecho (solo elementos con vértices libres) ──
  const onContextMenu = (e: MouseEvent) => {
    const candidates = vertexEditableFeatures.getArray();
    if (candidates.length === 0) return;
    const pixel = map.getEventPixel(e);
    const coord = map.getCoordinateFromPixel(pixel);
    if (!coord) return;
    const resolution = map.getView().getResolution() ?? 1;
    const hit = findNearestVertex(candidates, coord, 10 * resolution);
    if (!hit) return;
    e.preventDefault();

    const cmd = new ModifyGeometryCommand([hit.feature], 'Eliminar vértice');
    cmd.captureBefore();
    const removed = removeVertexFromFeature(hit.feature, hit.ringIndex, hit.vertexIndex);
    if (!removed) {
      toast('No se puede eliminar: la geometría necesita un mínimo de vértices.', {
        variant: 'warning',
      });
      return;
    }
    void runCommand(cmd);
  };
  const viewport = map.getViewport();
  viewport.addEventListener('contextmenu', onContextMenu);
  ctx.addCleanup(() => viewport.removeEventListener('contextmenu', onContextMenu));
}
