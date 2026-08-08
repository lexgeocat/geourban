// Helper compartido por GenerateLotsCommand, RecomputeManzanoLotsCommand
// y recomputeManzanos.ts para construir un Feature<Polygon> "lote" a
// partir de un LotResult, manteniendo ids / props / métricas consistentes.
import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import PolygonGeom from 'ol/geom/Polygon.js';
import { closeRing, type LotResult } from '../../geo/math/polygonEngine';
import { ensureKind } from '../../core/objectModel';
import { updateFeatureMetrics } from '../../geo/metrics';
import { newId } from '../../lib/id';
import { pickLayerId } from '../../store/entities/layerResolution';
import type { ManzanoLoteMethod } from '../../geo/subdivision/types';

export interface CreateLotFeatureOpts {
  /** id del manzano al que pertenece el lote (sufijo del id del feature). */
  manzanoId: string | number;
  /** Índice del lote dentro del manzano (1-based, usado para el label). */
  index: number;
  /** Método de subdivisión que produjo el lote. */
  method: ManzanoLoteMethod;
  /** Layer preferida; si no existe se usa la default del kind 'lote'. */
  preferredLayerId?: string;
  /** Si true, crea la capa automáticamente cuando no se encuentra `preferredLayerId`. */
  autoCreateLayer: boolean;
}

/**
 * Construye un OL Feature "lote" listo para agregar al `drawSource`.
 * - Cierra el ring si hace falta
 * - Asigna id (`lot-${manzanoId}-${suffix}`)
 * - Setea props con `ensureKind(..., 'lote')` (incluye `lotGroupId`, label,
 *   área/frente/profundidad y `subdivision: method`)
 * - Resuelve y asigna `layerId`
 * - Recalcula métricas (área/perímetro/cota) vía `updateFeatureMetrics`
 *
 * Devuelve `{ feature, id }` para que el caller pueda enganchar la feature
 * a su `Command` (track de undo/redo) o a su `StructuralDiffRecorder`.
 */
export function createLotFeature(
  lot: LotResult,
  opts: CreateLotFeatureOpts,
): { feature: Feature<Geometry>; id: string } {
  if (lot.pts.length < 3) {
    throw new Error('createLotFeature: LotResult necesita al menos 3 puntos.');
  }

  const ring = closeRing(lot.pts);
  const geom = new PolygonGeom([ring]);
  const feature = new Feature<Geometry>({ geometry: geom });
  const id = newId(`lot-${opts.manzanoId}`);
  feature.setId(id);

  feature.setProperties(
    ensureKind(
      {
        subdivision: opts.method,
        lotGroupId: String(opts.manzanoId),
        label: lot.isRemnant ? `Remanente ${opts.index}` : `Lote ${opts.index}`,
        areaM2: lot.areaM2,
        frontM: lot.frontM,
        depthM: lot.depthM,
        isRemnant: lot.isRemnant,
      },
      'lote',
    ),
  );

  const layerId = pickLayerId({
    kind: 'lote',
    override: opts.preferredLayerId,
    requireKindMatch: true,
    autoCreate: opts.autoCreateLayer,
  });
  if (layerId) feature.set('layerId', layerId);

  updateFeatureMetrics(feature);

  return { feature, id };
}
