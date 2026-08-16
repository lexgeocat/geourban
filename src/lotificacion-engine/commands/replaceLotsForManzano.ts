import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { CommandContext } from '@kernel/command/Command';
import { createLotFeature, type CreateLotFeatureOpts } from '../model/createLotFeature';
import type { LabelStyleConfig } from '@label-engine/model/labelModel';
import type { LotResult } from '@kernel/geometry/polygonEngine';
import { formatOrderLabel, type LabelNumberingMode } from '@label-engine/model/labelNumbering';
import { useLabelClassStore } from '@label-engine/store/labelClassStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';

export interface RemovedLotSnapshot {
  id: string | number;
  geometry: Geometry;
  props: Record<string, unknown>;
}

export interface ReplaceLotsResult {
  newLotIds: Array<string | number>;
  removedLotSnapshots: RemovedLotSnapshot[];
}

function detectNumberingModeFromCode(code: string | undefined): LabelNumberingMode | undefined {
  if (!code) return undefined;
  const m = /-(\d+)R?$/.exec(code);
  if (!m) return undefined;
  if (code.endsWith(`${m[1]}R`)) return 'roman-lower';
  return 'numeric';
}

function resolveNumberingMode(
  carriedMode: LabelNumberingMode | undefined,
  carriedConfig: LabelStyleConfig | undefined,
  layerId: string | undefined,
  firstOldCode: string | undefined
): LabelNumberingMode {
  if (carriedMode) return carriedMode;
  if (layerId) {
    const classObj = useLabelClassStore.getState().getForLayer(layerId);
    if (classObj?.numbering?.mode) return classObj.numbering.mode;
  }
  if (
    carriedConfig &&
    (carriedConfig as unknown as { labelNumberingMode?: LabelNumberingMode }).labelNumberingMode
  ) {
    return (carriedConfig as unknown as { labelNumberingMode: LabelNumberingMode })
      .labelNumberingMode;
  }
  const detected = detectNumberingModeFromCode(firstOldCode);
  return detected ?? 'numeric';
}

function resolveLotLayerId(
  firstOldLayerId: string | undefined,
  preferredLayerId?: string
): string | undefined {
  if (firstOldLayerId) return firstOldLayerId;
  if (preferredLayerId) return preferredLayerId;
  const registry = useLayersStore.getState();
  return registry.getLayerForKind('lote')?.id;
}
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
  let carriedMode: LabelNumberingMode | undefined;
  let firstOldLayerId: string | undefined;
  let firstOldCode: string | undefined;
  ctx.drawSource.forEachFeature((f) => {
    if (f.get('lotGroupId') !== idStr) return;
    const feat = f as Feature<Geometry>;
    oldLots.push(feat);
    if (!carriedLabelConfig) {
      carriedLabelConfig = f.get('labelConfig') as LabelStyleConfig | undefined;
    }
    if (!carriedMode) {
      carriedMode = f.get('labelNumberingMode') as LabelNumberingMode | undefined;
    }
    if (!firstOldLayerId) {
      firstOldLayerId = f.get('layerId') as string | undefined;
    }
    if (!firstOldCode) {
      firstOldCode = f.get('code') as string | undefined;
    }
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
    ctx.drawSource.removeFeature(f);
  }

  const targetLayerId = resolveLotLayerId(firstOldLayerId, preferredLayerId);
  const numberingMode = resolveNumberingMode(
    carriedMode,
    carriedLabelConfig,
    targetLayerId,
    firstOldCode
  );

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
      const text = formatOrderLabel(numberingMode, i, lots.length, manzanoCode);
      feature.set('labelText', text, true);
      feature.set('labelNumberingMode', numberingMode, true);
    }
    ctx.drawSource.addFeature(feature);
    newLotIds.push(lotId);
  });

  return { newLotIds, removedLotSnapshots };
}
