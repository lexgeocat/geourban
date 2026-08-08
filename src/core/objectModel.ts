import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';

export type GeoUrbanFeatureKind =
  | 'lote'
  | 'manzana'
  | 'calle'
  | 'equipamiento'
  | 'linea'
  | 'rotonda'
  | 'perimetro';

export type LayerKind = GeoUrbanFeatureKind;

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  zIndex: number;
  color: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  showLabel: boolean;
  showCota: boolean;
}

export interface LayerSuggestion {
  kind: GeoUrbanFeatureKind;
  name: string;
  color: string;
  geometryHint: 'polygon' | 'line' | 'point';
}

export const LAYER_SUGGESTIONS: LayerSuggestion[] = [
  { kind: 'perimetro', name: 'Perímetro', color: '#f0f6fc', geometryHint: 'polygon' },
  { kind: 'manzana', name: 'Manzano', color: '#f59e0b', geometryHint: 'polygon' },
  { kind: 'lote', name: 'Lote', color: '#58a6ff', geometryHint: 'polygon' },
  { kind: 'equipamiento', name: 'Áreas de equipamientos', color: '#4dd0c4', geometryHint: 'polygon' },
  { kind: 'calle', name: 'Vías', color: '#8b5cf6', geometryHint: 'line' },
  { kind: 'rotonda', name: 'Rotonda', color: '#f78166', geometryHint: 'line' },
];

export function getLayerSuggestion(kind: GeoUrbanFeatureKind): LayerSuggestion | undefined {
  return LAYER_SUGGESTIONS.find((s) => s.kind === kind);
}

export interface BaseFeatureProps {
  kind: GeoUrbanFeatureKind;
  createdAt: string;
  label?: string;
  layerId?: string;
}

export interface LoteProps extends BaseFeatureProps {
  kind: 'lote';
  areaM2: number;
  perimeterM: number;
  frontM?: number;
  depthM?: number;
  isRemnant: boolean;
  lotGroupId?: string;
  subdivisionMethod?: string;
}

export type LotStatus = 'none' | 'subdivided' | 'pending';

export interface ManzanaProps extends BaseFeatureProps {
  kind: 'manzana';
  areaM2: number;
  colorIdx: number;
  lotStatus?: LotStatus;
}

export interface CalleProps extends BaseFeatureProps {
  kind: 'calle';
  widthM: number;
}

export interface EquipamientoProps extends BaseFeatureProps {
  kind: 'equipamiento';
  areaM2: number;
}

export interface LineaProps extends BaseFeatureProps {
  kind: 'linea';
}

export interface PerimetroProps extends BaseFeatureProps {
  kind: 'perimetro';
  areaM2?: number;
  perimeterM?: number;
}

export type GeoUrbanFeatureProps =
  | LoteProps
  | ManzanaProps
  | CalleProps
  | EquipamientoProps
  | LineaProps
  | PerimetroProps;

const KNOWN_KINDS: ReadonlySet<GeoUrbanFeatureKind> = new Set<GeoUrbanFeatureKind>([
  'lote', 'manzana', 'calle', 'equipamiento', 'linea',
  'rotonda', 'perimetro',
]);

export function isGeoUrbanFeatureKind(value: unknown): value is GeoUrbanFeatureKind {
  return typeof value === 'string' && (KNOWN_KINDS as Set<string>).has(value);
}

export function isLayerKind(value: unknown): value is LayerKind {
  return isGeoUrbanFeatureKind(value);
}

const VALID_LOT_STATUSES: ReadonlySet<LotStatus> = new Set<LotStatus>(['none', 'subdivided', 'pending']);

export function isLotStatus(value: unknown): value is LotStatus {
  return typeof value === 'string' && (VALID_LOT_STATUSES as Set<string>).has(value);
}

export function getFeatureKind(feature: Feature<Geometry> | null | undefined): GeoUrbanFeatureKind | null {
  if (!feature) return null;
  const props = feature.getProperties() as Record<string, unknown>;
  const kind = props.kind;
  if (isGeoUrbanFeatureKind(kind)) return kind;
  const legacy = props.type;
  if (legacy === 'manzana') return 'manzana';
  if (legacy === 'lote' || (typeof legacy === 'string' && legacy.startsWith('Lote'))) return 'lote';
  if (legacy === 'calle') return 'calle';
  if (legacy === 'equipamiento') return 'equipamiento';
  if (legacy === 'linea') return 'linea';
  return null;
}

export function getLotStatus(feature: Feature<Geometry> | null | undefined): LotStatus {
  if (!feature) return 'none';
  const value = feature.get('lotStatus');
  return isLotStatus(value) ? value : 'none';
}

export function setLotStatus(feature: Feature<Geometry> | null | undefined, status: LotStatus): void {
  if (!feature) return;
  if (getFeatureKind(feature) !== 'manzana') return;
  feature.set('lotStatus', status, true);
}

export function ensureKind(
  props: Record<string, unknown>,
  fallback: GeoUrbanFeatureKind = 'lote',
): GeoUrbanFeatureProps {
  const kind = isGeoUrbanFeatureKind(props.kind) ? props.kind : fallback;
  const createdAt =
    typeof props.createdAt === 'string' ? props.createdAt : new Date().toISOString();
  const merged: Record<string, unknown> = { ...props, kind, createdAt };
  if (kind === 'manzana' && !isLotStatus(merged.lotStatus)) {
    merged.lotStatus = 'none';
  }
  return merged as unknown as GeoUrbanFeatureProps;
}