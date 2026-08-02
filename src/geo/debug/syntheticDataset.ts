import type { FeatureCollection, Feature as GeoJsonFeature, Polygon } from 'geojson';
import { useLayersStore } from '../../store/entities/layersRegistryStore';

export const SYNTHETIC_LAYER_ID = 'synthetic-benchmark-lote';

const LOT_SIDE_M = 15;
const LOT_GAP_M = 2;
const LOT_CELL_M = LOT_SIDE_M + LOT_GAP_M;

const MANZANO_W_M = 80;
const MANZANO_H_M = 60;
const STREET_GAP_M = 10;
const MANZANO_CELL_W_M = MANZANO_W_M + STREET_GAP_M;
const MANZANO_CELL_H_M = MANZANO_H_M + STREET_GAP_M;

export interface SyntheticDatasetResult {
  collection: FeatureCollection;
  count: number;
  manzanoCount: number;
  lotCount: number;
  generateMs: number;
  /** Bounding box [minX, minY, maxX, maxY] en EPSG:3857 de la grilla completa. */
  extent: [number, number, number, number];
}

function makeLote(id: string, lotGroupId: string, x0: number, y0: number): GeoJsonFeature<Polygon> {
  const x1 = x0 + LOT_SIDE_M;
  const y1 = y0 + LOT_SIDE_M;
  return {
    type: 'Feature',
    id,
    properties: {
      kind: 'lote',
      layerId: SYNTHETIC_LAYER_ID,
      lotGroupId,
      label: id,
      areaM2: LOT_SIDE_M * LOT_SIDE_M,
      perimeterM: LOT_SIDE_M * 4,
      isRemnant: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
    },
  };
}

/**
 * Grilla de manzanos (kind 'manzana') con sus lotes (kind 'lote', lotGroupId
 * apuntando al manzano padre), en EPSG:3857 — sin dependencias pesadas,
 * pensado para 10^6 features. La grilla se genera alrededor de `center`
 * (EPSG:3857) si se pasa; sin él, desde (0,0).
 *
 * Fase 3.4/6.1 (auditoria-para-mejora.md): el dataset anterior generaba solo
 * lotes sueltos sin manzanos, con lo que `recomputeManzanos()` no tenía nada
 * que recomputar al trazar una calle (diff de undo vacío). Con manzanos +
 * lotes reales, trazar una calle cruza N manzanos y el diff del undo queda
 * proporcional a ese cambio, medible a escala.
 */
export function generateSyntheticManzanos(totalFeatures: number, center?: [number, number]): SyntheticDatasetResult {
  const t0 = performance.now();

  const lotCols = Math.floor((MANZANO_W_M + LOT_GAP_M) / LOT_CELL_M);
  const lotRows = Math.floor((MANZANO_H_M + LOT_GAP_M) / LOT_CELL_M);
  const lotsPerManzano = lotCols * lotRows;
  const featuresPerManzano = 1 + lotsPerManzano;
  const manzanoCount = Math.max(1, Math.ceil(totalFeatures / featuresPerManzano));

  const cols = Math.ceil(Math.sqrt(manzanoCount));
  const gridWidthM = cols * MANZANO_CELL_W_M;
  const gridHeightM = cols * MANZANO_CELL_H_M;
  const origin: [number, number] = center
    ? [center[0] - gridWidthM / 2, center[1] - gridHeightM / 2]
    : [0, 0];

  const innerWidthM = lotCols * LOT_CELL_M;
  const innerHeightM = lotRows * LOT_CELL_M;
  const innerOriginX = (MANZANO_W_M - innerWidthM) / 2;
  const innerOriginY = (MANZANO_H_M - innerHeightM) / 2;

  const features: GeoJsonFeature<Polygon>[] = [];
  for (let i = 0; i < manzanoCount; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const mx0 = origin[0] + col * MANZANO_CELL_W_M;
    const my0 = origin[1] + row * MANZANO_CELL_H_M;
    const mx1 = mx0 + MANZANO_W_M;
    const my1 = my0 + MANZANO_H_M;
    const manzanoId = `synthetic-manzano-${i}`;

    features.push({
      type: 'Feature',
      id: manzanoId,
      properties: {
        kind: 'manzana',
        layerId: SYNTHETIC_LAYER_ID,
        label: manzanoId,
        areaM2: MANZANO_W_M * MANZANO_H_M,
        perimeterM: 2 * (MANZANO_W_M + MANZANO_H_M),
        isRemnant: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[mx0, my0], [mx1, my0], [mx1, my1], [mx0, my1], [mx0, my0]]],
      },
    });

    for (let r = 0; r < lotRows; r++) {
      for (let c = 0; c < lotCols; c++) {
        const lx0 = mx0 + innerOriginX + c * LOT_CELL_M;
        const ly0 = my0 + innerOriginY + r * LOT_CELL_M;
        features.push(makeLote(`synthetic-lot-${i}-${r}-${c}`, manzanoId, lx0, ly0));
      }
    }
  }

  return {
    collection: { type: 'FeatureCollection', features: features as never[] },
    count: features.length,
    manzanoCount,
    lotCount: features.length - manzanoCount,
    generateMs: performance.now() - t0,
    extent: [origin[0], origin[1], origin[0] + gridWidthM, origin[1] + gridHeightM],
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
