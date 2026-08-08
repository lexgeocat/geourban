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
  manzanoId: string | number;
  manzanoCode?: string;
  index: number;
  method: ManzanoLoteMethod;
  preferredLayerId?: string;
  autoCreateLayer: boolean;
}

export function createLotFeature(
  lot: LotResult,
  opts: CreateLotFeatureOpts
): { feature: Feature<Geometry>; id: string } {
  if (lot.pts.length < 3) {
    throw new Error('createLotFeature: LotResult necesita al menos 3 puntos.');
  }

  const ring = closeRing(lot.pts);
  const geom = new PolygonGeom([ring]);
  const feature = new Feature<Geometry>({ geometry: geom });
  const id = newId(`lot-${opts.manzanoId}`);
  feature.setId(id);

  const code = `${opts.manzanoCode ?? opts.manzanoId}-${opts.index}${lot.isRemnant ? 'R' : ''}`;
  feature.setProperties(
    ensureKind(
      {
        subdivision: opts.method,
        lotGroupId: String(opts.manzanoId),
        label: lot.isRemnant ? `Remanente ${code}` : `Lote ${code}`,
        code,
        areaM2: lot.areaM2,
        frontM: lot.frontM,
        depthM: lot.depthM,
        isRemnant: lot.isRemnant,
      },
      'lote'
    )
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
