import GeoJSON from 'ol/format/GeoJSON.js';
import type VectorSource from 'ol/source/Vector.js';

const geoJsonFormat = new GeoJSON();

/** Snapshot serializado (GeoJSON) del contenido completo de un
 *  VectorSource. Usado por comandos cuyo efecto no está acotado a un
 *  conjunto de features conocido de antemano — p.ej. AddStreetCommand,
 *  cuyo recomputeManzanos() puede reparticionar cualquier manzano/lote
 *  del proyecto, no solo los que tocan la calle nueva. */
export type DrawSourceSnapshot = string;

export function snapshotDrawSource(source: VectorSource): DrawSourceSnapshot {
  return geoJsonFormat.writeFeatures(source.getFeatures(), {
    featureProjection: 'EPSG:3857',
  });
}

export function restoreDrawSourceSnapshot(source: VectorSource, snapshot: DrawSourceSnapshot): void {
  const features = geoJsonFormat.readFeatures(snapshot, {
    featureProjection: 'EPSG:3857',
  });
  source.clear();
  source.addFeatures(features);
  source.changed();
}