import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { LabelStyleConfig } from '../model/labelModel';

/**
 * Snapshot del estado de etiquetas de una feature antes de una mutación
 * batch (típicamente capturado en `execute()` y restaurado en `undo()`).
 */
export interface LabelFieldsSnapshot {
  config?: LabelStyleConfig;
  text?: string;
}

/**
 * Restaura los campos `labelConfig` y `labelText` de una feature a partir
 * de un snapshot. Si el snapshot tenía la propiedad, la restaura con `set`;
 * si no, la elimina con `unset` (para no dejar valores fantasma cuando la
 * feature originalmente no tenía etiquetas).
 *
 * Usado por `AssignLabelOrderCommand.undo` y `AssignLotsLabelConfigCommand.undo`
 * (Fase 3.8 del plan de limpieza).
 */
export function restoreLabelFields(
  feature: Feature<Geometry>,
  prev: LabelFieldsSnapshot
): void {
  if (prev.config) feature.set('labelConfig', prev.config, true);
  else feature.unset('labelConfig', true);
  if (prev.text !== undefined) feature.set('labelText', prev.text, true);
  else feature.unset('labelText', true);
}
