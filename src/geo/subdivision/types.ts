// src/geo/subdivision/types.ts
//
// Tipos públicos del motor de subdivisión. Desde la Fase 2.7 el motor es
// exclusivamente nativo (Rust/GEOS vía Tauri); este módulo preserva las
// formas de datos compartidas entre el frontend y la crate `geourban-geo`
// (que ahora es la única implementación del motor).
//
// Antes vivían en subdivisionAlgorithms.ts (motor JS, retirado en 2.7).

import type { Feature as GeoJsonFeature, Polygon as GeoJsonPolygon, MultiPolygon } from 'geojson';
import type { Pt } from '../math/polygonEngine';

export type SubdivisionMethod = 'auto' | 'modo2' | 'exact' | 'manual-slice';

export interface SubdivisionOptions {
  method: SubdivisionMethod;
  /** Área objetivo por lote en m² (auto / exact / manual-slice) */
  targetAreaM2?: number;
  /** Frente mínimo en metros (auto / exact / manual-slice) */
  frontMinM?: number;
  /** Dirección preferida del eje de corte (auto / exact). Si no se provee, se calcula con PCA. */
  dirAx?: number;
  dirAy?: number;
  /** Para manual-slice: segmento de frente seleccionado */
  frenteSeg?: { a: Pt; b: Pt };
  /** Para manual-slice: segmento auxiliar (dirección perpendicular al corte) */
  auxSeg?: { a: Pt; b: Pt };
  /** Para manual-slice: línea de corte directa (alternativa a auxSeg) */
  cutLine?: { p1: Pt; p2: Pt };
}

export interface SubdivisionResult {
  ok: boolean;
  features: GeoJsonFeature<GeoJsonPolygon | MultiPolygon>[];
  warnings: string[];
  error?: string;
}

export type ManzanoLoteMethod = 'auto' | 'exact' | 'modo2';
