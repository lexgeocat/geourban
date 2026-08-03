// src/geo/debug/syntheticUrbanBenchmark.ts
//
// Fase 6.1 — loader + harness de benchmark que alimenta
// `generateSyntheticUrbanLayout()` al pipeline REAL de producción:
//
//   1. Reset limpio de stores (mismo criterio que undoRedoBenchmark.ts).
//   2. Perímetro sintético → restoreDrawFeatures() (kind 'perimetro').
//   3. Calles/rotondas → streetStore/roundaboutStore vía addXWithId().
//   4. recomputeManzanos() real: GEOS union de la red vial + difference
//      contra el perímetro (Fase 2.3) → manzanos de geometría irregular.
//   5. Pasada INCREMENTAL (agrega una avenida más) para estresar la
//      reconciliación de fragmentos contra los manzanos ya existentes
//      (Fase 2.4) — no solo la construcción desde cero.
//   6. subdivideManzanoBatchInWorker() sobre TODOS los manzanos
//      resultantes, con chequeo de degeneración (Fase 2.2 a escala real,
//      con geometría irregular real, no fixtures de mano).
//
// Requiere runtime Tauri (invoca el motor nativo real, igual que
// undoRedoBenchmark.ts y spatialIndexBenchmark.ts).

import Polygon from 'ol/geom/Polygon.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type VectorSource from 'ol/source/Vector.js';
import type { FeatureCollection } from 'geojson';

import { useMapStore } from '../../store/map/mapStore';
import { useStreetStore } from '../../store/entities/streetStore';
import { useRoundaboutStore } from '../../store/entities/roundaboutStore';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import { useManzanoStore } from '../../store/entities/manzanoStore';
import { useCommandStack } from '../../commands/core/CommandStack';
import { recomputeManzanos, resetIncrementalRoadTracking } from '../recomputeManzanos';
import { getFeatureKind, ensureKind } from '../../core/objectModel';
import { polyArea, type Pt } from '../math/polygonEngine';
import { subdivideManzanoBatchInWorker } from '../../workers/geoWorkerClient';
import type { ManzanoLoteMethod } from '../subdivision/types';
import {
  generateSyntheticUrbanLayout,
  SYNTHETIC_URBAN_LAYOUT_DEFAULTS,
  type SyntheticUrbanLayoutOptions,
  type SyntheticUrbanLayoutResult,
  type SyntheticStreetEntry,
} from './syntheticUrbanLayout';

// ─── GeoJSON del/de los perímetro(s) sintéticos ────────────────────────

function perimetersToFeatureCollection(perimeters: Pt[][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: perimeters.map((ring, i) => ({
      type: 'Feature',
      id: `synthetic-urban-perimeter-${i}`,
      properties: ensureKind({ label: `Sitio sintético ${i + 1}` }, 'perimetro'),
      geometry: { type: 'Polygon', coordinates: [ring.map(([x, y]) => [x, y])] },
    })) as never[],
  };
}

// ─── Stats de manzanos resultantes ─────────────────────────────────────

interface ManzanoStats {
  count: number;
  area: { min: number; max: number; avg: number; totalM2: number };
  vertices: { minVertices: number; maxVertices: number; avgVertices: number };
}

function collectManzanoStats(drawSource: VectorSource): ManzanoStats {
  let count = 0;
  let minArea = Infinity, maxArea = 0, totalArea = 0;
  let minV = Infinity, maxV = 0, totalV = 0;

  drawSource.forEachFeature((f) => {
    const feat = f as Feature<Geometry>;
    if (getFeatureKind(feat) !== 'manzana') return;
    const geom = feat.getGeometry();
    if (!(geom instanceof Polygon)) return;
    const ring = (geom.getCoordinates()[0] ?? []) as number[][];
    if (ring.length < 4) return;

    const areaM2 = (feat.get('areaM2') as number | undefined) ?? polyArea(ring.map((c) => [c[0], c[1]] as Pt));
    count++;
    minArea = Math.min(minArea, areaM2);
    maxArea = Math.max(maxArea, areaM2);
    totalArea += areaM2;

    const v = ring.length - 1;
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
    totalV += v;
  });

  return {
    count,
    area: { min: count > 0 ? minArea : 0, max: maxArea, avg: count > 0 ? totalArea / count : 0, totalM2: totalArea },
    vertices: {
      minVertices: count > 0 ? minV : 0,
      maxVertices: maxV,
      avgVertices: count > 0 ? totalV / count : 0,
    },
  };
}

// ─── Aserción de consistencia del diff estructural (pasada incremental) ─

/**
 * Criterio de éxito de Fase 6.1 ademas de "0 degenerados": el diff
 * estructural de la pasada incremental debe reflejar EXACTAMENTE los
 * cambios reales de geometría.
 *
 * Dos invariantes (ver auditoria-para-mejora.md §Fase 6 — bug de
 * StructuralDiffRecorder.recordAdd con ids reciclados):
 *   1. Todo manzano presente antes y después con geometría distinta debe
 *      estar registrado como `modified` en el diff — si no, undo/redo no
 *      puede revertirlo (quedó un cambio invisible para el CommandStack).
 *   2. Todo manzano cuyo bbox NO interseca el corredor de la avenida
 *      agregada debe quedar intacto y AUSENTE del diff — si aparece o
 *      cambió, la reconciliación de fragmentos tocó zonas que no debía.
 */
export interface IncrementalConsistency {
  ok: boolean;
  /** Manzanos que cambiaron de geometría pero NO están en diff.modified. */
  changedGeometryAbsentFromDiff: string[];
  /** Manzanos fuera del corredor de la avenida que aparecieron en el diff
   * o cambiaron de geometría — nunca deberían tocarse. */
  untouchedButTouched: string[];
}

function ringsRoughlyEqual(a: Pt[], b: Pt[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i][0] - b[i][0]) > 1e-6 || Math.abs(a[i][1] - b[i][1]) > 1e-6) return false;
  }
  return true;
}

function collectManzanoRings(drawSource: VectorSource): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>();
  drawSource.forEachFeature((f) => {
    const feat = f as Feature<Geometry>;
    if (getFeatureKind(feat) !== 'manzana') return;
    const id = feat.getId();
    if (id == null) return;
    const geom = feat.getGeometry();
    if (!(geom instanceof Polygon)) return;
    const ring = (geom.getCoordinates()[0] ?? []) as number[][];
    if (ring.length < 4) return;
    out.set(String(id), ring.map((c) => [c[0], c[1]] as Pt));
  });
  return out;
}

function ringIntersectsExtent(ring: Pt[], ext: [number, number, number, number]): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return minX <= ext[2] && maxX >= ext[0] && minY <= ext[3] && maxY >= ext[1];
}

function checkIncrementalConsistency(
  drawSource: VectorSource,
  diff: Awaited<ReturnType<typeof recomputeManzanos>>,
  preRings: Map<string, Pt[]>,
  corridorExtent: [number, number, number, number],
): IncrementalConsistency {
  const postRings = collectManzanoRings(drawSource);
  const modifiedIds = new Set(diff.modified.map((m) => String(m.id)));
  const addedIds = new Set(diff.added.map((s) => String(s.id)));
  const removedIds = new Set(diff.removed.map((s) => String(s.id)));

  const changedGeometryAbsentFromDiff: string[] = [];
  const untouchedButTouched: string[] = [];

  for (const [id, pre] of preRings) {
    const post = postRings.get(id);
    if (post && !ringsRoughlyEqual(pre, post) && !modifiedIds.has(id)) {
      changedGeometryAbsentFromDiff.push(id);
    }
    if (!ringIntersectsExtent(pre, corridorExtent)) {
      if (modifiedIds.has(id) || addedIds.has(id) || removedIds.has(id)) {
        untouchedButTouched.push(id);
      } else if (post && !ringsRoughlyEqual(pre, post)) {
        untouchedButTouched.push(id);
      }
    }
  }

  for (const [id, ring] of postRings) {
    if (preRings.has(id)) continue;
    if (!ringIntersectsExtent(ring, corridorExtent)) untouchedButTouched.push(id);
  }

  return {
    ok: changedGeometryAbsentFromDiff.length === 0 && untouchedButTouched.length === 0,
    changedGeometryAbsentFromDiff,
    untouchedButTouched,
  };
}

// ─── Estrés de subdivisión (Fase 2.2) ──────────────────────────────────

export interface SubdivisionStressStats {
  manzanoCount: number;
  totalLots: number;
  remnantLots: number;
  /** Lotes con área <= 0, no-finita, o vértices no-finitos — nunca
   * debería ser > 0; si lo es, es una regresión del motor de subdivisión. */
  degenerateLots: number;
  elapsedMs: number;
}

async function runSubdivisionStress(
  drawSource: VectorSource,
  targetAreaM2: number,
  frontMinM: number,
): Promise<SubdivisionStressStats> {
  const manzanos: Array<{ id: string | number; ring: Array<[number, number]> }> = [];
  drawSource.forEachFeature((f) => {
    const feat = f as Feature<Geometry>;
    if (getFeatureKind(feat) !== 'manzana') return;
    const id = feat.getId();
    if (id == null) return;
    const geom = feat.getGeometry();
    if (!(geom instanceof Polygon)) return;
    const ring = geom.getCoordinates()[0];
    if (!ring || ring.length < 4) return;
    manzanos.push({ id, ring: ring.map((c) => [c[0], c[1]] as [number, number]) });
  });

  const batchInput = manzanos.map(({ id, ring }) => ({
    id,
    ring,
    method: 'auto' as ManzanoLoteMethod,
    targetAreaM2,
    frontMinM,
  }));

  const t0 = performance.now();
  let totalLots = 0, remnantLots = 0, degenerateLots = 0;
  const CHUNK = 16;

  for (let start = 0; start < batchInput.length; start += CHUNK) {
    const chunk = batchInput.slice(start, start + CHUNK);
    const results = await subdivideManzanoBatchInWorker(chunk);
    for (const r of results) {
      for (const lot of r.lots) {
        totalLots++;
        if (lot.isRemnant) remnantLots++;
        const finite =
          Number.isFinite(lot.areaM2) && lot.areaM2 > 0 &&
          lot.pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!finite) degenerateLots++;
      }
    }
  }

  return { manzanoCount: manzanos.length, totalLots, remnantLots, degenerateLots, elapsedMs: performance.now() - t0 };
}

// ─── Harness principal ──────────────────────────────────────────────────

export interface SyntheticUrbanBenchmarkOptions extends SyntheticUrbanLayoutOptions {
  /** Corre una segunda pasada agregando una avenida nueva, para medir el
   * costo INCREMENTAL (reconciliación de fragmentos, Fase 2.4) — no solo
   * la construcción desde cero. Default: true. */
  runIncrementalPass?: boolean;
  /** Corre subdivideManzanoBatch sobre todos los manzanos resultantes —
   * estrés real del motor de subdivisión (Fase 2.2). Default: true. */
  runSubdivisionStress?: boolean;
  targetAreaM2?: number;
  frontMinM?: number;
}

export interface SyntheticUrbanBenchmarkResult {
  layout: SyntheticUrbanLayoutResult;
  loadMs: number;
  initialRecomputeMs: number;
  manzanoCount: number;
  manzanoAreaStats: ManzanoStats['area'];
  fragmentCountsByVertex: ManzanoStats['vertices'];
  incrementalPass?: {
    addedStreetWidthM: number;
    recomputeMs: number;
    manzanoCountAfter: number;
    diffAddedCount: number;
    diffRemovedCount: number;
    diffModifiedCount: number;
    /** Aserción de consistencia diff ↔ cambios reales de geometría.
     * `ok: false` = el diff esconde cambios reales (agujero de undo/redo)
     * o tocó manzanos fuera del corredor de la avenida. */
    consistency: IncrementalConsistency;
  };
  subdivisionStress?: SubdivisionStressStats;
}

export async function runSyntheticUrbanBenchmark(
  opts: SyntheticUrbanBenchmarkOptions = {},
): Promise<SyntheticUrbanBenchmarkResult> {
  const drawSource = useMapStore.getState().drawSource;
  if (!drawSource) {
    throw new Error('drawSource no inicializado — asegurate de que <MapView/> esté montado.');
  }

  const t0 = performance.now();

  // Reset limpio — mismo criterio que runStreetUndoBenchmark.
  useStreetStore.getState().clearStreets();
  useRoundaboutStore.getState().clearRoundabouts();
  resetIncrementalRoadTracking();
  useManzanoStore.getState().resetAll();
  useLayersStore.getState().resetToEmpty();
  useCommandStack.getState().clear();

  const layout = generateSyntheticUrbanLayout(opts);

  useMapStore.getState().restoreDrawFeatures(perimetersToFeatureCollection(layout.perimeters));

  for (let i = 0; i < layout.streets.length; i++) {
    useStreetStore.getState().addStreetWithId(`synthetic-urban-street-${i}`, layout.streets[i]);
  }
  for (let i = 0; i < layout.roundabouts.length; i++) {
    useRoundaboutStore.getState().addRoundaboutWithId(`synthetic-urban-roundabout-${i}`, layout.roundabouts[i]);
  }

  const loadMs = performance.now() - t0;

  const r0 = performance.now();
  await recomputeManzanos();
  const initialRecomputeMs = performance.now() - r0;

  const initialStats = collectManzanoStats(drawSource);

  const result: SyntheticUrbanBenchmarkResult = {
    layout,
    loadMs,
    initialRecomputeMs,
    manzanoCount: initialStats.count,
    manzanoAreaStats: initialStats.area,
    fragmentCountsByVertex: initialStats.vertices,
  };

  // ── Pasada incremental — estresa la reconciliación de fragmentos
  //    (Fase 2.4): una avenida nueva atraviesa muchos manzanos ya
  //    existentes, que deben re-matchearse contra sus fragmentos previos
  //    por solapamiento de área en vez de recrearse desde cero. ──
  if (opts.runIncrementalPass ?? true) {
    const addedStreetWidthM = Math.max(opts.avenueWidthM ?? SYNTHETIC_URBAN_LAYOUT_DEFAULTS.avenueWidthM, 16);
    const sideWidthM = opts.sideWidthM ?? SYNTHETIC_URBAN_LAYOUT_DEFAULTS.sideWidthM;
    const midY = (layout.extent[1] + layout.extent[3]) / 2;
    const skew = (layout.extent[3] - layout.extent[1]) * 0.07;
    const extraStreet: SyntheticStreetEntry = {
      start: [layout.extent[0], midY],
      end: [layout.extent[2], midY + skew],
      widthM: addedStreetWidthM,
      sideWidthM,
      name: 'Avenida incremental sintética',
    };

    // Corredor de la avenida — misma aproximación que streetApproxExtent()
    // en recomputeManzanos.ts (bbox del eje ± ancho/cordones + margen):
    // los manzanos cuyo bbox NO lo interseca deben quedar intactos y
    // ausentes del diff estructural.
    const corridorHalf = addedStreetWidthM / 2 + Math.max(0, sideWidthM) + 2;
    const cMinX = Math.min(extraStreet.start[0], extraStreet.end[0]) - corridorHalf;
    const cMaxX = Math.max(extraStreet.start[0], extraStreet.end[0]) + corridorHalf;
    const cMinY = Math.min(extraStreet.start[1], extraStreet.end[1]) - corridorHalf;
    const cMaxY = Math.max(extraStreet.start[1], extraStreet.end[1]) + corridorHalf;
    const corridorExtent: [number, number, number, number] = [cMinX, cMinY, cMaxX, cMaxY];

    const preManzanoRings = collectManzanoRings(drawSource);
    useStreetStore.getState().addStreetWithId(`synthetic-urban-street-${layout.streets.length}`, extraStreet);

    const ri0 = performance.now();
    const diff = await recomputeManzanos();
    const recomputeMs = performance.now() - ri0;

    const afterStats = collectManzanoStats(drawSource);

    const consistency = checkIncrementalConsistency(drawSource, diff, preManzanoRings, corridorExtent);

    result.incrementalPass = {
      addedStreetWidthM,
      recomputeMs,
      manzanoCountAfter: afterStats.count,
      diffAddedCount: diff.added.length,
      diffRemovedCount: diff.removed.length,
      diffModifiedCount: diff.modified.length,
      consistency,
    };

    if (!consistency.ok) {
      const parts: string[] = [];
      if (consistency.changedGeometryAbsentFromDiff.length > 0) {
        const sample = consistency.changedGeometryAbsentFromDiff.slice(0, 5).join(', ');
        parts.push(
          `${consistency.changedGeometryAbsentFromDiff.length} manzano(s) con geometría cambiada AUSENTES del diff estructural (undo/redo no los revierte)${sample ? `: ${sample}` : ''}`,
        );
      }
      if (consistency.untouchedButTouched.length > 0) {
        const sample = consistency.untouchedButTouched.slice(0, 5).join(', ');
        parts.push(
          `${consistency.untouchedButTouched.length} manzano(s) fuera del corredor de la avenida tocados en el diff${sample ? `: ${sample}` : ''}`,
        );
      }
      throw new Error(
        `[Fase 6.1] Aserción de consistencia del diff estructural FALLÓ (grilla ${layout.gridCols}x${layout.gridRows}, ${afterStats.count} manzanos tras la pasada): ${parts.join(' | ')}`,
      );
    }
  }

  // ── Estrés de subdivisión sobre el estado FINAL (post-incremental si
  //    corrió) — geometría irregular real, no fixtures de mano. ──
  if (opts.runSubdivisionStress ?? true) {
    result.subdivisionStress = await runSubdivisionStress(
      drawSource,
      opts.targetAreaM2 ?? 250,
      opts.frontMinM ?? 12,
    );
  }

  return result;
}

export async function runSyntheticUrbanBenchmarkSuite(
  scales: SyntheticUrbanBenchmarkOptions[] = [
    { targetBlockCount: 25 },
    { targetBlockCount: 100 },
    { targetBlockCount: 400 },
  ],
): Promise<SyntheticUrbanBenchmarkResult[]> {
  const results: SyntheticUrbanBenchmarkResult[] = [];
  for (const scale of scales) results.push(await runSyntheticUrbanBenchmark(scale));
  return results;
}