import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { LabelStyleConfig } from '@label-engine/model/labelModel';

export type GeoUrbanFeatureKind =
  | 'lote'
  | 'manzana'
  | 'via'
  | 'linea'
  | 'polilinea'
  | 'circulo'
  | 'punto'
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

interface LayerSuggestion {
  kind: GeoUrbanFeatureKind;
  name: string;
  color: string;
  geometryHint: 'polygon' | 'line' | 'point';
}

const LAYER_SUGGESTIONS: LayerSuggestion[] = [
  { kind: 'perimetro', name: 'Perímetro', color: '#f0f6fc', geometryHint: 'polygon' },
  { kind: 'manzana', name: 'Manzano', color: '#f59e0b', geometryHint: 'polygon' },
  { kind: 'lote', name: 'Lote', color: '#58a6ff', geometryHint: 'polygon' },
  { kind: 'via', name: 'Vías', color: '#8b5cf6', geometryHint: 'line' },
  { kind: 'rotonda', name: 'Rotonda', color: '#f78166', geometryHint: 'line' },
  { kind: 'linea', name: 'Línea', color: '#e2e8f0', geometryHint: 'line' },
  { kind: 'polilinea', name: 'Polilínea', color: '#ffd60a', geometryHint: 'line' },
  { kind: 'circulo', name: 'Círculo', color: '#a78bfa', geometryHint: 'polygon' },
  { kind: 'punto', name: 'Punto', color: '#34d399', geometryHint: 'point' },
];

export function getLayerSuggestion(kind: GeoUrbanFeatureKind): LayerSuggestion | undefined {
  return LAYER_SUGGESTIONS.find((s) => s.kind === kind);
}

interface BaseFeatureProps {
  kind: GeoUrbanFeatureKind;
  createdAt: string;
  label?: string;
  layerId?: string;
  labelConfig?: LabelStyleConfig;
  labelText?: string;
}

interface LoteProps extends BaseFeatureProps {
  kind: 'lote';
  areaM2: number;
  perimeterM: number;
  frontM?: number;
  depthM?: number;
  isRemnant: boolean;
  lotGroupId?: string;
  subdivisionMethod?: string;
  code?: string;
}

export type LotStatus = 'none' | 'subdivided' | 'pending';

interface ManzanaProps extends BaseFeatureProps {
  kind: 'manzana';
  areaM2: number;
  colorIdx: number;
  mznSeq?: number;
  code?: string;
  lotStatus?: LotStatus;
}

interface ViaProps extends BaseFeatureProps {
  kind: 'via';
  widthM: number;
}

interface LineaProps extends BaseFeatureProps {
  kind: 'linea';
}

interface PolilineaProps extends BaseFeatureProps {
  kind: 'polilinea';
}

interface CirculoProps extends BaseFeatureProps {
  kind: 'circulo';
  areaM2?: number;
  perimeterM?: number;
}

interface PuntoProps extends BaseFeatureProps {
  kind: 'punto';
}

interface PerimetroProps extends BaseFeatureProps {
  kind: 'perimetro';
  areaM2?: number;
  perimeterM?: number;
}

export type GeoUrbanFeatureProps =
  | LoteProps
  | ManzanaProps
  | ViaProps
  | LineaProps
  | PolilineaProps
  | CirculoProps
  | PuntoProps
  | PerimetroProps;

const KNOWN_KINDS: ReadonlySet<GeoUrbanFeatureKind> = new Set<GeoUrbanFeatureKind>([
  'lote',
  'manzana',
  'via',
  'linea',
  'polilinea',
  'circulo',
  'punto',
  'rotonda',
  'perimetro',
]);

function isGeoUrbanFeatureKind(value: unknown): value is GeoUrbanFeatureKind {
  return typeof value === 'string' && (KNOWN_KINDS as Set<string>).has(value);
}

export function isLayerKind(value: unknown): value is LayerKind {
  return isGeoUrbanFeatureKind(value);
}

const VALID_LOT_STATUSES: ReadonlySet<LotStatus> = new Set<LotStatus>([
  'none',
  'subdivided',
  'pending',
]);

function isLotStatus(value: unknown): value is LotStatus {
  return typeof value === 'string' && (VALID_LOT_STATUSES as Set<string>).has(value);
}

export function getFeatureKind(
  feature: Feature<Geometry> | null | undefined
): GeoUrbanFeatureKind | null {
  if (!feature) return null;
  const props = feature.getProperties() as Record<string, unknown>;
  const kind = props.kind;
  if (isGeoUrbanFeatureKind(kind)) return kind;
  const legacy = props.type;
  if (legacy === 'manzana') return 'manzana';
  if (legacy === 'lote' || (typeof legacy === 'string' && legacy.startsWith('Lote'))) return 'lote';
  if (legacy === 'via') return 'via';
  if (legacy === 'linea') return 'linea';
  return null;
}

export function getLotStatus(feature: Feature<Geometry> | null | undefined): LotStatus {
  if (!feature) return 'none';
  const value = feature.get('lotStatus');
  return isLotStatus(value) ? value : 'none';
}

export function setLotStatus(
  feature: Feature<Geometry> | null | undefined,
  status: LotStatus
): void {
  if (!feature) return;
  if (getFeatureKind(feature) !== 'manzana') return;
  feature.set('lotStatus', status, true);
}

export function ensureKind(
  props: Record<string, unknown>,
  fallback: GeoUrbanFeatureKind = 'lote'
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

const VERTEX_EDIT_EXCLUDED_KINDS: ReadonlySet<GeoUrbanFeatureKind> = new Set<GeoUrbanFeatureKind>([
  'rotonda',
  'circulo',
  'punto',
]);

export function isVertexEditableKind(feature: Feature<Geometry> | null | undefined): boolean {
  const kind = getFeatureKind(feature);
  if (!kind) return true;
  return !VERTEX_EDIT_EXCLUDED_KINDS.has(kind);
}

export function isRectangleFeature(feature: Feature<Geometry> | null | undefined): boolean {
  if (!feature) return false;
  return feature.get('shapeType') === 'rectangle';
}
