import type { Feature as GeoJsonFeature, Polygon as GeoJsonPolygon, MultiPolygon } from 'geojson';
import type { Pt } from '../math/polygonEngine';

export type SubdivisionMethod = 'auto' | 'modo2' | 'exact' | 'manual-slice';

export interface SubdivisionOptions {
  method: SubdivisionMethod;
  targetAreaM2?: number;
  frontMinM?: number;
  dirAx?: number;
  dirAy?: number;
  frenteSeg?: { a: Pt; b: Pt };
  auxSeg?: { a: Pt; b: Pt };
  cutLine?: { p1: Pt; p2: Pt };
}

export interface SubdivisionResult {
  ok: boolean;
  features: GeoJsonFeature<GeoJsonPolygon | MultiPolygon>[];
  warnings: string[];
  error?: string;
}

export type ManzanoLoteMethod = 'auto' | 'exact' | 'modo2';
