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
  | 'cota'
  // Fase 1 (plan de mejora de capas) — nuevos kinds del catálogo sugerido:
  | 'urbanizacion'
  | 'georreferenciado'
  | 'rotonda'
  | 'vert_geo';

export type LayerKind = GeoUrbanFeatureKind;

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
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
  /** Cómo se pinta el color de los features dentro de esta capa:
   *  - 'solid': todos usan el `fillColor`/`color` de la capa (uniforme).
   *  - 'colorIdx': cada feature usa su `colorIdx` propio (manzanos). */
  colorMode: 'solid' | 'colorIdx';
}


/**
 * Fase 1 (plan de mejora del sistema de capas — ver
 * `diagnostico-plan-sistema-capas.md`): el registro de capas YA NO nace
 * con capas de fábrica. Todo proyecto nuevo, y todo `layersRegistryStore`
 * recién inicializado, arranca en `[]` — la primera capa la crea el
 * usuario a mano, o el resolver obligatorio de capa (Fase 2/3) al
 * dibujar/generar la primera entidad.
 *
 * Se mantiene el símbolo exportado por compatibilidad con los
 * import-sites históricos (`layersRegistryStore`, `io/types.ts`), pero
 * su valor es intencionalmente `[]`. NO restaurar contenido acá: el
 * catálogo "de fábrica" fue reemplazado por `LAYER_SUGGESTIONS` (abajo),
 * que es solo un catálogo de PLANTILLAS para prellenar el formulario de
 * "crear capa nueva" — nunca se auto-siembra.
 */
export const DEFAULT_LAYERS: Layer[] = [];

/** Plantilla de sugerencia para el flujo "crear capa nueva" (Fase 2).
 *  No es un `Layer` real — le faltan `id`/`zIndex`/`visible`/`locked`/
 *  `opacity`/`showLabel`/`showCota`, que se generan recién al confirmar
 *  la creación. `geometryHint` es solo informativo para la UI (ícono/
 *  etiqueta de tipo de geometría en el selector de capas). */
export interface LayerSuggestion {
  kind: GeoUrbanFeatureKind;
  name: string;
  color: string;
  fillColor: string;
  colorMode: 'solid' | 'colorIdx';
  geometryHint: 'polygon' | 'line' | 'point';
}

/**
 * Catálogo sugerido de capas (6 polígono, 2 línea, 1 punto). Colores
 * elegidos para no colisionar entre sí y, donde ya existía una
 * convención visual en el resto de la app, para ser consistentes con
 * ella:
 *   - 'urbanizacion' / 'georreferenciado': mismos colores que ya usa
 *     `BoundaryPainter` para pintar esos contornos.
 *   - 'rotonda': mismo coral/salmón que ya usan `RoundaboutPainter` y
 *     `RoundaboutPanel`.
 *   - 'manzana' / 'lote' / 'calle' / 'equipamiento' / 'area_verde':
 *     mismos colores que tenían las 5 capas de fábrica históricas.
 */
export const LAYER_SUGGESTIONS: LayerSuggestion[] = [
  { kind: 'urbanizacion', name: 'Urbanización', color: '#00d4ff', fillColor: '#00d4ff', colorMode: 'solid', geometryHint: 'polygon' },
  { kind: 'georreferenciado', name: 'Georreferenciado', color: '#10b981', fillColor: '#10b981', colorMode: 'solid', geometryHint: 'polygon' },
  { kind: 'manzana', name: 'Manzano', color: '#f59e0b', fillColor: '#f59e0b', colorMode: 'colorIdx', geometryHint: 'polygon' },
  { kind: 'lote', name: 'Lote', color: '#58a6ff', fillColor: '#58a6ff', colorMode: 'solid', geometryHint: 'polygon' },
  { kind: 'area_verde', name: 'Áreas verdes', color: '#3fb950', fillColor: '#3fb950', colorMode: 'solid', geometryHint: 'polygon' },
  { kind: 'equipamiento', name: 'Áreas de equipamientos', color: '#4dd0c4', fillColor: '#4dd0c4', colorMode: 'solid', geometryHint: 'polygon' },
  { kind: 'calle', name: 'Vías', color: '#8b5cf6', fillColor: '#8b5cf6', colorMode: 'solid', geometryHint: 'line' },
  { kind: 'rotonda', name: 'Rotonda', color: '#f78166', fillColor: '#f78166', colorMode: 'solid', geometryHint: 'line' },
  { kind: 'vert_geo', name: 'Vert_Geo', color: '#eab308', fillColor: '#eab308', colorMode: 'solid', geometryHint: 'point' },
];

/** Busca la sugerencia de catálogo para un `kind` dado — la usará el
 *  resolver de capas (Fase 2) para prellenar nombre/color al crear una
 *  capa nueva. `undefined` para kinds sin sugerencia predefinida (ej.
 *  'linea', 'texto', 'cota'). */
export function getLayerSuggestion(kind: GeoUrbanFeatureKind): LayerSuggestion | undefined {
  return LAYER_SUGGESTIONS.find((s) => s.kind === kind);
}


/** Capa de fallback creada on-demand al reconciliar features cuyo
 *  `layerId` no resuelve a ninguna capa del registro (proyecto importado
 *  con capas custom que ya no existen) — ver
 *  `layersRegistryStore.reconcileOrphanFeatures`. */
export const UNASSIGNED_LAYER_ID = 'unassigned';


export function createUnassignedLayer(zIndex: number): Layer {
  return {
    id: UNASSIGNED_LAYER_ID,
    name: 'Sin capa',
    kind: 'lote',
    zIndex,
    color: '#94a3b8',
    fillColor: '#94a3b8',
    visible: true,
    locked: false,
    opacity: 1,
    showLabel: true,
    showCota: true,
    colorMode: 'solid',
  };
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
  'urbanizacion', 'georreferenciado', 'rotonda', 'vert_geo',
]);

export function isGeoUrbanFeatureKind(value: unknown): value is GeoUrbanFeatureKind {
  return typeof value === 'string' && (KNOWN_KINDS as Set<string>).has(value);
}

/** Guard para LayerKind (alias de GeoUrbanFeatureKind). */
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