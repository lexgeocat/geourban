import { extend as extendExtent, intersects as extentIntersects, type Extent } from 'ol/extent.js';
import Feature from 'ol/Feature.js';
import PolygonGeom from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import type VectorSource from 'ol/source/Vector.js';
import type { FeatureCollection, Feature as GeoJSONFeature } from 'geojson';

import { useMapStore } from '../store/map/mapStore';
import { updateFeatureMetrics } from './metrics';
import { polyArea, ringPerimeter, centroid, type Pt } from './math/polygonEngine';
import { useStreetStore, type Street } from '../store/entities/streetStore';
import { useRoundaboutStore, type Roundabout } from '../store/entities/roundaboutStore';
import { useManzanoStore } from '../store/entities/manzanoStore';
import { useLayersStore } from '../store/entities/layersRegistryStore';
import { useRecomputeStatusStore } from '../store/ui/recomputeStatusStore';
import { useRoadCornerStore } from '../store/map/roadCornerStore';
import {
  computeManzanosInWorker,
  subdivideManzanoInWorker,
  matchFragmentsBatchInWorker,
} from '../workers/geoWorkerClient';
import { confirmAsync } from '../store/ui/confirmDialogStore';
import { ensureKind, getFeatureKind, getLotStatus, setLotStatus } from '../core/objectModel';
import type { ManzanoLoteMethod } from './subdivision/types';
import { buildRoadNetworkRings } from './roads/roadNetworkEngine';
import { roundRingReflex, pointOnRing } from './roads/ringFillet';
import { resolveOrCreateLayerForKind } from '../store/entities/layerAutoCreate';
import { pickLayerId } from '../store/entities/layerResolution';
import { sanitizeFeatureCollectionRings } from './sanitizeGeoJson';
import { newId } from '../lib/id';
import {
  StructuralDiffRecorder,
  EMPTY_STRUCTURAL_DIFF,
  type StructuralDiff,
} from '../commands/core/structuralDiff';

function closeGeoRing(ring: Pt[]): Pt[] {
  const f = ring[0], l = ring[ring.length - 1];
  if (Math.abs(f[0] - l[0]) > 1e-9 || Math.abs(f[1] - l[1]) > 1e-9) return [...ring, [f[0], f[1]]];
  return ring;
}

const GEOMETRY_NOCHANGE_TOL = 1e-6;

function ringsApproxEqual(a: Pt[], b: Pt[], tol = GEOMETRY_NOCHANGE_TOL): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i][0] - b[i][0]) > tol || Math.abs(a[i][1] - b[i][1]) > tol) return false;
  }
  return true;
}

function ringsShapeEquivalent(a: Pt[], b: Pt[]): boolean {
  const areaA = polyArea(a);
  const areaB = polyArea(b);
  const areaTol = Math.max(0.05, Math.max(areaA, areaB) * 5e-4);
  if (Math.abs(areaA - areaB) > areaTol) return false;

  const perimA = ringPerimeter(a);
  const perimB = ringPerimeter(b);
  const perimTol = Math.max(0.02, Math.max(perimA, perimB) * 5e-4);
  if (Math.abs(perimA - perimB) > perimTol) return false;

  const centA = centroid(a);
  const centB = centroid(b);
  const centroidTol = Math.max(0.02, Math.sqrt(Math.max(areaA, areaB, 1)) * 5e-4);
  if (Math.hypot(centA[0] - centB[0], centA[1] - centB[1]) > centroidTol) return false;

  return true;
}

function ringsEffectivelyUnchanged(a: Pt[], b: Pt[]): boolean {
  return ringsApproxEqual(a, b) || ringsShapeEquivalent(a, b);
}


function currentRingOf(feature: Feature<Geometry>): Pt[] | null {
  const geom = feature.getGeometry();
  if (!(geom instanceof PolygonGeom)) return null;
  const ring = (geom.getCoordinates()[0] ?? []) as number[][];
  if (ring.length < 3) return null;
  return ring.map((c) => [c[0], c[1]] as Pt);
}

function restoreMemberToParcel(
  member: Feature<Geometry>,
  origPts: Pt[],
  origId: string,
  rootId: string,
  rootPts: Pt[],
  src: VectorSource,
  recorder: StructuralDiffRecorder,
): void {
  const alreadyLote = getFeatureKind(member) === 'lote';
  const currentRing = currentRingOf(member);
  const targetRing = closeGeoRing(origPts);
  const idMatches = String(member.getId() ?? '') === rootId;
  if (alreadyLote && currentRing && ringsEffectivelyUnchanged(currentRing, targetRing)) {
    return;
  }
  recorder.recordModifyBefore(member);
  member.setGeometry(new PolygonGeom([targetRing]));
  if (!alreadyLote) member.set('kind', 'lote', true);
  member.unset('lotStatus', true);
  member.set('origParcelId', origId, true);
  member.set('origPts', origPts, true);
  member.set('rootParcelId', rootId, true);
  member.set('rootParcelPts', rootPts, true);
  if (!idMatches && src.getFeatureById(rootId) == null) member.setId(rootId);
  src.addFeature(member);
  updateFeatureMetrics(member);
  recorder.recordModifyAfter(member);
}

function orientRingCcw(ring: Pt[]): Pt[] {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area >= 0 ? ring : ring.slice().reverse();
}

function ringsExtent(rings: Pt[][]): Extent | null {
  let result: Extent | null = null;
  for (const ring of rings) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!isFinite(minX)) continue;
    const e: Extent = [minX, minY, maxX, maxY];
    if (!result) result = e;
    else extendExtent(result, e);
  }
  return result;
}

function currentOrOriginalExtent(
  members: Array<Feature<Geometry>>,
  fallbackPts: Pt[],
): Extent | null {
  let ext: Extent | null = null;
  for (const m of members) {
    const geom = m.getGeometry();
    if (!geom) continue;
    const e = geom.getExtent();
    if (!ext) ext = [...e] as Extent;
    else extendExtent(ext, e);
  }
  return ext ?? ringsExtent([fallbackPts]);
}

function fragmentsMatchCurrentMembers(
  members: Array<Feature<Geometry>>,
  fragments: Pt[][],
): boolean {
  if (members.length === 0 || members.length !== fragments.length) return false;
  const currentAreas: number[] = [];
  for (const m of members) {
    const g = m.getGeometry();
    if (!(g instanceof PolygonGeom)) return false;
    const ring = ((g.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt);
    if (ring.length < 3) return false;
    currentAreas.push(polyArea(ring));
  }
  const fragAreas = fragments.map((f) => polyArea(f));
  currentAreas.sort((a, b) => a - b);
  fragAreas.sort((a, b) => a - b);
  for (let i = 0; i < currentAreas.length; i++) {
    const c = currentAreas[i], f = fragAreas[i];
    const tol = Math.max(0.5, Math.max(c, f) * 2e-3);
    if (Math.abs(c - f) > tol) return false;
  }
  return true;
}

interface RoadElementFingerprint {
  hash: string;
  extent: Extent;
}

let lastRoadFingerprints = new globalThis.Map<string, RoadElementFingerprint>();

export function resetIncrementalRoadTracking(): void {
  lastRoadFingerprints = new globalThis.Map();
}

function streetFingerprint(s: Street): string {
  return `${s.start[0]},${s.start[1]}|${s.end[0]},${s.end[1]}|${s.widthM}|${s.sideWidthM}|${(s.waypoints ?? []).map((w) => `${w[0]},${w[1]}`).join(';')}`;
}

function streetApproxExtent(s: Street): Extent {
  const half = s.widthM / 2 + Math.max(0, s.sideWidthM ?? 0) + 2;
  const pts: Array<[number, number]> = [s.start, ...(s.waypoints ?? []), s.end];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX - half, minY - half, maxX + half, maxY + half];
}

function roundaboutFingerprint(r: Roundabout): string {
  return `${r.center[0]},${r.center[1]}|${r.radiusM}|${r.sides}|${r.rotation}|${r.roadWidthM}|${r.sidewalkWidthM}`;
}

function roundaboutApproxExtent(r: Roundabout): Extent {
  const half = r.radiusM + r.roadWidthM + Math.max(0, r.sidewalkWidthM) + 2;
  return [r.center[0] - half, r.center[1] - half, r.center[0] + half, r.center[1] + half];
}

/**
 * Compara el estado actual de calles+rotondas contra el snapshot previo
 * (cacheado módulo-privado en `lastRoadFingerprints`) y devuelve:
 *  - `current`: el nuevo mapa de fingerprints, listo para ser cacheado
 *    en la próxima invocación.
 *  - `changedExtent`: extent unión de los elementos que cambiaron
 *    (incluye tanto los modificados como los eliminados). `null` si
 *    nada cambió.
 *
 * Función pura: opera solo sobre los argumentos, no muta `prev`, no
 * toca stores. El llamador decide si actualiza el cache global con `current`.
 */
export function computeRoadFingerprintDelta(
  streets: Street[],
  roundabouts: Roundabout[],
  prev: Map<string, RoadElementFingerprint>,
): { current: Map<string, RoadElementFingerprint>; changedExtent: Extent | null } {
  const current = new globalThis.Map<string, RoadElementFingerprint>();
  for (const s of streets) {
    current.set(`s:${s.id}`, { hash: streetFingerprint(s), extent: streetApproxExtent(s) });
  }
  for (const rb of roundabouts) {
    current.set(`r:${rb.id}`, { hash: roundaboutFingerprint(rb), extent: roundaboutApproxExtent(rb) });
  }

  let changedExtent: Extent | null = null;
  for (const [key, fp] of current) {
    const previous = prev.get(key);
    if (!previous || previous.hash !== fp.hash) {
      if (changedExtent) extendExtent(changedExtent, fp.extent);
      else changedExtent = [...fp.extent] as Extent;
    }
  }
  for (const [key, p] of prev) {
    if (!current.has(key)) {
      if (changedExtent) extendExtent(changedExtent, p.extent);
      else changedExtent = [...p.extent] as Extent;
    }
  }

  return { current, changedExtent };
}

const PERIMETER_WORKING_SUFFIX = '__working';

function ensurePerimeterWorkingCopies(src: VectorSource, recorder: StructuralDiffRecorder): void {
  const perimetros: Array<Feature<Geometry>> = [];
  src.forEachFeature((f) => {
    if (getFeatureKind(f as Feature<Geometry>) === 'perimetro') {
      perimetros.push(f as Feature<Geometry>);
    }
  });

  for (const perim of perimetros) {
    const perimId = perim.getId();
    if (perimId == null) continue;
    const workingId = `${perimId}${PERIMETER_WORKING_SUFFIX}`;
    if (src.getFeatureById(workingId) != null) continue;

    const geom = perim.getGeometry();
    if (!(geom instanceof PolygonGeom)) continue;

    const workingGeom = geom.clone();
const workingRing = ((workingGeom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt);

const working = new Feature({ geometry: workingGeom });
working.setId(workingId);
working.setProperties(
  ensureKind(
    {
      label: (perim.get('label') as string | undefined) ?? 'Parcela',
      perimeterSourceId: String(perimId),
      rootParcelId: workingId,
      rootParcelPts: workingRing,
    },
    'lote',
  ),
);
    const perimLayerId = (perim.get('layerId') as string | undefined) ?? resolveOrCreateLayerForKind('perimetro');
    working.set('layerId', perimLayerId, true);
    src.addFeature(working);
    recorder.recordAdd(working as Feature<Geometry>);
    updateFeatureMetrics(working as Feature<Geometry>);
  }
}

interface OriginGroup {
  origId: string;
  origPts: Pt[];
  members: Array<Feature<Geometry>>;
}

function collectOriginGroups(src: VectorSource): {
  groups: globalThis.Map<string, OriginGroup>;
  lotsByGroupId: globalThis.Map<string, Array<Feature<Geometry>>>;
} {
  const groups = new globalThis.Map<string, OriginGroup>();
  const lotsByGroupId = new globalThis.Map<string, Array<Feature<Geometry>>>();

  src.forEachFeature((f) => {
    const feature = f as Feature<Geometry>;
    const geom = feature.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;

    const kind = getFeatureKind(feature);
    if (kind !== 'lote' && kind !== 'manzana') return;

    if (kind === 'lote') {
      const gid = feature.get('lotGroupId') as string | undefined;
      if (gid) {
        if (!lotsByGroupId.has(gid)) lotsByGroupId.set(gid, []);
        lotsByGroupId.get(gid)!.push(feature);
        return;
      }
    }

    let origId = feature.get('origParcelId') as string | undefined;
    let origPts = feature.get('origPts') as Pt[] | undefined;

    if (!origPts) {
      const coords = (geom as PolygonGeom).getCoordinates();
      if (!coords[0] || coords[0].length < 4) return;
      origPts = coords[0].map((c: number[]) => [c[0], c[1]] as Pt);
    }
    if (!origId) {
      const fid = feature.getId();
      origId = fid != null ? String(fid) : newId('parcel');
    }

    let group = groups.get(origId);
    if (!group) {
      group = { origId, origPts, members: [] };
      groups.set(origId, group);
    }
    group.members.push(feature);
  });

  return { groups, lotsByGroupId };
}

function resolveRootParcel(
  feature: Feature<Geometry> | undefined,
  fallbackId: string,
  fallbackPts: Pt[],
): { rootId: string; rootPts: Pt[] } {
  const rid = feature?.get('rootParcelId') as string | undefined;
  const rpts = feature?.get('rootParcelPts') as Pt[] | undefined;
  if (rid && rpts && rpts.length >= 3) return { rootId: rid, rootPts: rpts };
  return { rootId: fallbackId, rootPts: fallbackPts };
}

interface RootGroup {
  rootId: string;
  rootPts: Pt[];
  members: Array<Feature<Geometry>>;
}
function collectRootGroups(src: VectorSource): {
  groups: globalThis.Map<string, RootGroup>;
  lotsByGroupId: globalThis.Map<string, Array<Feature<Geometry>>>;
} {
  const groups = new globalThis.Map<string, RootGroup>();
  const lotsByGroupId = new globalThis.Map<string, Array<Feature<Geometry>>>();

  src.forEachFeature((f) => {
    const feature = f as Feature<Geometry>;
    const geom = feature.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;

    const kind = getFeatureKind(feature);
    if (kind !== 'lote' && kind !== 'manzana') return;

    if (kind === 'lote') {
      const gid = feature.get('lotGroupId') as string | undefined;
      if (gid) {
        if (!lotsByGroupId.has(gid)) lotsByGroupId.set(gid, []);
        lotsByGroupId.get(gid)!.push(feature);
        return;
      }
    }

    let fallbackPts = feature.get('origPts') as Pt[] | undefined;
    if (!fallbackPts) {
      const coords = (geom as PolygonGeom).getCoordinates();
      if (!coords[0] || coords[0].length < 4) return;
      fallbackPts = coords[0].map((c: number[]) => [c[0], c[1]] as Pt);
    }
    const fallbackId =
      (feature.get('origParcelId') as string | undefined) ??
      (feature.getId() != null ? String(feature.getId()) : newId('parcel'));

    const { rootId, rootPts } = resolveRootParcel(feature, fallbackId, fallbackPts);

    let group = groups.get(rootId);
    if (!group) {
      group = { rootId, rootPts, members: [] };
      groups.set(rootId, group);
    }
    group.members.push(feature);
  });

  return { groups, lotsByGroupId };
}

function resolveManzanaLayerId(): string {
  return resolveOrCreateLayerForKind('manzana');
}
function syncPerimeterLayersVisibility(hasRoadNetwork: boolean): void {
  const registry = useLayersStore.getState();
  const shouldBeVisible = !hasRoadNetwork;
  for (const layer of registry.layers) {
    if (layer.kind !== 'perimetro') continue;
    if (layer.visible !== shouldBeVisible) {
      registry.update({ id: layer.id, visible: shouldBeVisible });
    }
  }
}
function resolveLoteLayerId(preferredLayerId?: string): string {
  return pickLayerId({
    kind: 'lote',
    override: preferredLayerId,
    requireKindMatch: true,
    autoCreate: true,
  })!;
}

interface RelotTask {
  featureId: string;
  method: ManzanoLoteMethod;
  dirPref?: { ax: number; ay: number };
  layerId?: string;
}

/**
 * Ejecuta la lista de tareas de re-lotización acumuladas durante la
 * reconciliación de fragmentos. Para cada tarea:
 *  - Si el usuario canceló `allowAutoRelot`, marca el manzano como
 *    `pending` (lotes a regenerar a mano) y guarda el método en el store.
 *  - Si la geometría del manzano ya no es un polígono válido, marca
 *    `pending` y aborta.
 *  - Si todo OK, llama al motor nativo para subdividir el anillo y crea
 *    las features de lote, asignando `layerId` con `resolveLoteLayerId`.
 *
 * Helper interno: encapsula el bloque que vivía inline al final de
 * `recomputeManzanosImmediate` y deja el flujo principal con un solo
 * `await applyRelotTasks(...)`. No cambia el comportamiento ni el orden
 * de las operaciones; cada efecto secundario sobre `src`/`recorder`/
 * `useManzanoStore` se preserva.
 */
async function applyRelotTasks(
  tasks: RelotTask[],
  allowAutoRelot: boolean,
  src: VectorSource,
  recorder: StructuralDiffRecorder,
  targetAreaM2: number,
  frontMinM: number,
): Promise<void> {
  for (const task of tasks) {
    const fragFeat = src.getFeatureById(task.featureId) as Feature<Geometry> | null;
    if (!fragFeat) continue;
    if (!allowAutoRelot) {
      setLotStatus(fragFeat, 'pending');
      recorder.recordModifyAfter(fragFeat);
      useManzanoStore.getState().setMethod(task.featureId, task.method);
      continue;
    }
    const fragGeom = fragFeat.getGeometry();
    if (!(fragGeom instanceof PolygonGeom)) {
      setLotStatus(fragFeat, 'pending');
      recorder.recordModifyAfter(fragFeat);
      continue;
    }
    const ring = ((fragGeom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt);
    try {
      const lots = await subdivideManzanoInWorker(ring, task.method, targetAreaM2, frontMinM, task.dirPref);
      let created = 0;
      lots.forEach((lot, i) => {
        if (lot.pts.length < 3) return;
        const closedRing = [...lot.pts];
        if (
          closedRing[0][0] !== closedRing[closedRing.length - 1][0] ||
          closedRing[0][1] !== closedRing[closedRing.length - 1][1]
        ) {
          closedRing.push([closedRing[0][0], closedRing[0][1]]);
        }
        const lotFeat = new Feature({ geometry: new PolygonGeom([closedRing]) });
        const lotId = newId(`lot-${task.featureId}`);
        lotFeat.setId(lotId);
        lotFeat.setProperties(
          ensureKind(
            {
              subdivision: task.method,
              lotGroupId: task.featureId,
              label: lot.isRemnant ? `Remanente ${i + 1}` : `Lote ${i + 1}`,
              areaM2: lot.areaM2,
              frontM: lot.frontM,
              depthM: lot.depthM,
              isRemnant: lot.isRemnant,
            },
            'lote',
          ),
        );
        const lotLid = resolveLoteLayerId(task.layerId);
        lotFeat.set('layerId', lotLid);
        src.addFeature(lotFeat);
        recorder.recordAdd(lotFeat as Feature<Geometry>);
        updateFeatureMetrics(lotFeat as Feature<Geometry>);
        created++;
      });
      setLotStatus(fragFeat, created > 0 ? 'subdivided' : 'pending');
      recorder.recordModifyAfter(fragFeat);
      useManzanoStore.getState().setMethod(task.featureId, task.method);
      if (task.dirPref) useManzanoStore.getState().setRotateDir(task.featureId, task.dirPref);
    } catch (err) {
      console.error('recomputeManzanos: fallo la re-lotización automática', err);
      setLotStatus(fragFeat, 'pending');
      recorder.recordModifyAfter(fragFeat);
    }
  }
}

async function recomputeManzanosImmediate(recorder: StructuralDiffRecorder): Promise<void> {
  const src = useMapStore.getState().drawSource;
  if (!src) return;

  const streets = useStreetStore.getState().streets;
  const roundabouts = useRoundaboutStore.getState().roundabouts;
  const hasRoadNetwork = streets.length > 0 || roundabouts.length > 0;

  syncPerimeterLayersVisibility(hasRoadNetwork);

  // ── Rama sin red vial: consolidar manzanos duplicados a la geometría
  //    raíz del grupo. Sin calles no hay fragmentación por vía, solo
  //    puede haber N manzanos derivados de la misma parcela que hay que
  //    colapsar en uno (el primario), descartando los duplicados y sus
  //    lotes hijos.
  if (!hasRoadNetwork) {
    const { groups, lotsByGroupId } = collectRootGroups(src);
    for (const group of groups.values()) {
      const manzanos = group.members.filter((m) => getFeatureKind(m) === 'manzana');
      if (manzanos.length === 0) continue;

      for (let i = 1; i < manzanos.length; i++) {
        const m = manzanos[i] as Feature<Geometry>;
        const mid = m.getId();
        if (mid != null) {
          const childLots = lotsByGroupId.get(String(mid));
          if (childLots) {
            for (const lot of childLots) {
              if (src.getFeatureById(lot.getId() as string | number) != null) {
                recorder.recordRemove(lot);
                src.removeFeature(lot);
              }
            }
          }
        }
        if (src.getFeatureById(m.getId() as string | number) != null) {
          recorder.recordRemove(m);
          src.removeFeature(m);
        }
      }

      const primary = manzanos[0] as Feature<Geometry>;
      restoreMemberToParcel(primary, group.rootPts, group.rootId, group.rootId, group.rootPts, src, recorder);
    }

    if (groups.size > 0) {
      const alive = new Set<string>();
      src.forEachFeature((f) => {
        if (getFeatureKind(f as Feature<Geometry>) === 'manzana') {
          const id = f.getId();
          if (id != null) alive.add(String(id));
        }
      });
      useManzanoStore.getState().pruneToIds(alive);
      src.changed();
    }
    return;
  }

  // ── Rama con red vial: pipeline completo de recompute.

  // Asegura copias "__working" de los perímetros para no mutar la
  // geometría original del usuario durante la reconciliación.
  ensurePerimeterWorkingCopies(src, recorder);

  // Agrupa features en `OriginGroup` (parcelas raíz + sus miembros ya
  // subdivididos) e indexa lotes por su `lotGroupId`.
  const { groups, lotsByGroupId } = collectOriginGroups(src);
  if (groups.size === 0) return;

  let manzanoCreated = false;

  // Anillos de la red vial (calles + rotondas) recortados contra los
  // perímetros — lo que se va a restar/intersectar contra las parcelas.
  const roadRings = buildRoadNetworkRings(streets, roundabouts);
  if (roadRings.length === 0) return;

  const roadExtentForOrphans = ringsExtent(roadRings);

  // Diff contra el snapshot de vías cacheado: qué extent cambió desde
  // la última corrida, para acotar el trabajo a las parcelas afectadas.
  const { current: currentFingerprints, changedExtent } = computeRoadFingerprintDelta(
    streets,
    roundabouts,
    lastRoadFingerprints,
  );
  lastRoadFingerprints = currentFingerprints;

  // Limpia lotes huérfanos (sin manzano padre) cuya geometría cae dentro
  // del extent de la red vial: el padre desapareció, los hijos también.
  if (roadExtentForOrphans) {
    for (const [gid, lots] of lotsByGroupId) {
      if (src.getFeatureById(gid) != null) continue;
      let lotsExtent: Extent | null = null;
      for (const lot of lots) {
        const g = lot.getGeometry();
        if (!g) continue;
        const e = g.getExtent();
        if (!lotsExtent) lotsExtent = [...e] as Extent;
        else extendExtent(lotsExtent, e);
      }
      if (lotsExtent && extentIntersects(lotsExtent, roadExtentForOrphans)) {
        for (const lot of lots) {
          if (src.getFeatureById(lot.getId() as string | number) != null) {
            recorder.recordRemove(lot);
            src.removeFeature(lot);
          }
        }
      }
    }
  }

  const allGroups = Array.from(groups.values());
  const parcelIndexToGroup: OriginGroup[] = roadExtentForOrphans
    ? allGroups.filter((g) => {
        const ext = currentOrOriginalExtent(g.members, g.origPts);
        if (ext == null) return false;
        if (changedExtent && !extentIntersects(ext, changedExtent)) return false;
        return extentIntersects(ext, roadExtentForOrphans);
      })
    : allGroups;

  if (parcelIndexToGroup.length === 0) return;

  const roadNetworkFC: FeatureCollection = {
    type: 'FeatureCollection',
    features: roadRings.map((ring) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeGeoRing(ring)] },
    })) as never[],
  };

  const parcelsFC: FeatureCollection = {
    type: 'FeatureCollection',
    features: parcelIndexToGroup.map((group) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeGeoRing(group.origPts)] },
    })) as never[],
  };

  let result: FeatureCollection;
  try {
    result = await computeManzanosInWorker(parcelsFC, roadNetworkFC);
  } catch (err) {
    console.error('recomputeManzanos: fallo la unión/diferencia de la red vial', err);
    return;
  }
  // Sanea geometría degenerada que el motor nativo pudo haber devuelto.
  {
    const { collection: sanitizedManzanos, droppedCount } = sanitizeFeatureCollectionRings(
      result,
      'recomputeManzanos.computeManzanosResult',
    );
    if (droppedCount > 0) {
      console.warn(`recomputeManzanos: se descartaron ${droppedCount} fragmento(s) de manzano por geometría degenerada.`);
    }
    result = sanitizedManzanos;
  }

  // Indexa los fragmentos de manzano por `origParcelIndex` (qué parcela
  // los produjo). Vacío o ausente = la parcela quedó completamente
  // cubierta por la red vial y no genera manzanos.
  const fragmentsByGroup = new globalThis.Map<number, Pt[][]>();
  result.features.forEach((f: GeoJSONFeature) => {
    const idx = f.properties?.origParcelIndex as number | undefined;
    if (idx == null || f.geometry?.type !== 'Polygon') return;
    const ring = (f.geometry.coordinates[0] as number[][]).map((c) => [c[0], c[1]] as Pt);
    if (ring.length < 4) return;
    if (!fragmentsByGroup.has(idx)) fragmentsByGroup.set(idx, []);
    fragmentsByGroup.get(idx)!.push(ring);
  });

  const targetAreaM2 = useManzanoStore.getState().targetAreaM2;
  const frontMinM = useManzanoStore.getState().frontMinM;

  const assignmentsByGroupIdx = new globalThis.Map<number, FragmentAssignment[]>();
  const memberAreaByRefPerGroup = new globalThis.Map<number, globalThis.Map<Feature<Geometry>, number>>();
  // Prepara tareas de reconciliación: para cada parcel, junta los miembros
  // existentes (anillos) que se pueden reutilizar con los fragmentos
  // nuevos que produjo el motor. Cada `reconTask` se manda en batch al
  // worker para que resuelva la asignación por área de solapamiento.
  const relotCandidates: Array<{ featureId: string; method: ManzanoLoteMethod; dirPref?: { ax: number; ay: number } }> = [];

  interface ReconTask {
    idx: number;
    fragments: Pt[][];
    existingMembers: Array<{ ring: Pt[]; ref: Feature<Geometry> }>;
  }
  const reconTasks: ReconTask[] = [];

  interface FragmentAssignment {
    fragmentIdx: number;
    member: Feature<Geometry> | null;
    overlapArea: number;
  }

  for (let idx = 0; idx < parcelIndexToGroup.length; idx++) {
    const group = parcelIndexToGroup[idx];
    const fragments = fragmentsByGroup.get(idx) ?? [];
       const existingMembers = group.members
      .map((m) => {
        const g = m.getGeometry();
        const ring = g instanceof PolygonGeom
          ? ((g.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt)
          : [];
        return { ring, ref: m as Feature<Geometry> };
      })
      .filter((x) => x.ring.length >= 3);

    const areaByRef = new globalThis.Map<Feature<Geometry>, number>();
    for (const em of existingMembers) areaByRef.set(em.ref, polyArea(em.ring));
    memberAreaByRefPerGroup.set(idx, areaByRef);

    reconTasks.push({ idx, fragments, existingMembers });
  }

  if (reconTasks.length > 0) {
    let batchResults: Array<{ groupIdx: number; assignments: Array<{ fragmentIdx: number; memberIdx: number | null; overlapArea: number }> }>;
    try {
      batchResults = await matchFragmentsBatchInWorker(
        reconTasks.map((t) => ({
          groupIdx: t.idx,
          fragments: t.fragments,
          memberRings: t.existingMembers.map((m) => m.ring),
        })),
      );
    } catch (err) {
      console.error(
        'recomputeManzanos: matchFragmentsBatch falló en el motor nativo (sin fallback desde 2.7) — se aborta el recompute.',
        err,
      );
      return;
    }

    // Resuelve asignaciones del worker y detecta candidatos a re-lotización:
    // un manzano ya subdividido cambia lo suficiente (>= 8% de área) como
    // para necesitar regenerar sus lotes. La decisión final se pide al
    // usuario una sola vez (más abajo, en el bloque `confirmAsync`).
    const resultsByGroupIdx = new globalThis.Map(batchResults.map((r) => [r.groupIdx, r.assignments]));

    for (const task of reconTasks) {
      const rawAssignments = resultsByGroupIdx.get(task.idx) ?? [];
      const assignments = rawAssignments.map((a) => ({
        fragmentIdx: a.fragmentIdx,
        member: a.memberIdx != null ? (task.existingMembers[a.memberIdx]?.ref ?? null) : null,
        overlapArea: a.overlapArea,
      }));
      assignmentsByGroupIdx.set(task.idx, assignments);

      const areaByRef = memberAreaByRefPerGroup.get(task.idx);
      for (const a of assignments) {
        if (!a.member) continue;
        const oldArea = areaByRef?.get(a.member) ?? 0;
        const fragArea = polyArea(task.fragments[a.fragmentIdx]);
        const ratioOld = oldArea > 0 ? a.overlapArea / oldArea : 0;
        const ratioFrag = fragArea > 0 ? a.overlapArea / fragArea : 0;
        const barelyChanged = Math.min(ratioOld, ratioFrag) >= 0.92;
        if (barelyChanged) continue;
        if (getLotStatus(a.member) !== 'subdivided') continue;
        const mid = a.member.getId();
        if (mid == null) continue;
        const hasLots = (lotsByGroupId.get(String(mid))?.length ?? 0) > 0;
        if (!hasLots) continue;
        relotCandidates.push({
          featureId: String(mid),
          method: useManzanoStore.getState().getMethod(mid),
          dirPref: useManzanoStore.getState().getRotateDir(mid),
        });
      }
    }
  }

  // Prompt único al usuario: si hay re-lotizaciones candidatas, pregunta
  // una sola vez si las quiere aplicar o prefiere manejar a mano.
  let allowAutoRelot = true;
  if (relotCandidates.length > 0) {
    const plural = relotCandidates.length > 1;
    allowAutoRelot = await confirmAsync(
      `El trazado nuevo modificó lo suficiente ${plural ? 'a estos manzanos ya lotizados' : 'a este manzano ya lotizado'} ` +
      `como para necesitar regenerar sus lotes automáticamente (el resto del proyecto no se ve afectado).\n\n` +
      'Si cancelás, el corte igual se aplica pero esos lotes quedan pendientes de regenerar a mano.',
      { title: '¿Regenerar lotes automáticamente?', confirmLabel: 'Continuar', cancelLabel: 'Cancelar' },
    );
  }

  // ── Reconciliación por parcel: para cada grupo, decide si el fragmento
  //    se puede reciclar sobre un manzano existente (preserve lotización)
  //    o si hay que crear uno nuevo. La cola `relotTasks` se consume
  //    abajo con `applyRelotTasks`, una vez terminada la reconciliación.
  const relotTasks: Array<{ featureId: string; method: ManzanoLoteMethod; dirPref?: { ax: number; ay: number }; layerId?: string }> = [];

  for (let idx = 0; idx < parcelIndexToGroup.length; idx++) {
    const group = parcelIndexToGroup[idx];
    const fragments = fragmentsByGroup.get(idx) ?? [];

const root = resolveRootParcel(group.members[0], group.origId, group.origPts);

const untouched = fragments.length === 1 && polyArea(fragments[0]) >= polyArea(group.origPts) * 0.999;
if (untouched) {
  const sole = group.members.length === 1 ? group.members[0] : null;
  if (sole && getFeatureKind(sole) === 'manzana') {
    continue;
  }
  restoreMemberToParcel(group.members[0], fragments[0], group.origId, root.rootId, root.rootPts, src, recorder);
  continue;
}

if (fragmentsMatchCurrentMembers(group.members, fragments)) continue;

const assignments = assignmentsByGroupIdx.get(idx) ?? [];
const areaByRef = memberAreaByRefPerGroup.get(idx) ?? new globalThis.Map<Feature<Geometry>, number>();
const reusedRefs = new Set(assignments.filter((a) => a.member != null).map((a) => a.member as Feature<Geometry>));

for (const m of group.members) {
  if (reusedRefs.has(m as Feature<Geometry>)) continue;
  const mid = m.getId();
  if (mid != null) {
    const childLots = lotsByGroupId.get(String(mid));
    if (childLots) {
          for (const lot of childLots) {
            if (src.getFeatureById(lot.getId() as string | number) != null) {
              recorder.recordRemove(lot);
              src.removeFeature(lot);
            }
          }
        }
      }
      recorder.recordRemove(m);
      src.removeFeature(m);
    }

    const cornerMode = useRoadCornerStore.getState().mode;

    for (let fi = 0; fi < fragments.length; fi++) {
      const rawRing = fragments[fi];
      const oriented = orientRingCcw(rawRing);
      let rounded = roundRingReflex(
        oriented, 0, false, cornerMode,
        (pt) => !pointOnRing(pt, root.rootPts),
      );
      if (rounded.length < 4) {
        const fallback = oriented.length >= 3 ? closeGeoRing(oriented) : [];
        if (fallback.length < 4 || polyArea(oriented) < 0.5) {
          console.warn(
            `recomputeManzanos: fragmento ${fi} del grupo ${group.origId} descartado por geometría degenerada`,
          );
          continue;
        }
        rounded = fallback;
      }

      const assignment = assignments.find((a) => a.fragmentIdx === fi);
      const reused = assignment?.member as Feature<Geometry> | undefined;

      if (reused) {
        const reusedId = reused.getId() as string | number;
        const oldArea = areaByRef.get(reused) ?? 0;
        const fragArea = polyArea(rawRing);
        const ratioOld = oldArea > 0 ? (assignment!.overlapArea / oldArea) : 0;
        const ratioFrag = fragArea > 0 ? (assignment!.overlapArea / fragArea) : 0;
        const barelyChanged = Math.min(ratioOld, ratioFrag) >= 0.92;

        const alreadyManzana = getFeatureKind(reused) === 'manzana';
        const currentRing = currentRingOf(reused);
        const geometryUnchanged =
  alreadyManzana && currentRing != null && ringsEffectivelyUnchanged(currentRing, rounded);

        if (geometryUnchanged) {
          continue;
        }

        recorder.recordModifyBefore(reused);
        reused.setGeometry(new PolygonGeom([rounded]));
        if (!alreadyManzana) {
          reused.set('kind', 'manzana', true);
          reused.set('layerId', resolveManzanaLayerId(), true);
          manzanoCreated = true;
        }
        reused.set('origParcelId', String(reused.getId()), true);
        reused.set('origPts', rounded, true);
        reused.set('rootParcelId', root.rootId, true);
        reused.set('rootParcelPts', root.rootPts, true);
        updateFeatureMetrics(reused as Feature<Geometry>);
        recorder.recordModifyAfter(reused);

        if (barelyChanged) continue;

        const wasSubdivided = getLotStatus(reused) === 'subdivided';
        const oldLots = lotsByGroupId.get(String(reusedId));
        if (oldLots && oldLots.length > 0) {
          const prevLotLayerId = oldLots[0]?.get('layerId') as string | undefined;
          for (const lot of oldLots) {
            if (src.getFeatureById(lot.getId() as string | number) != null) {
              recorder.recordRemove(lot);
              src.removeFeature(lot);
            }
          }
          if (wasSubdivided) {
            relotTasks.push({
              featureId: String(reusedId),
              method: useManzanoStore.getState().getMethod(reusedId),
              dirPref: useManzanoStore.getState().getRotateDir(reusedId),
              layerId: prevLotLayerId,
            });
          } else {
            setLotStatus(reused, 'none');
            recorder.recordModifyAfter(reused);
          }
        }
        continue;
      }

      const newFeat = new Feature({ geometry: new PolygonGeom([rounded]) });
      let fragId = `${group.origId}-mzn-${fi}`;
      let dupSuffix = 0;
      while (src.getFeatureById(fragId) != null) {
        fragId = `${group.origId}-mzn-${fi}-${++dupSuffix}`;
      }
      newFeat.setId(fragId);
      newFeat.setProperties(
  ensureKind({
    colorIdx: fi % 10,
    createdAt: new Date().toISOString(),
    origParcelId: fragId,      // ← auto-referencia
    origPts: rounded,
    rootParcelId: root.rootId,
    rootParcelPts: root.rootPts,
  }, 'manzana'),
);
      const lid = resolveManzanaLayerId();
      newFeat.set('layerId', lid);
      src.addFeature(newFeat);
      recorder.recordAdd(newFeat as Feature<Geometry>);
      updateFeatureMetrics(newFeat as Feature<Geometry>);
      manzanoCreated = true;
    }
  }

  // ── Cierre: aplica re-lotizaciones, prune de manzanos que ya no existen
  //    en el drawSource, muestra el panel si se creó al menos uno nuevo.
  await applyRelotTasks(relotTasks, allowAutoRelot, src, recorder, targetAreaM2, frontMinM);

  const aliveManzanoIds = new Set<string>();
  src.forEachFeature((f) => {
    if (getFeatureKind(f as Feature<Geometry>) === 'manzana') {
      const id = f.getId();
      if (id != null) aliveManzanoIds.add(String(id));
    }
  });
  useManzanoStore.getState().pruneToIds(aliveManzanoIds);

  if (manzanoCreated) {
    useManzanoStore.getState().setPanelVisible(true);
  }

  src.changed();
}

const RECOMPUTE_DEBOUNCE_MS = 250;
let recomputeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let recomputeInFlight: Promise<StructuralDiff> | null = null;
let recomputeResolve: ((diff: StructuralDiff) => void) | null = null;
let recomputeReject: ((err: unknown) => void) | null = null;
let pendingRecorder = new StructuralDiffRecorder();

export function recomputeManzanos(): Promise<StructuralDiff> {
  if (!recomputeInFlight) {
    recomputeInFlight = new Promise<StructuralDiff>((resolve, reject) => {
      recomputeResolve = resolve;
      recomputeReject = reject;
    });
  }
  useRecomputeStatusStore.getState().setRunning(true);
  if (recomputeDebounceTimer) clearTimeout(recomputeDebounceTimer);
  recomputeDebounceTimer = setTimeout(() => {
    recomputeDebounceTimer = null;
    const resolve = recomputeResolve!;
    const reject = recomputeReject!;
    recomputeResolve = null;
    recomputeReject = null;
    const recorder = pendingRecorder;
    pendingRecorder = new StructuralDiffRecorder();
    recomputeManzanosImmediate(recorder)
      .then(() => {
        const src = useMapStore.getState().drawSource;
        resolve(src ? recorder.toDiff(src) : EMPTY_STRUCTURAL_DIFF);
      }, reject)
      .finally(() => {
        recomputeInFlight = null;
        useRecomputeStatusStore.getState().setRunning(false);
      });
  }, RECOMPUTE_DEBOUNCE_MS);
  return recomputeInFlight;
}

export function waitForPendingRecompute(): Promise<void> {
  return recomputeInFlight ? recomputeInFlight.then(() => undefined) : Promise.resolve();
}

export async function reapplyRoadCornerMode(): Promise<void> {
  const src = useMapStore.getState().drawSource;
  if (!src) return;

  const streets = useStreetStore.getState().streets;
  const roundabouts = useRoundaboutStore.getState().roundabouts;
  if (streets.length === 0 && roundabouts.length === 0) return;

  const { groups } = collectOriginGroups(src);
  if (groups.size === 0) return;

  const touchedGroups = Array.from(groups.values()).filter((g) =>
    g.members.some((m) => getFeatureKind(m) === 'manzana'),
  );
  if (touchedGroups.length === 0) return;

  const roadRings = buildRoadNetworkRings(streets, roundabouts);
  if (roadRings.length === 0) return;

  useRecomputeStatusStore.getState().setRunning(true);
  try {
    const roadNetworkFC: FeatureCollection = {
      type: 'FeatureCollection',
      features: roadRings.map((ring) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closeGeoRing(ring)] },
      })) as never[],
    };

    const parcelsFC: FeatureCollection = {
      type: 'FeatureCollection',
      features: touchedGroups.map((group) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closeGeoRing(group.origPts)] },
      })) as never[],
    };

    let result: FeatureCollection;
    try {
      result = await computeManzanosInWorker(parcelsFC, roadNetworkFC);
    } catch (err) {
      console.error('reapplyRoadCornerMode: fallo la unión/diferencia de la red vial', err);
      return;
    }

    {
      const { collection: sanitizedManzanos, droppedCount } = sanitizeFeatureCollectionRings(
        result,
        'reapplyRoadCornerMode.computeManzanosResult',
      );
      if (droppedCount > 0) {
        console.warn(`reapplyRoadCornerMode: se descartaron ${droppedCount} fragmento(s) de manzano por geometría degenerada.`);
      }
      result = sanitizedManzanos;
    }

    const fragmentsByGroup = new globalThis.Map<number, Pt[][]>();
    result.features.forEach((f: GeoJSONFeature) => {
      const idx = f.properties?.origParcelIndex as number | undefined;
      if (idx == null || f.geometry?.type !== 'Polygon') return;
      const ring = (f.geometry.coordinates[0] as number[][]).map((c) => [c[0], c[1]] as Pt);
      if (ring.length < 4) return;
      if (!fragmentsByGroup.has(idx)) fragmentsByGroup.set(idx, []);
      fragmentsByGroup.get(idx)!.push(ring);
    });

    const cornerMode = useRoadCornerStore.getState().mode;

    interface ReconTask {
      groupIdx: number;
      fragments: Pt[][];
      existingMembers: Array<{ ring: Pt[]; ref: Feature<Geometry> }>;
    }
    const reconTasks: ReconTask[] = [];

    for (let idx = 0; idx < touchedGroups.length; idx++) {
      const group = touchedGroups[idx];
      const fragments = fragmentsByGroup.get(idx) ?? [];
      if (fragments.length === 0) continue;

      const oldManzanaMembers = group.members.filter((m) => getFeatureKind(m) === 'manzana');
      if (oldManzanaMembers.length === 0) continue;

      const existingMembers = oldManzanaMembers
        .map((m) => {
          const g = m.getGeometry();
          const ring = g instanceof PolygonGeom
            ? ((g.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt)
            : [];
          return { ring, ref: m as Feature<Geometry> };
        })
        .filter((x) => x.ring.length >= 3);

      reconTasks.push({ groupIdx: idx, fragments, existingMembers });
    }

    let batchResults: Array<{ groupIdx: number; assignments: Array<{ fragmentIdx: number; memberIdx: number | null; overlapArea: number }> }> = [];
    if (reconTasks.length > 0) {
      try {
        batchResults = await matchFragmentsBatchInWorker(
          reconTasks.map((t) => ({
            groupIdx: t.groupIdx,
            fragments: t.fragments,
            memberRings: t.existingMembers.map((m) => m.ring),
          })),
        );
      } catch (err) {
        console.error(
          'reapplyRoadCornerMode: matchFragmentsBatch falló en el motor nativo (sin fallback desde 2.7) — se aborta la reaplicación.',
          err,
        );
        return;
      }
    }

    const resultsByGroupIdx = new globalThis.Map(batchResults.map((r) => [r.groupIdx, r.assignments]));

    for (const task of reconTasks) {
      const rawAssignments = resultsByGroupIdx.get(task.groupIdx) ?? [];
      const group = touchedGroups[task.groupIdx];

      for (let i = 0; i < task.fragments.length; i++) {
        const assignment = rawAssignments.find((a) => a.fragmentIdx === i);
        const feat = assignment?.memberIdx != null ? task.existingMembers[assignment.memberIdx]?.ref : undefined;
        if (!feat) continue;
        const rounded = roundRingReflex(
          orientRingCcw(task.fragments[i]), 0, false, cornerMode,
          (pt) => !pointOnRing(pt, group.origPts),
        );
        if (rounded.length < 4) continue;
        feat.setGeometry(new PolygonGeom([rounded]));
        updateFeatureMetrics(feat as Feature<Geometry>);
      }
    }

    src.changed();
  } finally {
    useRecomputeStatusStore.getState().setRunning(false);
  }
}