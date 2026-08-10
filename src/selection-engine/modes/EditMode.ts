import { Fill, Stroke, Style } from 'ol/style.js';
import Modify from 'ol/interaction/Modify.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import SafeTranslate, { type TranslateEvent } from '../interactions/safeTranslate';
import { useSelectionStore } from '../store/selectionStore';
import { ModifyGeometryCommand } from '@drawing-engine/commands/ModifyGeometryCommand';
import { runCommand } from '@kernel/command/CommandStack';
import { updateFeatureMetrics } from '@georef-engine/metrics';
import type { HitTestSelect } from '../interactions/HitTestSelect';
import type { ModeContext } from '@kernel/modes/ModeContext';

/**
 * Commit de un command de edición capturado por `*start`, o fallback
 * (recapturar antes de commitear) si no hubo `*start` previo. Usado por
 * los handlers `modifyend` y `translateend` de EditMode (Fase 3.9 del plan
 * de limpieza — antes cada uno tenía este mismo bloque copy-pasteado).
 */
function commitPendingOrFallback(
  pending: ModifyGeometryCommand | null,
  select: HitTestSelect,
  ctx: ModeContext,
  label: string,
  warnMessage: string,
): void {
  if (pending) {
    void runCommand(pending);
    return;
  }
  console.warn(warnMessage);
  const fallbackTargets = select.getFeatures().getArray().filter((f) => f.getId() != null) as Feature<Geometry>[];
  if (fallbackTargets.length > 0) {
    const fallbackCmd = new ModifyGeometryCommand(fallbackTargets, label);
    fallbackCmd.captureBefore();
    void runCommand(fallbackCmd);
  } else {
    select.getFeatures().forEach((f) => updateFeatureMetrics(f as Feature<Geometry>));
    ctx.refreshLayers();
  }
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

  const modify = new Modify({
    features: select.getFeatures(),
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
      'Modify: modifyend sin modifystart previo — undo no será exacto para este cambio.',
    );
    pendingModify = null;
  });
  map.addInteraction(modify);
  ctx.addCleanup(() => map.removeInteraction(modify));

  const translate = new SafeTranslate({ features: select.getFeatures(), hitTolerance: 6 });
  let pendingTranslate: ModifyGeometryCommand | null = null;

  translate.on('translatestart', (event) => {
    const feats = ((event as unknown as TranslateEvent).features.getArray() as Array<Feature<Geometry>>) ?? select.getFeatures().getArray();
    pendingTranslate = new ModifyGeometryCommand(feats, 'Mover');
    pendingTranslate.captureBefore();
  });
  translate.on('translateend', () => {
    commitPendingOrFallback(
      pendingTranslate,
      select,
      ctx,
      'Mover',
      'Translate: translateend sin translatestart previo — undo no será exacto para este cambio.',
    );
    pendingTranslate = null;
  });
  map.addInteraction(translate);
  ctx.addCleanup(() => map.removeInteraction(translate));
}