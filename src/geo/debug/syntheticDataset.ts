import type { FeatureCollection, Feature as GeoJsonFeature, Polygon } from 'geojson';
import { useLayersStore } from '../../store/entities/layersRegistryStore';

export const SYNTHETIC_LAYER_ID = 'synthetic-benchmark-lote';

const LOT_SIDE_M = 15;
const LOT_GAP_M = 2;
const LOT_CELL_M = LOT_SIDE_M + LOT_GAP_M;

export interface SyntheticDatasetResult {
  collection: FeatureCollection;
  count: number;
  generateMs: number;
}

/** Grilla de lotes rectangulares en EPSG:3857 — sin dependencias pesadas, pensado para 10^6 features. */
export function generateSyntheticLots(count: number): SyntheticDatasetResult {
  const t0 = performance.now();
  const cols = Math.ceil(Math.sqrt(count));
  const features: GeoJsonFeature<Polygon>[] = new Array(count);
  const areaM2 = LOT_SIDE_M * LOT_SIDE_M;
  const perimeterM = LOT_SIDE_M * 4;

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x0 = col * LOT_CELL_M;
    const y0 = row * LOT_CELL_M;
    const x1 = x0 + LOT_SIDE_M;
    const y1 = y0 + LOT_SIDE_M;

    features[i] = {
      type: 'Feature',
      id: `synthetic-lot-${i}`,
      properties: {
        kind: 'lote',
        layerId: SYNTHETIC_LAYER_ID,
        label: `Lote ${i + 1}`,
        areaM2,
        perimeterM,
        isRemnant: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
      },
    };
  }

  return {
    collection: { type: 'FeatureCollection', features: features as never[] },
    count,
    generateMs: performance.now() - t0,
  };
}

/** Crea la capa de benchmark directo en el store (sin Command/undo — es tooling de debug). */
export function ensureSyntheticLotLayer(): string {
  const store = useLayersStore.getState();
  if (store.getById(SYNTHETIC_LAYER_ID)) return SYNTHETIC_LAYER_ID;
  store.add({
    id: SYNTHETIC_LAYER_ID,
    name: 'Benchmark sintético',
    kind: 'lote',
    color: '#58a6ff',
    fillColor: '#58a6ff',
    visible: true,
    locked: false,
    opacity: 1,
    showLabel: false,
    showCota: false,
    colorMode: 'solid',
  });
  return SYNTHETIC_LAYER_ID;
}