import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { extend as extendExtent, type Extent } from 'ol/extent.js';

/** Cantidad de features por layerId — badge de conteo del panel (Fase 7). */
export function computeLayerFeatureCounts(drawSource: VectorSource | null): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!drawSource) return counts;
  drawSource.forEachFeature((f) => {
    const layerId = (f as Feature<Geometry>).get('layerId') as string | undefined;
    if (!layerId) return;
    counts[layerId] = (counts[layerId] ?? 0) + 1;
  });
  return counts;
}

/** Extent (EPSG:3857) de todas las features de una capa — null si no hay ninguna.
 *  Usado por "Zoom a extensión de la capa" (Fase 7). */
export function computeLayerExtent(drawSource: VectorSource | null, layerId: string): Extent | null {
  if (!drawSource) return null;
  let ext: Extent | null = null;
  drawSource.forEachFeature((f) => {
    if ((f as Feature<Geometry>).get('layerId') !== layerId) return;
    const geom = (f as Feature<Geometry>).getGeometry();
    if (!geom) return;
    const e = geom.getExtent();
    if (!ext) ext = [...e] as Extent;
    else extendExtent(ext, e);
  });
  return ext;
}