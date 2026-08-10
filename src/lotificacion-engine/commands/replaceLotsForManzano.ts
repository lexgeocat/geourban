import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { CommandContext } from '@kernel/command/Command';
import { createLotFeature, type CreateLotFeatureOpts } from '../model/createLotFeature';
import type { LabelStyleConfig } from '@label-engine/model/labelModel';
import type { LotResult } from '@kernel/geometry/polygonEngine';

export interface RemovedLotSnapshot {
  id: string | number;
  geometry: Geometry;
  props: Record<string, unknown>;
}

export interface ReplaceLotsResult {
  newLotIds: Array<string | number>;
  removedLotSnapshots: RemovedLotSnapshot[];
}

/**
 * Quita los lotes viejos del `manzanoId` y agrega los `lots` nuevos al source.
 * Devuelve los IDs nuevos y los snapshots de los viejos (para soportar undo).
 *
 * Comportamiento:
 *  - Captura `labelConfig` del primer lote viejo y lo arrastra a los nuevos.
 *  - Setea `labelText = code` en cada lote nuevo (reflejando lo que ya hacía cada comando).
 *  - Deja `lotStatus` del manzano sin tocar: el caller decide (Generate siempre 'subdivided', Recompute condicional).
 */
export function replaceLotsForManzano(
  ctx: CommandContext,
  args: {
    manzanoId: string | number;
    manzanoFeature: Feature<Geometry>;
    lots: LotResult[];
    method: CreateLotFeatureOpts['method'];
    preferredLayerId?: string;
  }
): ReplaceLotsResult {
  const { manzanoId, manzanoFeature, lots, method, preferredLayerId } = args;
  const idStr = String(manzanoId);

  const oldLots: Feature<Geometry>[] = [];
  let carriedLabelConfig: LabelStyleConfig | undefined;
  ctx.drawSource.forEachFeature((f) => {
    if (f.get('lotGroupId') === idStr) oldLots.push(f as Feature<Geometry>);
  });

  const removedLotSnapshots: RemovedLotSnapshot[] = [];
  for (const f of oldLots) {
    const g = f.getGeometry();
    if (g) {
      const props = { ...f.getProperties() };
      delete props.geometry;
      removedLotSnapshots.push({
        id: f.getId() as string | number,
        geometry: g.clone(),
        props,
      });
    }
    if (!carriedLabelConfig) {
      carriedLabelConfig = f.get('labelConfig') as LabelStyleConfig | undefined;
    }
    ctx.drawSource.removeFeature(f);
  }

  const newLotIds: Array<string | number> = [];
  const manzanoCode = manzanoFeature.get('code') as string | undefined;
  lots.forEach((lot, i) => {
    if (lot.pts.length < 3) return;
    const { feature, id: lotId } = createLotFeature(lot, {
      manzanoId,
      manzanoCode,
      index: i + 1,
      method,
      preferredLayerId,
      autoCreateLayer: false,
    });
    if (carriedLabelConfig) {
      feature.set('labelConfig', carriedLabelConfig, true);
      feature.set('labelText', feature.get('code') as string, true);
    }
    ctx.drawSource.addFeature(feature);
    newLotIds.push(lotId);
  });

  return { newLotIds, removedLotSnapshots };
}
