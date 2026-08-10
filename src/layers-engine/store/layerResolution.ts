// src/store/entities/layerResolution.ts
import type { GeoUrbanFeatureKind } from '@kernel/domain-model/featureModel';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { autoCreateLayerForKind } from '@layers-engine/store/layerAutoCreate';

export interface ResolveLayerOpts {
  kind: GeoUrbanFeatureKind;
  override?: string;
  requireKindMatch?: boolean;
  autoCreate?: boolean;
}

export function pickLayerId(opts: ResolveLayerOpts): string | undefined {
  const reg = useLayersStore.getState();
  const requireKindMatch = opts.requireKindMatch ?? true;

  if (opts.override) {
    const preferred = reg.getById(opts.override);
    if (preferred && !preferred.locked) return preferred.id;
  }

  if (reg.activeLayerId) {
    const active = reg.getById(reg.activeLayerId);
    if (active && !active.locked && (!requireKindMatch || active.kind === opts.kind)) {
      return active.id;
    }
  }

  const match = reg.getLayerForKind(opts.kind);
  if (match && !match.locked) return match.id;

  if (opts.autoCreate) {
    return autoCreateLayerForKind(opts.kind);
  }

  return undefined;
}

export function resolveOrCreateLayerForKind(kind: GeoUrbanFeatureKind): string {
  return pickLayerId({ kind, requireKindMatch: true, autoCreate: true })!;
}
