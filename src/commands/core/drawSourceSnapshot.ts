/**
 * @deprecated Fase 3.3 (auditoria-para-mejora.md) — sin usos en el repo.
 * AddStreetCommand y AddRoundaboutCommand (los únicos call-sites
 * históricos) migraron a `commands/core/structuralDiff.ts`
 * (StructuralDiffRecorder + composeStructuralDiffs) en la Fase 3.2.
 * No agregar comandos nuevos que dependan de este snapshot: es
 * exactamente el patrón O(tamaño total del proyecto) que la Fase 3
 * vino a eliminar. Candidato a borrado en un próximo cleanup.
 */
import GeoJSON from 'ol/format/GeoJSON.js';
import type VectorSource from 'ol/source/Vector.js';
import { recordUndoSnapshot } from '../../store/debug/perfTelemetry';

const geoJsonFormat = new GeoJSON();

export type DrawSourceSnapshot = string;

export function snapshotDrawSource(source: VectorSource): DrawSourceSnapshot {
  const t0 = performance.now();
  const json = geoJsonFormat.writeFeatures(source.getFeatures(), {
    featureProjection: 'EPSG:3857',
  });
  recordUndoSnapshot(json.length * 2, performance.now() - t0);
  return json;
}

export function restoreDrawSourceSnapshot(source: VectorSource, snapshot: DrawSourceSnapshot): void {
  const features = geoJsonFormat.readFeatures(snapshot, {
    featureProjection: 'EPSG:3857',
  });
  source.clear();
  source.addFeatures(features);
  source.changed();
}