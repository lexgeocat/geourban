import { invoke } from '@tauri-apps/api/core';
import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import { useMapStore } from '@map-core/store/mapStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { useManzanoStore } from '@lotificacion-engine/store/manzanoLotConfigStore';
import { useProjectCrsStore, type ProjectCrsMode } from '@georef-engine/store/projectCrsStore';
import type { UtmHemisphere } from '@georef-engine/crs/utmZones';
import { useUiShellStore } from '@app-shell/store/uiShellStore';
import type { BaseMapId } from '@map-core/baseMaps';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { useCommandStack } from '@kernel/command/CommandStack';
import { resetIncrementalRoadTracking } from '@manzanos-engine/orchestration/recomputeManzanos';
import { encodeWkb, decodeWkb, uint8ToBase64, base64ToUint8, type WkbGeometry } from './wkb';
import { getOrCreateSpatialIndex } from '@kernel/spatial-index/spatialIndex';
import { reloadRustSpatialIndex } from '@kernel/spatial-index/rustSpatialIndex';
import { refreshSourceMetrics } from '@georef-engine/metrics';
import { reseedManzanoSeqFromSource } from '@manzanos-engine/naming/manzanoNaming';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { useLabelClassStore } from '@label-engine/store/labelClassStore';
import type { LabelClass } from '@label-engine/model/labelClass';
import type { Layer } from '@kernel/domain-model/featureModel';
import type { LabelStyleConfig } from '@label-engine/model/labelModel';
import { normalizeLabelStyleConfig } from '@label-engine/model/labelModel';

interface LayerDto {
  id: string;
  name: string;
  kind: string;
  zIndex: number;
  color: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  showLabel: boolean;
  showCota: boolean;
}
interface FeatureDto {
  id: string;
  layerId: string | null;
  kind: string;
  geometryWkbB64: string;
  propertiesJson: string;
}
interface StreetDto {
  id: string;
  name: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  widthM: number;
  sideWidthM: number;
  waypointsJson: string | null;
  layerId: string | null;
}
interface RoundaboutDto {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  radiusM: number;
  sides: number;
  rotation: number;
  roadWidthM: number;
  sidewalkWidthM: number;
  layerId: string | null;
}
interface ProjectPayload {
  layers: LayerDto[];
  features: FeatureDto[];
  streets: StreetDto[];
  roundabouts: RoundaboutDto[];
  metaJson: string;
}
interface ProjectMeta {
  schemaVersion?: number;
  activeLayerId: string | null;
  baseMap: BaseMapId;
  crs: { mode: ProjectCrsMode; utmZone: number; utmHemisphere: UtmHemisphere };
  manzano: { targetAreaM2: number; frontMinM: number };
  viewConfig: { center: [number, number]; zoom: number };
  entityLabels?: Record<string, { config: LabelStyleConfig; text: string }>;
  labelClasses?: Record<string, LabelClass>;
}

const CURRENT_SCHEMA_VERSION = 2;

export interface ProjectSummary {
  name: string;
  modifiedAtMs: number;
  sizeBytes: number;
}

function geometryToWkb(geom: Geometry): WkbGeometry | null {
  if (geom instanceof Polygon)
    return { type: 'Polygon', coordinates: geom.getCoordinates() as [number, number][][] };
  if (geom instanceof LineString)
    return { type: 'LineString', coordinates: geom.getCoordinates() as [number, number][] };
  if (geom instanceof MultiPolygon)
    return { type: 'MultiPolygon', coordinates: geom.getCoordinates() as [number, number][][][] };
  return null;
}

function wkbToGeometry(wkb: WkbGeometry): Geometry {
  if (wkb.type === 'Polygon') return new Polygon(wkb.coordinates);
  if (wkb.type === 'LineString') return new LineString(wkb.coordinates);
  if (wkb.type === 'MultiPolygon') return new MultiPolygon(wkb.coordinates);
  const _exhaustive: never = wkb;
  throw new Error(
    `projectFile: geometría no soportada en drawSource (${(_exhaustive as { type: string }).type})`
  );
}

function buildPayload(): ProjectPayload {
  const drawSource = useMapStore.getState().drawSource;
  const layersState = useLayersStore.getState();
  const streetsState = useStreetStore.getState();
  const roundaboutsState = useRoundaboutStore.getState();
  const manzanoState = useManzanoStore.getState();
  const crsState = useProjectCrsStore.getState();
  const uiState = useUiShellStore.getState();
  const viewConfig = useMapStore.getState().viewConfig;

  const layers: LayerDto[] = layersState.layers.map((l: Layer) => ({
    id: l.id,
    name: l.name,
    kind: l.kind,
    zIndex: l.zIndex,
    color: l.color,
    visible: l.visible,
    locked: l.locked,
    opacity: l.opacity,
    showLabel: l.showLabel,
    showCota: l.showCota,
  }));

  const features: FeatureDto[] = [];
  if (drawSource) {
    drawSource.forEachFeature((f) => {
      const geom = f.getGeometry();
      if (!geom) return;
      const wkb = geometryToWkb(geom);
      if (!wkb) return;
      const id = f.getId();
      if (id == null) return;
      const props = { ...f.getProperties() };
      delete props.geometry;
      features.push({
        id: String(id),
        layerId: (props.layerId as string | undefined) ?? null,
        kind: (props.kind as string | undefined) ?? 'lote',
        geometryWkbB64: uint8ToBase64(encodeWkb(wkb)),
        propertiesJson: JSON.stringify(props),
      });
    });
  }

  const streets: StreetDto[] = streetsState.streets.map((s) => ({
    id: s.id,
    name: s.name,
    startX: s.start[0],
    startY: s.start[1],
    endX: s.end[0],
    endY: s.end[1],
    widthM: s.widthM,
    sideWidthM: s.sideWidthM,
    waypointsJson: s.waypoints ? JSON.stringify(s.waypoints) : null,
    layerId: s.layerId ?? null,
  }));

  const roundabouts: RoundaboutDto[] = roundaboutsState.roundabouts.map((r) => ({
    id: r.id,
    name: r.name,
    centerX: r.center[0],
    centerY: r.center[1],
    radiusM: r.radiusM,
    sides: r.sides,
    rotation: r.rotation,
    roadWidthM: r.roadWidthM,
    sidewalkWidthM: r.sidewalkWidthM,
    layerId: r.layerId ?? null,
  }));

  const meta: ProjectMeta = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeLayerId: layersState.activeLayerId,
    baseMap: uiState.baseMap,
    crs: { mode: crsState.mode, utmZone: crsState.utmZone, utmHemisphere: crsState.utmHemisphere },
    manzano: { targetAreaM2: manzanoState.targetAreaM2, frontMinM: manzanoState.frontMinM },
    viewConfig,
    entityLabels: useEntityLabelStore.getState().byId,
    labelClasses: useLabelClassStore.getState().byLayerId,
  };

  return { layers, features, streets, roundabouts, metaJson: JSON.stringify(meta) };
}

export async function saveProject(name: string): Promise<void> {
  const payload = buildPayload();
  await invoke('project_save', { name, payload });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>('project_list');
}

export async function deleteProject(name: string): Promise<void> {
  await invoke('project_delete', { name });
}

export async function loadProject(name: string): Promise<void> {
  const payload = await invoke<ProjectPayload>('project_load', { name });

  const drawSource = useMapStore.getState().drawSource;
  if (!drawSource) throw new Error('drawSource no inicializado');

  useCommandStack.getState().clear();
  useSelectionStore.getState().clear();
  useStreetStore.getState().clearStreets();
  useRoundaboutStore.getState().clearRoundabouts();
  resetIncrementalRoadTracking();
  drawSource.clear();

  const layers: Layer[] = payload.layers.map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind as Layer['kind'],
    zIndex: l.zIndex,
    color: l.color,
    visible: l.visible,
    locked: l.locked,
    opacity: l.opacity,
    showLabel: l.showLabel,
    showCota: l.showCota,
  }));

  const meta: ProjectMeta = JSON.parse(payload.metaJson || '{}');
  useLayersStore.getState().loadLayers(layers, meta.activeLayerId ?? null);

  const features: Feature<Geometry>[] = new Array(payload.features.length);
  for (let i = 0; i < payload.features.length; i++) {
    const dto = payload.features[i];
    const wkb = decodeWkb(base64ToUint8(dto.geometryWkbB64));
    const feat = new Feature({ geometry: wkbToGeometry(wkb) });
    feat.setId(dto.id);
    feat.setProperties(JSON.parse(dto.propertiesJson), true);
    features[i] = feat;
  }
  drawSource.addFeatures(features);
  getOrCreateSpatialIndex().load(features as unknown as Feature<Polygon>[]);
  void reloadRustSpatialIndex(features); // ← sincroniza también el índice nativo
  reseedManzanoSeqFromSource(drawSource);

  for (const s of payload.streets) {
    useStreetStore.getState().addStreetWithId(s.id, {
      start: [s.startX, s.startY],
      end: [s.endX, s.endY],
      widthM: s.widthM,
      sideWidthM: s.sideWidthM,
      waypoints: s.waypointsJson ? JSON.parse(s.waypointsJson) : undefined,
      layerId: s.layerId ?? undefined,
    });
  }
  for (const r of payload.roundabouts) {
    useRoundaboutStore.getState().addRoundaboutWithId(r.id, {
      center: [r.centerX, r.centerY],
      radiusM: r.radiusM,
      sides: r.sides,
      rotation: r.rotation,
      roadWidthM: r.roadWidthM,
      sidewalkWidthM: r.sidewalkWidthM,
      layerId: r.layerId ?? undefined,
    });
  }

  if (meta.crs) useProjectCrsStore.getState().loadConfig(meta.crs);
  if (meta.baseMap) useUiShellStore.getState().setBaseMap(meta.baseMap);
  if (meta.manzano) {
    useManzanoStore.getState().setTargetAreaM2(meta.manzano.targetAreaM2);
    useManzanoStore.getState().setFrontMinM(meta.manzano.frontMinM);
  }
  if (meta.viewConfig) useMapStore.getState().setViewConfig(meta.viewConfig);
  useEntityLabelStore.getState().loadAll(meta.entityLabels ?? {});

  useLabelClassStore.getState().loadAll(migrateLabelClasses(meta, layers));

  refreshSourceMetrics(drawSource);
}

function migrateLabelClasses(
  meta: ProjectMeta,
  layers: Layer[]
): Record<string, LabelClass> {
  const version = meta.schemaVersion ?? 1;
  if (version >= 2 && meta.labelClasses) {
    const out: Record<string, LabelClass> = {};
    for (const [layerId, cls] of Object.entries(meta.labelClasses)) {
      out[layerId] = { ...cls, style: normalizeLabelStyleConfig(cls.style) };
    }
    return out;
  }
  return synthesizeLabelClassesFromOverrides(layers);
}

function synthesizeLabelClassesFromOverrides(layers: Layer[]): Record<string, LabelClass> {
  const drawSource = useMapStore.getState().drawSource;
  if (!drawSource) return {};
  const buckets = new Map<string, Map<string, number>>();
  drawSource.forEachFeature((f) => {
    const layerId = f.get('layerId') as string | undefined;
    if (!layerId) return;
    const cfg = f.get('labelConfig') as LabelStyleConfig | undefined;
    if (!cfg) return;
    let bucket = buckets.get(layerId);
    if (!bucket) {
      bucket = new Map();
      buckets.set(layerId, bucket);
    }
    const key = JSON.stringify(cfg);
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  });
  const now = new Date().toISOString();
  const out: Record<string, LabelClass> = {};
  for (const layer of layers) {
    const bucket = buckets.get(layer.id);
    if (!bucket || bucket.size === 0) continue;
    let bestKey: string | null = null;
    let bestCount = 0;
    for (const [k, c] of bucket) {
      if (c > bestCount) {
        bestCount = c;
        bestKey = k;
      }
    }
    if (!bestKey) continue;
    const style = normalizeLabelStyleConfig(JSON.parse(bestKey) as LabelStyleConfig);
    out[layer.id] = {
      id: `lblc-mig-${layer.id}`,
      layerId: layer.id,
      name: 'Migrada',
      enabled: true,
      priority: 0,
      style,
      placement: { strategy: 'poleOfInaccessibility', allowLeaderLine: false },
      updatedAt: now,
    };
  }
  return out;
}
