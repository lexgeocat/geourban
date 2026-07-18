import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';

export type GeoUrbanFeatureKind =
  | 'lote'
  | 'manzana'
  | 'calle'
  | 'equipamiento'
  | 'area_verde'
  | 'linea'
  | 'texto'
  | 'cota';

export interface BaseFeatureProps {
  kind: GeoUrbanFeatureKind;
  createdAt: string;
  label?: string;
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

export interface ManzanaProps extends BaseFeatureProps {
  kind: 'manzana';
  areaM2: number;
  colorIdx: number;
}

export interface CalleProps extends BaseFeatureProps {
  kind: 'calle';
  widthM: number;
}

export interface EquipamientoProps extends BaseFeatureProps {
  kind: 'equipamiento';
  areaM2: number;
}

export interface AreaVerdeProps extends BaseFeatureProps {
  kind: 'area_verde';
  areaM2: number;
}

export interface LineaProps extends BaseFeatureProps {
  kind: 'linea';
}

export interface TextoProps extends BaseFeatureProps {
  kind: 'texto';
  text: string;
  size?: number;
}

export interface CotaProps extends BaseFeatureProps {
  kind: 'cota';
  value: number;
  unit: 'm' | 'm2' | 'deg';
}

export type GeoUrbanFeatureProps =
  | LoteProps
  | ManzanaProps
  | CalleProps
  | EquipamientoProps
  | AreaVerdeProps
  | LineaProps
  | TextoProps
  | CotaProps;

const KNOWN_KINDS: ReadonlySet<GeoUrbanFeatureKind> = new Set<GeoUrbanFeatureKind>([
  'lote',
  'manzana',
  'calle',
  'equipamiento',
  'area_verde',
  'linea',
  'texto',
  'cota',
]);

export function isGeoUrbanFeatureKind(value: unknown): value is GeoUrbanFeatureKind {
  return typeof value === 'string' && (KNOWN_KINDS as Set<string>).has(value);
}

/**
 * Lee `kind` tipado de un feature OL. Si la prop no existe (proyectos viejos
 * o features importados sin `kind` aún), infiere por la prop legacy `type`
 * para no romper la UI existente. Devuelve `null` si no se puede inferir.
 */
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
  if (legacy === 'area_verde') return 'area_verde';
  if (legacy === 'linea') return 'linea';
  if (legacy === 'texto') return 'texto';
  if (legacy === 'cota') return 'cota';
  return null;
}

export function ensureKind(
  props: Record<string, unknown>,
  fallback: GeoUrbanFeatureKind = 'lote',
): GeoUrbanFeatureProps {
  const kind = isGeoUrbanFeatureKind(props.kind) ? props.kind : fallback;
  const createdAt =
    typeof props.createdAt === 'string' ? props.createdAt : new Date().toISOString();
  return { ...props, kind, createdAt } as unknown as GeoUrbanFeatureProps;
}
