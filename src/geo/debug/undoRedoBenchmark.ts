// src/geo/debug/undoRedoBenchmark.ts
//
// Fase 3.4 (auditoria-para-mejora.md) — confirma el criterio de éxito
// pendiente: trazar una calle en un proyecto grande retiene memoria de
// undo proporcional al CAMBIO (StructuralDiff real), no al tamaño total
// del proyecto. Reutiliza el generador sintético (Fase 0/6.1) y el
// pipeline real: AddStreetCommand → recomputeManzanos → StructuralDiff.
//
// Requiere runtime Tauri (invoca el motor nativo real vía recomputeManzanos).

import { useMapStore } from '../../store/map/mapStore';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import { useStreetStore } from '../../store/entities/streetStore';
import { useRoundaboutStore } from '../../store/entities/roundaboutStore';
import { useManzanoStore } from '../../store/entities/manzanoStore';
import { useCommandStack, runCommand } from '../../commands/core/CommandStack';
import { AddStreetCommand } from '../../commands/roads/AddStreetCommand';
import { resetIncrementalRoadTracking } from '../recomputeManzanos';
import { generateSyntheticManzanos, ensureSyntheticLotLayer } from './syntheticDataset';
import { readUndoCommandStats } from '../../store/debug/perfTelemetry';
import { requireLayerForKind } from '../../store/ui/layerPickerStore';

export interface StreetUndoBenchmarkResult {
  datasetSize: number;
  /** Bytes reales que retiene el undo del trazo (StructuralDiff). */
  undoDiffBytes: number;
  /** Estimación de lo que hubiera pesado el snapshot GeoJSON del proyecto ENTERO (baseline pre-Fase-3, mismo criterio que estimateGeoJsonBytes). */
  fullSnapshotBaselineBytes: number;
  /** undoDiffBytes / fullSnapshotBaselineBytes — cuanto más chico, mejor prueba el desacople. */
  ratio: number;
  executeMs: number;
}

const APPROX_BYTES_PER_FEATURE_GEOJSON = 220;

export async function runStreetUndoBenchmark(datasetSize: number): Promise<StreetUndoBenchmarkResult> {
  const drawSource = useMapStore.getState().drawSource;
  if (!drawSource) {
    throw new Error('drawSource no inicializado — asegurate de que <MapView/> esté montado.');
  }

  // Reset limpio para no arrastrar estado de una corrida anterior.
  useStreetStore.getState().clearStreets();
  useRoundaboutStore.getState().clearRoundabouts();
  resetIncrementalRoadTracking();
  useManzanoStore.getState().resetAll();
  useLayersStore.getState().resetToEmpty();
  useCommandStack.getState().clear();

  ensureSyntheticLotLayer();
  const { collection, extent, manzanoCount, lotCount } = generateSyntheticManzanos(datasetSize);
  useMapStore.getState().restoreDrawFeatures(collection);

  const [minX, minY, maxX, maxY] = extent;
  const midY = (minY + maxY) / 2;
  const start: [number, number] = [minX, midY];
  const end: [number, number] = [maxX, midY]; // cruza toda la grilla — toca muchos manzanos

  const layerId = await requireLayerForKind('calle');
  if (!layerId) throw new Error('No se pudo resolver capa para la calle del benchmark.');

  const t0 = performance.now();
  await runCommand(new AddStreetCommand(start, end, 8, undefined, 2, layerId));
  const executeMs = performance.now() - t0;

  const undoStats = readUndoCommandStats();
  const totalFeatures = manzanoCount + lotCount;
  const fullSnapshotBaselineBytes = totalFeatures * APPROX_BYTES_PER_FEATURE_GEOJSON;

  return {
    datasetSize,
    undoDiffBytes: undoStats.lastBytes,
    fullSnapshotBaselineBytes,
    ratio: fullSnapshotBaselineBytes > 0 ? undoStats.lastBytes / fullSnapshotBaselineBytes : 0,
    executeMs,
  };
}

export async function runStreetUndoBenchmarkSuite(
  sizes: number[] = [10_000, 100_000, 500_000],
): Promise<StreetUndoBenchmarkResult[]> {
  const results: StreetUndoBenchmarkResult[] = [];
  for (const size of sizes) results.push(await runStreetUndoBenchmark(size));
  return results;
}