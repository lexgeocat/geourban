import { createDirectExtensionPoint } from '@kernel/registry/ExtensionPointRegistry';

export interface LayerEntitySnapshot {
  id: string;
  data: unknown;
  layerId?: string;
  label?: unknown;
}

export type LayerEntityAdapter = {
  kind: 'street' | 'roundabout';
  list: (layerId: string) => LayerEntitySnapshot[];
  count: (layerId: string) => number;
  reassign: (fromLayerId: string, toLayerId: string) => number;
  remove: (layerId: string) => LayerEntitySnapshot[];
  removeById: (entityId: string) => void;
  restore: (snapshots: LayerEntitySnapshot[]) => void;
};

export const layerEntityAdapters = createDirectExtensionPoint<LayerEntityAdapter>();

export function sumAdapterCounts(layerId: string): number {
  let total = 0;
  for (const adapter of layerEntityAdapters.collect()) {
    total += adapter.count(layerId);
  }
  return total;
}
