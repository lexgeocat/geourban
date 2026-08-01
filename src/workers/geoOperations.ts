// src/workers/geoOperations.ts
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import PrecisionModel from 'jsts/org/locationtech/jts/geom/PrecisionModel.js';
import GeometryPrecisionReducer from 'jsts/org/locationtech/jts/precision/GeometryPrecisionReducer.js';
import polygonClipping, {
  type Polygon as ClipPolygon,
  type MultiPolygon as ClipMultiPolygon,
} from 'polygon-clipping';
import type { FeatureCollection, Polygon as GeoJsonPolygon, Feature as GeoJsonFeature } from 'geojson';
import {
  subdivide,
  subdivideManzano,
  type SubdivisionOptions,
  type SubdivisionResult,
  type ManzanoLoteMethod,
} from '../geo/subdivision/subdivisionAlgorithms';
import type { LotResult } from '../geo/math/polygonEngine';
import { computeRoadNetworkNet, type RoadNetworkNet } from '../geo/roads/roadNetworkNet';
import { matchFragmentsToMembers } from '../geo/roads/fragmentReconciliation';
import type { Street } from '../store/entities/streetStore';
import type { RoundaboutParams } from '../geo/roundabout/roundaboutEngine';
import type { CornerMode } from '../geo/roads/ringFillet';
import { sanitizeRing } from '../geo/sanitizeRing';

const geometryFactory = new GeometryFactory();
const reader = new GeoJSONReader(geometryFactory);
const writer = new GeoJSONWriter();

export type ComputeManzanosRequest = {
  type: 'computeManzanos';
  parcels: FeatureCollection;
  roadNetwork: FeatureCollection;
};

export type SubdivideRequest = {
  type: 'subdivide';
  polygon: GeoJsonPolygon;
  options: SubdivisionOptions;
};

export type SubdivideManzanoRequest = {
  type: 'subdivideManzano';
  ring: [number, number][];
  method: ManzanoLoteMethod;
  targetAreaM2: number;
  frontMinM: number;
  dirPref?: { ax: number; ay: number };
};

export type SubdivideManzanoBatchRequest = {
  type: 'subdivideManzanoBatch';
  manzanos: Array<{
    id: string | number;
    ring: [number, number][];
    method: ManzanoLoteMethod;
    targetAreaM2: number;
    frontMinM: number;
    dirPref?: { ax: number; ay: number };
  }>;
};

export type ComputeRoadNetworkNetRequest = {
  type: 'computeRoadNetworkNet';
  streets: Street[];
  roundabouts: RoundaboutParams[];
  cornerMode: CornerMode;
};

export interface MatchFragmentsBatchItem {
  groupIdx: number;
  fragments: [number, number][][];
  memberRings: [number, number][][];
}

export type MatchFragmentsBatchRequest = {
  type: 'matchFragmentsBatch';
  items: MatchFragmentsBatchItem[];
};

export type GeoWorkerRequest =
  | ComputeManzanosRequest
  | SubdivideRequest
  | SubdivideManzanoRequest
  | SubdivideManzanoBatchRequest
  | ComputeRoadNetworkNetRequest
  | MatchFragmentsBatchRequest;

export type GeoWorkerResponse =
  | { type: 'union' | 'merge' | 'intersect'; result: FeatureCollection; error?: string }
  | { type: 'subtract'; result: FeatureCollection; error?: string }
  | { type: 'validate'; valid: boolean; issues: string[]; error?: string }
  | { type: 'computeManzanos'; manzanos: FeatureCollection; error?: string }
  | { type: 'subdivide'; result: SubdivisionResult; error?: string }
  | { type: 'subdivideManzano'; lots: LotResult[]; error?: string }
  | { type: 'subdivideManzanoBatch'; results: Array<{ id: string | number; lots: LotResult[] }>; error?: string }
  | { type: 'computeRoadNetworkNet'; net: RoadNetworkNet; error?: string }
  | { type: 'matchFragmentsBatch'; results: Array<{ groupIdx: number; assignments: Array<{ fragmentIdx: number; memberIdx: number | null; overlapArea: number }> }>; error?: string };

/* ---------- Helpers ---------- */

function readAllGeometries(
  collection: FeatureCollection
): { geom: any; index: number }[] {
  const out: { geom: any; index: number }[] = [];
  collection.features.forEach((f, i) => {
    if (!f.geometry) return;
    try {
      out.push({ geom: reader.read(f.geometry), index: i });
    } catch {
      /* skip */
    }
  });
  return out;
}
const ROAD_UNION_PRECISION = 1e6;

// ─── Robustez anti-cuelgue (Fase 2.6/2.7) ──────────────────────────────
//
// JSTS (OverlayOp.difference/union) y polygon-clipping (martinez) no
// tienen cota propia de tiempo/complejidad frente a topología casi
// degenerada (vértices casi-coincidentes, aristas casi-paralelas,
// self-intersections producidas por el offset de calles casi-paralelas).
// Como ambas corren síncrono en un solo hilo, no se pueden interrumpir
// desde afuera una vez arrancadas — la única defensa real es no dejar
// que la geometría entre en ese estado: se snapea a una grilla fija
// (GeometryPrecisionReducer) y se repara con buffer(0) ANTES de pasar
// por cualquier operación booleana. Esto es la mitigación estándar para
// fallos de robustez de noding en JTS/GEOS.

const OVERLAY_PRECISION_SCALE = 1e4; // grilla de 0.1mm — suficiente para CAD/GIS, elimina ambigüedad de punto flotante
const overlayPrecisionModel = new PrecisionModel(OVERLAY_PRECISION_SCALE);

function reducePrecisionSafe(geom: any): any {
  if (!geom) return geom;
  try {
    const reduced = GeometryPrecisionReducer.reduce(geom, overlayPrecisionModel);
    if (reduced && !reduced.isEmpty?.()) return reduced;
  } catch (err) {
    console.warn('geoOperations: GeometryPrecisionReducer falló — se usa la geometría original.', err);
  }
  return geom;
}

function repairWithZeroBuffer(geom: any): any {
  if (!geom) return geom;
  try {
    const buffered = geom.buffer(0);
    if (buffered && !buffered.isEmpty?.() && (buffered.getArea?.() ?? 0) > 0) return buffered;
  } catch (err) {
    console.warn('geoOperations: buffer(0) de reparación falló — se usa la geometría sin reparar.', err);
  }
  return geom;
}

function makeOverlaySafe(geom: any): any {
  return repairWithZeroBuffer(reducePrecisionSafe(geom));
}

// OverlayOp.difference de JSTS no tiene cota propia de complejidad — con
// topología casi-degenerada (calles muy anchas/superpuestas redondeadas a
// 1e6) puede volverse extremadamente lenta o directamente colgarse. No hay
// forma de "timeout-earla" desde afuera porque es síncrona; la defensa
// real es (a) no llamarla sobre geometría combinada demasiado compleja, y
// (b) snapear/reparar la geometría antes de dársela (ver arriba).
const MANZANOS_DIFF_MAX_COMPLEXITY = 3000;
const MANZANOS_DIFF_MAX_SIDE_COMPLEXITY = 1500;

function geometryComplexity(geom: any): number {
  try {
    return geom?.getNumPoints?.() ?? 0;
  } catch {
    return 0;
  }
}

function safeDifference(geom: any, roadUnion: any, parcelIndex: number): any {
  const rawComplexity = geometryComplexity(geom) + geometryComplexity(roadUnion);
  if (rawComplexity > MANZANOS_DIFF_MAX_COMPLEXITY) {
    console.warn(
      `computeManzanos: parcela ${parcelIndex} omitida de la diferencia — complejidad combinada ` +
      `${rawComplexity} supera el límite de seguridad (${MANZANOS_DIFF_MAX_COMPLEXITY}). Se conserva intacta.`,
    );
    return geom;
  }

  const safeGeom = makeOverlaySafe(geom);
  const safeRoad = makeOverlaySafe(roadUnion);

  const safeComplexity = geometryComplexity(safeGeom) + geometryComplexity(safeRoad);
  if (safeComplexity === 0 || safeComplexity > MANZANOS_DIFF_MAX_SIDE_COMPLEXITY * 2) {
    console.warn(
      `computeManzanos: parcela ${parcelIndex} omitida tras el saneo (complejidad ${safeComplexity}) — se conserva intacta.`,
    );
    return geom;
  }

  try {
    return OverlayOp.difference(safeGeom, safeRoad);
  } catch (err) {
    console.warn(`computeManzanos: OverlayOp.difference falló para la parcela ${parcelIndex} (incluso saneada) — se conserva intacta.`, err);
    return geom;
  }
}

function robustUnionRoadNetwork(roadNetwork: FeatureCollection): any {
  const polys: ClipPolygon[] = [];
  for (const f of roadNetwork.features) {
    if (!f.geometry || f.geometry.type !== 'Polygon') continue;

    const sanitizedRings: [number, number][][] = [];
    (f.geometry as GeoJsonPolygon).coordinates.forEach((ring, idx) => {
      const clean = sanitizeRing(ring as [number, number][], {
        context: `geoOperations.robustUnionRoadNetwork.${idx === 0 ? 'outer' : 'hole'}`,
      });
      if (clean) sanitizedRings.push(clean);
    });
    if (sanitizedRings.length === 0) continue;

    const rounded = sanitizedRings.map((ring) =>
      ring.map(([x, y]) => [
        Math.round(x * ROAD_UNION_PRECISION) / ROAD_UNION_PRECISION,
        Math.round(y * ROAD_UNION_PRECISION) / ROAD_UNION_PRECISION,
      ] as [number, number]),
    );
    if (rounded[0] && rounded[0].length >= 4) polys.push(rounded as unknown as ClipPolygon);
  }
  if (polys.length === 0) return null;

  // Cota dura contra explosión combinatoria de la unión — si esto se
  // dispara con datos reales, es indicio de red vial patológicamente
  // densa, no un caso a "arreglar" dejándolo correr sin límite.
  const MAX_UNION_SHAPES = 800;
  const MAX_UNION_POINTS = 20000;
  const totalPoints = polys.reduce((sum, p) => sum + (p[0]?.length ?? 0), 0);
  if (polys.length > MAX_UNION_SHAPES || totalPoints > MAX_UNION_POINTS) {
    console.warn(
      `computeManzanos: unión de red vial omitida — ${polys.length} polígono(s)/${totalPoints} punto(s) supera ` +
      `el límite de seguridad (shapes: ${MAX_UNION_SHAPES}, points: ${MAX_UNION_POINTS}).`,
    );
    return null;
  }

  let mp: ClipMultiPolygon;
  try {
    mp = polygonClipping.union(polys[0], ...polys.slice(1));
  } catch (err1) {
    console.warn('computeManzanos: unión directa de red vial falló, reintentando con auto-limpieza.', err1);
    try {
      const selfCleaned: ClipPolygon[] = [];
      for (const p of polys) {
        try {
          for (const poly of polygonClipping.union(p)) selfCleaned.push(poly);
        } catch (errSelf) {
          console.warn('computeManzanos: auto-limpieza de un polígono individual de la red vial falló — se descarta.', errSelf);
        }
      }
      if (selfCleaned.length === 0) return null;
      mp = polygonClipping.union(selfCleaned[0], ...selfCleaned.slice(1));
    } catch (err2) {
      console.warn('computeManzanos: unión de red vial falló sin recuperación:', err2);
      return null;
    }
  }
  if (!mp || mp.length === 0) return null;
  const gj = mp.length === 1 ? { type: 'Polygon', coordinates: mp[0] } : { type: 'MultiPolygon', coordinates: mp };
  try {
    const raw = reader.read(gj as any);
    return makeOverlaySafe(raw);
  } catch (errRead) {
    console.warn('computeManzanos: JSTS GeoJSONReader no pudo leer el resultado de la unión — se descarta.', errRead);
    return null;
  }
}

export function computeManzanos(
  parcels: FeatureCollection,
  roadNetwork: FeatureCollection,
): FeatureCollection {
  const roadUnion = robustUnionRoadNetwork(roadNetwork);

  const parcelItems = readAllGeometries(parcels);
  const outFeatures: GeoJsonFeature[] = [];

  for (const { geom, index } of parcelItems) {
    const diffGeom = roadUnion ? safeDifference(geom, roadUnion, index) : geom;
    if (!diffGeom || diffGeom.isEmpty?.()) continue;

    const geomType = diffGeom.getGeometryType?.();
    const subGeoms =
      geomType === 'MultiPolygon'
        ? Array.from({ length: diffGeom.getNumGeometries() }, (_, i) => diffGeom.getGeometryN(i))
        : [diffGeom];

    for (const sub of subGeoms) {
      if (!sub || sub.isEmpty?.() || sub.getArea() < 0.5) continue;
      outFeatures.push({
        type: 'Feature',
        properties: { origParcelIndex: index },
        geometry: writer.write(sub) as GeoJsonPolygon,
      });
    }
  }

  return { type: 'FeatureCollection', features: outFeatures as never[] };
}

/* ---------- Subdivisión (H8) ---------- */

function runSubdivide(request: SubdivideRequest): GeoWorkerResponse {
  return { type: 'subdivide', result: subdivide(request.polygon, request.options) };
}

function runSubdivideManzano(request: SubdivideManzanoRequest): GeoWorkerResponse {
  const lots = subdivideManzano(
    request.ring,
    request.method,
    request.targetAreaM2,
    request.frontMinM,
    request.dirPref,
  );
  return { type: 'subdivideManzano', lots };
}

function runSubdivideManzanoBatch(request: SubdivideManzanoBatchRequest): GeoWorkerResponse {
  const results = request.manzanos.map((m) => ({
    id: m.id,
    lots: subdivideManzano(m.ring, m.method, m.targetAreaM2, m.frontMinM, m.dirPref),
  }));
  return { type: 'subdivideManzanoBatch', results };
}

/* ---------- Red vial y reconciliación de fragmentos (Fase 3) ---------- */

function runComputeRoadNetworkNet(request: ComputeRoadNetworkNetRequest): GeoWorkerResponse {
  const net = computeRoadNetworkNet(request.streets, request.roundabouts, request.cornerMode);
  return { type: 'computeRoadNetworkNet', net };
}

function runMatchFragmentsBatch(request: MatchFragmentsBatchRequest): GeoWorkerResponse {
  const results = request.items.map((item) => {
    const members = item.memberRings.map((ring, idx) => ({ ring, ref: idx }));
    const assignments = matchFragmentsToMembers<number>(item.fragments, members);
    return {
      groupIdx: item.groupIdx,
      assignments: assignments.map((a) => ({
        fragmentIdx: a.fragmentIdx,
        memberIdx: a.member,
        overlapArea: a.overlapArea,
      })),
    };
  });
  return { type: 'matchFragmentsBatch', results };
}

/* ---------- Dispatcher ---------- */

export function handleGeoWorkerRequest(request: GeoWorkerRequest): GeoWorkerResponse {
  try {
    switch (request.type) {
      case 'computeManzanos':
        return { type: 'computeManzanos', manzanos: computeManzanos(request.parcels, request.roadNetwork) };
      case 'subdivide':
        return runSubdivide(request);
      case 'subdivideManzano':
        return runSubdivideManzano(request);
      case 'subdivideManzanoBatch':
        return runSubdivideManzanoBatch(request);
      case 'computeRoadNetworkNet':
        return runComputeRoadNetworkNet(request);
      case 'matchFragmentsBatch':
        return runMatchFragmentsBatch(request);
      default:
        throw new Error(`Unknown request type: ${(request as any).type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    switch (request.type) {
      case 'computeManzanos':
        return { type: 'computeManzanos', manzanos: { type: 'FeatureCollection', features: [] }, error: message };
      case 'subdivide':
        return {
          type: 'subdivide',
          result: { ok: false, features: [], warnings: [], error: message },
          error: message,
        };
      case 'subdivideManzano':
        return { type: 'subdivideManzano', lots: [], error: message };
      case 'subdivideManzanoBatch':
        return { type: 'subdivideManzanoBatch', results: [], error: message };
      case 'computeRoadNetworkNet':
        return { type: 'computeRoadNetworkNet', net: { road: [], outer: [] }, error: message };
      case 'matchFragmentsBatch':
        return { type: 'matchFragmentsBatch', results: [], error: message };
      default:
        throw new Error(`Unknown request type in catch: ${(request as any).type}`, { cause: err });
    }
  }
}