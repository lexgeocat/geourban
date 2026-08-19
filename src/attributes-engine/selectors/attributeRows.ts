import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';

export interface AttributeFeatureRow {
  id: string | number;
  feature: Feature<Geometry>;
}

export function readAttributeRows(
  drawSource: VectorSource | null,
  layerId: string
): AttributeFeatureRow[] {
  if (!drawSource) return [];
  const rows: AttributeFeatureRow[] = [];
  drawSource.forEachFeature((f) => {
    const feature = f as Feature<Geometry>;
    if (feature.get('layerId') !== layerId) return;
    const id = feature.getId();
    if (id == null) return;
    rows.push({ id, feature });
  });
  return rows;
}
