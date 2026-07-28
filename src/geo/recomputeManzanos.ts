import { extend as extendExtent, intersects as extentIntersects, type Extent } from 'ol/extent.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Feature from 'ol/Feature.js';
import PolygonGeom from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import type VectorSource from 'ol/source/Vector.js';
import type { FeatureCollection, Feature as GeoJSONFeature } from 'geojson';

import { useMapStore } from '../store/map/mapStore';
import { updateFeatureMetrics } from './metrics';
import { polyArea, type Pt } from './math/polygonEngine';
import { useStreetStore, type Street } from '../store/entities/streetStore';
import { useRoundaboutStore, type Roundabout } from '../store/entities/roundaboutStore';
import { useManzanoStore } from '../store/entities/manzanoStore';
import { useLayersStore } from '../store/entities/layersRegistryStore';
import { useRecomputeStatusStore } from '../store/ui/recomputeStatusStore';
import { useRoadCornerStore } from '../store/map/roadCornerStore';
import {
  computeManzanosInWorker,
  subdivideManzanoInWorker,
  findOverlapsInWorker,
  findGapsInWorker,
} from '../workers/geoWorkerClient';
import { useTopologyWarningsStore } from '../store/topologyWarningsStore';
import { ensureKind, getFeatureKind, getLotStatus, setLotStatus } from '../core/objectModel';
import type { ManzanoLoteMethod } from './subdivision/subdivisionAlgorithms';
import { buildRoadNetworkRings } from './roads/roadNetworkEngine';
import { roundRingReflex, pointOnRing } from './roads/ringFillet';
import { matchFragmentsToMembers } from './roads/fragmentReconciliation';

const geoJsonFormat = new GeoJSON();

function closeGeoRing(ring: Pt[]): Pt[] {
  const f = ring[0], l = ring[ring.length - 1];
  if (Math.abs(f[0] - l[0]) > 1e-9 || Math.abs(f[1] - l[1]) > 1e-9) return [...ring, [f[0], f[1]]];
  return ring;
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
      origId = fid != null ? String(fid) : `parcel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function resolveManzanaLayerId(originMembers?: Array<Feature<Geometry>>): string | undefined {
  const reg = useLayersStore.getState();
  if (originMembers) {
    for (const m of originMembers) {
      const lid = m.get('layerId') as string | undefined;
      const layer = lid ? reg.getById(lid) : undefined;
      if (layer && !layer.locked) return layer.id;
    }
  }
  if (reg.activeLayerId) {
    const active = reg.getById(reg.activeLayerId);
    if (active && !active.locked) return active.id;
  }
  const match = reg.getLayerForKind('manzana');
  return match && !match.locked ? match.id : undefined;
}
function resolveLoteLayerId(preferredLayerId?: string): string | undefined {
  const reg = useLayersStore.getState();
  if (preferredLayerId) {
    const preferred = reg.getById(preferredLayerId);
    if (preferred && !preferred.locked) return preferred.id;
  }
  if (reg.activeLayerId) {
    const active = reg.getById(reg.activeLayerId);
    if (active && !active.locked) return active.id;
  }
  const match = reg.getLayerForKind('lote');
  return match && !match.locked ? match.id : undefined;
}

async function runBackgroundTopologyCheck(src: VectorSource): Promise<void> {
  useTopologyWarningsStore.getState().setChecking(true);
  try {
    const features = src.getFeatures();
    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: features.map((f) =>
        geoJsonFormat.writeFeatureObject(f, {
          featureProjection: 'EPSG:3857',
          dataProjection: 'EPSG:3857',
        })
      ),
    };
    const [overlaps, gaps] = await Promise.all([
      findOverlapsInWorker(collection),
      findGapsInWorker(collection),
    ]);

    const affected = new Set<string>();
    const attributeToManzano = (idx: number) => {
      const f = features[idx] as Feature<Geometry> | undefined;
      if (!f) return;
      const kind = getFeatureKind(f);
      if (kind === 'manzana') {
        const id = f.getId();
        if (id != null) affected.add(String(id));
      } else if (kind === 'lote') {
        const gid = f.get('lotGroupId') as string | undefined;
        if (gid) affected.add(gid);
      }
    };
    for (const o of overlaps) {
      attributeToManzano(o.indexA);
      attributeToManzano(o.indexB);
    }

    useTopologyWarningsStore.getState().setResults(overlaps.length, gaps.features.length, affected);
  } catch (err) {
    console.error('Validación topológica automática falló', err);
    useTopologyWarningsStore.getState().setChecking(false);
  }
}

export function checkTopologyInBackground(): void {
  const src = useMapStore.getState().drawSource;
  if (!src) return;
  void runBackgroundTopologyCheck(src);
}

async function recomputeManzanosImmediate(): Promise<void> {
  const src = useMapStore.getState().drawSource;
  if (!src) return;

  const streets = useStreetStore.getState().streets;
  const roundabouts = useRoundaboutStore.getState().roundabouts;
  if (streets.length === 0 && roundabouts.length === 0) return;

  const { groups, lotsByGroupId } = collectOriginGroups(src);
  if (groups.size === 0) return;

  let manzanoCreated = false;

  const roadRings = buildRoadNetworkRings(streets, roundabouts);
  if (roadRings.length === 0) return;

  const roadExtentForOrphans = ringsExtent(roadRings);

  const currentFingerprints = new globalThis.Map<string, RoadElementFingerprint>();
  for (const s of streets) {
    currentFingerprints.set(`s:${s.id}`, { hash: streetFingerprint(s), extent: streetApproxExtent(s) });
  }
  for (const rb of roundabouts) {
    currentFingerprints.set(`r:${rb.id}`, { hash: roundaboutFingerprint(rb), extent: roundaboutApproxExtent(rb) });
  }
  let changedExtent: Extent | null = null;
  for (const [key, fp] of currentFingerprints) {
    const prev = lastRoadFingerprints.get(key);
    if (!prev || prev.hash !== fp.hash) {
      if (changedExtent) extendExtent(changedExtent, fp.extent);
      else changedExtent = [...fp.extent] as Extent;
    }
  }
  for (const [key, prev] of lastRoadFingerprints) {
    if (!currentFingerprints.has(key)) {
      if (changedExtent) extendExtent(changedExtent, prev.extent);
      else changedExtent = [...prev.extent] as Extent;
    }
  }
  lastRoadFingerprints = currentFingerprints;

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

  const assignmentsByGroupIdx = new globalThis.Map<number, ReturnType<typeof matchFragmentsToMembers<Feature<Geometry>>>>();
  const memberAreaByRefPerGroup = new globalThis.Map<number, globalThis.Map<Feature<Geometry>, number>>();
  const relotCandidates: Array<{ featureId: string; method: ManzanoLoteMethod; dirPref?: { ax: number; ay: number } }> = [];

  for (let idx = 0; idx < parcelIndexToGroup.length; idx++) {
    const group = parcelIndexToGroup[idx];
    const fragments = fragmentsByGroup.get(idx) ?? [];
    const untouched = fragments.length === 1 && polyArea(fragments[0]) >= polyArea(group.origPts) * 0.999;
    if (untouched) continue;
    if (fragmentsMatchCurrentMembers(group.members, fragments)) continue;

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

    const assignments = matchFragmentsToMembers(fragments, existingMembers);
    assignmentsByGroupIdx.set(idx, assignments);

    for (const a of assignments) {
      if (!a.member) continue;
      const oldArea = areaByRef.get(a.member) ?? 0;
      const fragArea = polyArea(fragments[a.fragmentIdx]);
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

  let allowAutoRelot = true;
  if (relotCandidates.length > 0) {
    const plural = relotCandidates.length > 1;
    allowAutoRelot = window.confirm(
      `El trazado nuevo modificó lo suficiente ${plural ? 'a estos manzanos ya lotizados' : 'a este manzano ya lotizado'} ` +
      `como para necesitar regenerar sus lotes automáticamente (el resto del proyecto no se ve afectado).\n\n¿Continuar?\n\n` +
      'Si cancelás, el corte igual se aplica pero esos lotes quedan pendientes de regenerar a mano.'
    );
  }

  const relotTasks: Array<{ featureId: string; method: ManzanoLoteMethod; dirPref?: { ax: number; ay: number }; layerId?: string }> = [];

  for (let idx = 0; idx < parcelIndexToGroup.length; idx++) {
    const group = parcelIndexToGroup[idx];
    const fragments = fragmentsByGroup.get(idx) ?? [];

    const untouched = fragments.length === 1 && polyArea(fragments[0]) >= polyArea(group.origPts) * 0.999;
    if (untouched) {
      const orig = group.members[0];
      orig.setGeometry(new PolygonGeom([closeGeoRing(fragments[0])]));
      if (getFeatureKind(orig) !== 'lote') orig.set('kind', 'lote', true);
      orig.unset('lotStatus', true);
      orig.set('origParcelId', group.origId, true);
      orig.set('origPts', group.origPts, true);
      src.addFeature(orig);
      updateFeatureMetrics(orig as Feature<Geometry>);
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
            if (src.getFeatureById(lot.getId() as string | number) != null) src.removeFeature(lot);
          }
        }
      }
      src.removeFeature(m);
    }

    const cornerMode = useRoadCornerStore.getState().mode;

    for (let fi = 0; fi < fragments.length; fi++) {
      const rawRing = fragments[fi];
      const oriented = orientRingCcw(rawRing);
      let rounded = roundRingReflex(
        oriented, 0, false, cornerMode,
        (pt) => !pointOnRing(pt, group.origPts),
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

        reused.setGeometry(new PolygonGeom([rounded]));
        if (getFeatureKind(reused) !== 'manzana') {
          reused.set('kind', 'manzana', true);
          manzanoCreated = true;
        }
        // Crítico: sin esto, este manzano "reusado" pierde el vínculo con la
        // parcela madre original. En el próximo recompute, collectOriginGroups
        // ya no lo agrupa bien con sus hermanos y usa solo SU forma actual
        // como si fuera el perímetro completo -> borra al resto del grupo.
        reused.set('origParcelId', group.origId, true);
        reused.set('origPts', group.origPts, true);
        updateFeatureMetrics(reused as Feature<Geometry>);

        if (barelyChanged) continue;

        const wasSubdivided = getLotStatus(reused) === 'subdivided';
        const oldLots = lotsByGroupId.get(String(reusedId));
        if (oldLots && oldLots.length > 0) {
          const prevLotLayerId = oldLots[0]?.get('layerId') as string | undefined;
          for (const lot of oldLots) {
            if (src.getFeatureById(lot.getId() as string | number) != null) src.removeFeature(lot);
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
          }
        }
        continue;
      }

      const newFeat = new Feature({ geometry: new PolygonGeom([rounded]) });
      let newId = `${group.origId}-mzn-${fi}`;
      let dupSuffix = 0;
      while (src.getFeatureById(newId) != null) {
        newId = `${group.origId}-mzn-${fi}-${++dupSuffix}`;
      }
      newFeat.setId(newId);
      newFeat.setProperties(
        ensureKind(
          {
            colorIdx: fi % 10,
            createdAt: new Date().toISOString(),
            origParcelId: group.origId,
            origPts: group.origPts,
          },
          'manzana',
        ),
      );
      const lid = resolveManzanaLayerId(group.members);
      if (lid) newFeat.set('layerId', lid);
      src.addFeature(newFeat);
      updateFeatureMetrics(newFeat as Feature<Geometry>);
      manzanoCreated = true;
    }
  }

  // ── Re-lotización de los manzanos que sí perdieron sus lotes ────────
  for (const task of relotTasks) {
    const fragFeat = src.getFeatureById(task.featureId) as Feature<Geometry> | null;
    if (!fragFeat) continue;
    if (!allowAutoRelot) {
      setLotStatus(fragFeat, 'pending');
      useManzanoStore.getState().setMethod(task.featureId, task.method);
      continue;
    }
    const fragGeom = fragFeat.getGeometry();
    if (!(fragGeom instanceof PolygonGeom)) { setLotStatus(fragFeat, 'pending'); continue; }
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
        const lotId = `lot-${task.featureId}-${Date.now()}-${i}`;
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
        if (lotLid) lotFeat.set('layerId', lotLid);
        src.addFeature(lotFeat);
        updateFeatureMetrics(lotFeat as Feature<Geometry>);
        created++;
      });
      setLotStatus(fragFeat, created > 0 ? 'subdivided' : 'pending');
      useManzanoStore.getState().setMethod(task.featureId, task.method);
      if (task.dirPref) useManzanoStore.getState().setRotateDir(task.featureId, task.dirPref);
    } catch (err) {
      console.error('recomputeManzanos: fallo la re-lotización automática', err);
      setLotStatus(fragFeat, 'pending');
    }
  }

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
  void runBackgroundTopologyCheck(src);
}

const RECOMPUTE_DEBOUNCE_MS = 250;
let recomputeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let recomputeInFlight: Promise<void> | null = null;
let recomputeResolve: (() => void) | null = null;
let recomputeReject: ((err: unknown) => void) | null = null;

export function recomputeManzanos(): Promise<void> {
  if (!recomputeInFlight) {
    recomputeInFlight = new Promise<void>((resolve, reject) => {
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
    const work = recomputeManzanosImmediate()
      .then(resolve, reject)
      .finally(() => {
        recomputeInFlight = null;
        useRecomputeStatusStore.getState().setRunning(false);
      });
    recomputeInFlight = work;
  }, RECOMPUTE_DEBOUNCE_MS);
  return recomputeInFlight;
}

export function waitForPendingRecompute(): Promise<void> {
  return recomputeInFlight ?? Promise.resolve();
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

    for (let idx = 0; idx < touchedGroups.length; idx++) {
      const group = touchedGroups[idx];
      const fragments = fragmentsByGroup.get(idx) ?? [];
      if (fragments.length === 0) continue;

      const oldManzanaMembers = group.members.filter((m) => getFeatureKind(m) === 'manzana');
      if (oldManzanaMembers.length === 0) continue;

      // Emparejar por SOLAPAMIENTO ESPACIAL, no por posición en el array:
      // el orden que devuelve el worker no coincide necesariamente con el
      // orden de group.members, y eso podía intercambiar geometrías entre
      // dos manzanos al cambiar el modo de esquina.
      const existingMembers = oldManzanaMembers
        .map((m) => {
          const g = m.getGeometry();
          const ring = g instanceof PolygonGeom
            ? ((g.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt)
            : [];
          return { ring, ref: m as Feature<Geometry> };
        })
        .filter((x) => x.ring.length >= 3);

      const assignments = matchFragmentsToMembers(fragments, existingMembers);

      for (let i = 0; i < fragments.length; i++) {
        const assignment = assignments.find((a) => a.fragmentIdx === i);
        const feat = assignment?.member;
        if (!feat) continue;
        const rounded = roundRingReflex(
          orientRingCcw(fragments[i]), 0, false, cornerMode,
          (pt) => !pointOnRing(pt, group.origPts),
        );
        if (rounded.length < 4) continue;
        feat.setGeometry(new PolygonGeom([rounded]));
        updateFeatureMetrics(feat as Feature<Geometry>);
      }
    }

    src.changed();
    void runBackgroundTopologyCheck(src);
  } finally {
    useRecomputeStatusStore.getState().setRunning(false);
  }
}