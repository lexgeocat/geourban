import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { extend as extendExtent, type Extent } from 'ol/extent.js';
import { useStreetStore } from '../../store/entities/streetStore';
import { useRoundaboutStore } from '../../store/entities/roundaboutStore';
import { useLayersStore } from '../../store/entities/layersRegistryStore';

function resolveEntityLayerId(
  entityLayerId: string | undefined,
  registry: ReturnType<typeof useLayersStore.getState>,
): string | undefined {
  if (entityLayerId && registry.getById(entityLayerId)) return entityLayerId;
  return registry.getLayerForKind('calle')?.id;
}

export function computeLayerFeatureCounts(drawSource: VectorSource | null): Record<string, number> {
  const counts: Record<string, number> = {};
  if (drawSource) {
    drawSource.forEachFeature((f) => {
      const layerId = (f as Feature<Geometry>).get('layerId') as string | undefined;
      if (!layerId) return;
      counts[layerId] = (counts[layerId] ?? 0) + 1;
    });
  }

  const registry = useLayersStore.getState();

  for (const street of useStreetStore.getState().streets) {
    const id = resolveEntityLayerId(street.layerId, registry);
    if (!id) continue;
    counts[id] = (counts[id] ?? 0) + 1;
  }

  for (const rb of useRoundaboutStore.getState().roundabouts) {
    const id = resolveEntityLayerId(rb.layerId, registry);
    if (!id) continue;
    counts[id] = (counts[id] ?? 0) + 1;
  }

  return counts;
}

export function computeLayerExtent(drawSource: VectorSource | null, layerId: string): Extent | null {
  let ext: Extent | null = null;
  const extend = (e: Extent) => {
    if (!ext) ext = [...e] as Extent;
    else extendExtent(ext, e);
  };

  if (drawSource) {
    drawSource.forEachFeature((f) => {
      if ((f as Feature<Geometry>).get('layerId') !== layerId) return;
      const geom = (f as Feature<Geometry>).getGeometry();
      if (!geom) return;
      extend(geom.getExtent());
    });
  }

  const registry = useLayersStore.getState();

  for (const s of useStreetStore.getState().streets) {
    if (resolveEntityLayerId(s.layerId, registry) !== layerId) continue;
    const pts: Array<[number, number]> = [s.start, ...(s.waypoints ?? []), s.end];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (isFinite(minX)) extend([minX, minY, maxX, maxY]);
  }

  for (const rb of useRoundaboutStore.getState().roundabouts) {
    if (resolveEntityLayerId(rb.layerId, registry) !== layerId) continue;
    const half = rb.radiusM + rb.roadWidthM + Math.max(0, rb.sidewalkWidthM) + 2;
    extend([rb.center[0] - half, rb.center[1] - half, rb.center[0] + half, rb.center[1] + half]);
  }

  return ext;
}