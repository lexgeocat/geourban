import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';

/**
 * ─── Contrato de datos (Fase 1 — ver diagnostico-motores-lotizacion-vial.md, §4 y Fase 1) ───
 *
 * `kind` (GeoUrbanFeatureKind) es la ÚNICA fuente de verdad para identificar
 * el tipo de un feature de acá en más. El campo legado `type` (string libre
 * de versiones previas de GeoUrban) NUNCA debe escribirse desde código
 * nuevo, y solo se LEE dentro de `getFeatureKind()` — exclusivamente como
 * fallback para migrar en caliente proyectos `.geourban` guardados antes de
 * este cambio.
 *
 * `lotStatus` formaliza el contrato de "manzano lotizado" (Fase 1) y ahora
 * (Fase 4) también el resultado del recorte automático por trazado vial:
 *  - 'none': manzana virgen, nunca lotizada.
 *  - 'subdivided': tiene lotes hijos vivos (`lotGroupId === String(id)`).
 *  - 'pending': ESTUVO lotizada, una calle/rotonda nueva la recortó, y el
 *    motor vial no pudo (o no quiso, por ambigüedad) re-lotizarla sola —
 *    ver `recomputeManzanosImmediate` en mapStore.ts. Requiere que el
 *    usuario la regenere a mano desde ManzanoPanel.
 *
 * Reglas de mantenimiento (solo aplica a kind:'manzana'):
 *  - Nace 'none' (lo aplica `ensureKind` acá abajo).
 *  - `RecomputeManzanoLotsCommand` (acción manual del usuario) SIEMPRE
 *    resuelve a 'subdivided' o 'none' según el resultado real — nunca deja
 *    'pending' colgado tras una acción manual.
 *  - `recomputeManzanosImmediate` (automático, al trazar vías) es el único
 *    lugar que puede escribir 'pending'.
 *  - `ManzanoPanel.handleToggleEquip` la limpia a 'none' al volver de
 *    "equipamiento" a "manzana".
 */

export type GeoUrbanFeatureKind =
  | 'lote'
  | 'manzana'
  | 'calle'
  | 'equipamiento'
  | 'area_verde'
  | 'linea'
  | 'texto'
  | 'cota';

export interface Layer {
  id: string;
  name: string;
  kind: string;
  zIndex: number;
  /** Color de contorno (trazo). */
  color: string;
  /** Color de relleno. */
  fillColor: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** Engranaje: ¿esta capa dibuja su etiqueta (nombre/número)? Solo se ve
   *  si el master global "Etiquetas" también está activo. */
  showLabel: boolean;
  /** Engranaje: ¿esta capa dibuja su acotación (longitudes/superficies)?
   *  Solo se ve si el master global "Acotaciones" también está activo. */
  showCota: boolean;
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

/** Estado de lotización de un feature `kind: 'manzana'` (Fase 1 + Fase 4). */
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
  'lote', 'manzana', 'calle', 'equipamiento', 'area_verde', 'linea', 'texto', 'cota',
]);

export function isGeoUrbanFeatureKind(value: unknown): value is GeoUrbanFeatureKind {
  return typeof value === 'string' && (KNOWN_KINDS as Set<string>).has(value);
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
  if (legacy === 'area_verde') return 'area_verde';
  if (legacy === 'linea') return 'linea';
  if (legacy === 'texto') return 'texto';
  if (legacy === 'cota') return 'cota';
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