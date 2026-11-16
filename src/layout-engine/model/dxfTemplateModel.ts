import type {
  CartoWidgetId,
  CartoWidgetSpec,
  DxfEntityEdit,
  SheetAnnotationEntity,
  ViewportBoxNormalized,
} from './layoutTypes';

export interface DxfBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DxfBaseEntity {
  id: string;
  layer: string;
  colorIndex: number; // 256 = ByLayer, 0 = ByBlock, 1..255 = ACI
}

export interface DxfLineEntity extends DxfBaseEntity {
  type: 'LINE';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DxfLwPolylineEntity extends DxfBaseEntity {
  type: 'LWPOLYLINE';
  points: Array<[number, number]>;
  closed: boolean;
}

export interface DxfCircleEntity extends DxfBaseEntity {
  type: 'CIRCLE';
  cx: number;
  cy: number;
  radius: number;
}

export interface DxfArcEntity extends DxfBaseEntity {
  type: 'ARC';
  cx: number;
  cy: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}

export interface DxfTextEntity extends DxfBaseEntity {
  type: 'TEXT' | 'MTEXT';
  x: number;
  y: number;
  height: number;
  rotationDeg: number;
  text: string;
}

export interface DxfHatchEntity extends DxfBaseEntity {
  type: 'HATCH';
  patternName: string;
  solid: boolean;
  loops: Array<Array<[number, number]>>;
}

export type DxfEntity =
  | DxfLineEntity
  | DxfLwPolylineEntity
  | DxfCircleEntity
  | DxfArcEntity
  | DxfTextEntity
  | DxfHatchEntity;

export type DxfDynamicFieldKey =
  | 'mainScaleValue'
  | 'locationScaleValue'
  | 'planTitle'
  | 'municipalityHeader'
  | 'jurisdictionSubtitle'
  | 'ownerName'
  | 'sellerOrProcess'
  | 'locationAddress'
  | 'district'
  | 'zone'
  | 'urbanizationName'
  | 'manzanoCode'
  | 'lotCode'
  | 'locManzanoCode'
  | 'locLotCode'
  | 'surfaceTestimonioM2'
  | 'surfaceLevantamientoM2'
  | 'surfaceUtilM2'
  | 'surfaceConstruidaM2'
  | 'frontM'
  | 'depthM'
  | 'landUse'
  | 'ddrrMatricula'
  | 'catastralCode'
  | 'architectName'
  | 'professionalRegistry'
  | 'projectDate'
  | 'sheetCode';

export interface DxfDynamicFieldSlot {
  entityId: string;
  fieldKey: DxfDynamicFieldKey;
  originalText: string;
}

export interface DxfDetectedViewports {
  frameBBox: DxfBBox;
  mainViewportBox: ViewportBoxNormalized;
  locationViewportBox: ViewportBoxNormalized;
  dynamicSlots: DxfDynamicFieldSlot[];
  /** IDs de entidades que delimitan la caja de ubicación para poder respetar su recorte */
  locationFrameEntityIds: string[];
}

export interface DxfTemplateDoc {
  bbox: DxfBBox;
  entities: DxfEntity[];
  layerColors: Record<string, number>;
  detected: DxfDetectedViewports;
}

export type TemplateSourceKind = 'dxf-builtin' | 'dxf-custom' | 'iso-procedural';

export interface LayoutTemplateEntry {
  id: string;
  name: string;
  description: string;
  kind: TemplateSourceKind;
  isBlankSheet?: boolean;
  rawDxfText?: string;
  dxfDoc?: DxfTemplateDoc;
  isoPreset?: 'catastral-lateral' | 'banda-inferior';
  defaultMainBox: ViewportBoxNormalized;
  defaultLocationBox: ViewportBoxNormalized;
  savedDxfEntityEdits?: Record<string, DxfEntityEdit>;
  savedAnnotations?: SheetAnnotationEntity[];
  savedWidgets?: Partial<Record<CartoWidgetId, CartoWidgetSpec>>;
  saved?: boolean;
}
