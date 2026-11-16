export type PaperSizeId =
  | 'OFICIO_BOL'
  | 'LETTER'
  | 'LEGAL'
  | 'TABLOID'
  | 'A4'
  | 'A3'
  | 'A2'
  | 'A1'
  | 'A0'
  | 'ARCH_D'
  | 'CUSTOM';

export type PaperOrientation = 'landscape' | 'portrait';

export type LayoutThemeId =
  | 'monochrome-cad-white'
  | 'autocad-model-dark'
  | 'technical-light'
  | 'urbigeo-dark'
  | 'blueprint';

/**
 * Modo 1 ('direct'): Composición automática directa (por Lote individual o Urbanización completa).
 * Modo 2 ('qgis-viewport'): Editor tipo QGIS Print Composer con Viewports movibles/redimensionables y pan/zoom interno.
 */
export type LayoutCompositionMode = 'direct' | 'qgis-viewport';
export type LayoutScopeMode = 'lot' | 'urbanization';
export type QgisInteractionTool = 'pan-content' | 'edit-viewport-box';
export type ActiveViewportTarget = 'main' | 'location';
export type CarimboFitMode = 'adapt-sheet' | 'preserve-aspect';
export type ViewportFocusTarget = 'sheet' | 'main' | 'location' | 'carimbo';

export type CanvasEditorTool =
  | 'pan-content'
  | 'edit-viewport-box'
  | 'edit-elements'
  | 'draw-text'
  | 'draw-rect'
  | 'draw-line';

export type CartoWidgetId =
  | 'northArrow'
  | 'locationNorthArrow'
  | 'numericScale'
  | 'graphicScale'
  | 'locationGraphicScale'
  | 'coordTable'
  | 'extraDataBox';

export interface CartoWidgetSpec {
  id: CartoWidgetId;
  label: string;
  visible: boolean;
  xNorm: number;
  yNorm: number;
  scale: number;
  styleVariant?: 'clean' | 'badge';
}

export type LayoutFontFamily = 'cad' | 'sans' | 'mono' | 'serif';
export type LayoutLineStyle = 'solid' | 'dashed' | 'dash-dot' | 'dotted';

export function resolveLayoutFontCss(family?: LayoutFontFamily): string {
  switch (family) {
    case 'mono':
      return '"JetBrains Mono", "Consolas", monospace';
    case 'serif':
      return '"Georgia", "Times New Roman", serif';
    case 'sans':
      return '"Plus Jakarta Sans", "Arial", sans-serif';
    case 'cad':
    default:
      return '"Space Grotesk", "Bahnschrift", "Arial", sans-serif';
  }
}

export function resolveLayoutLineDash(style?: LayoutLineStyle, lw = 1.5): number[] {
  const f = Math.max(0.8, lw * 0.75);
  switch (style) {
    case 'dashed':
      return [9 * f, 5 * f];
    case 'dash-dot':
      return [12 * f, 4 * f, 2.5 * f, 4 * f];
    case 'dotted':
      return [2 * f, 4 * f];
    case 'solid':
    default:
      return [];
  }
}

export interface DxfEntityEdit {
  deleted?: boolean;
  dxNorm?: number;
  dyNorm?: number;
  scale?: number;
  lineWidth?: number;
  lineStyle?: LayoutLineStyle;
  text?: string;
  fontFamily?: LayoutFontFamily;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export type SheetAnnotationKind = 'text' | 'rect' | 'line';

export interface SheetAnnotationEntity {
  id: string;
  kind: SheetAnnotationKind;
  /** Coordenadas normalizadas 0..1 respecto al marco útil de la lámina */
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSizePt?: number;
  fontFamily?: LayoutFontFamily;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  lineWidth?: number;
  lineStyle?: LayoutLineStyle;
  dashed?: boolean;
  doubleBorder?: boolean;
  fillOpaque?: boolean;
}

export type SelectedCanvasItem =
  | { kind: 'dxf'; id: string }
  | { kind: 'widget'; id: CartoWidgetId }
  | { kind: 'annotation'; id: string }
  | null;

export const DEFAULT_CARTO_WIDGETS: Record<CartoWidgetId, CartoWidgetSpec> = {
  northArrow: {
    id: 'northArrow',
    label: 'Norte (Plano)',
    visible: true,
    xNorm: 0.98,
    yNorm: 0.03,
    scale: 1,
  },
  locationNorthArrow: {
    id: 'locationNorthArrow',
    label: 'Norte (Ubicación)',
    visible: true,
    xNorm: 0.96,
    yNorm: 0.04,
    scale: 1,
  },
  numericScale: {
    id: 'numericScale',
    label: 'Escala Numérica',
    visible: true,
    xNorm: 0.02,
    yNorm: 0.02,
    scale: 1,
    styleVariant: 'clean',
  },
  graphicScale: {
    id: 'graphicScale',
    label: 'Escala Gráfica',
    visible: true,
    xNorm: 0.98,
    yNorm: 0.97,
    scale: 1,
  },
  locationGraphicScale: {
    id: 'locationGraphicScale',
    label: 'Escala Gráfica Ubic.',
    visible: true,
    xNorm: 0.04,
    yNorm: 0.96,
    scale: 1,
  },
  coordTable: {
    id: 'coordTable',
    label: 'Cuadro Coordenadas',
    visible: true,
    xNorm: 0.02,
    yNorm: 0.97,
    scale: 1,
  },
  extraDataBox: {
    id: 'extraDataBox',
    label: 'Cuadro Datos Extra',
    visible: true,
    xNorm: 0.98,
    yNorm: 0.78,
    scale: 1,
  },
};

export interface CustomPaperSize {
  widthMm: number;
  heightMm: number;
  unit: 'mm' | 'in';
}

export interface ViewportBoxNormalized {
  /** Posición X izquierda normalizada (0..1 respecto al ancho del marco del carimbo) */
  x: number;
  /** Posición Y superior normalizada (0..1 respecto al alto del marco del carimbo) */
  y: number;
  /** Ancho normalizado (0..1) */
  w: number;
  /** Alto normalizado (0..1) */
  h: number;
}

export interface ViewportSpec {
  boxNormalized: ViewportBoxNormalized;
  scaleMode: 'auto' | 'preset' | 'manual';
  scaleDenominator: number;
  panOffsetMetric: [number, number];
}

export interface CustomCarimboField {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  placement: 'carimbo' | 'viewport';
}

export interface LotAttributeOverride {
  ownerName?: string;
  sellerOrProcess?: string;
  locationAddress?: string;
  surfaceTestimonioM2?: string;
  surfaceConstruidaM2?: string;
  ddrrMatricula?: string;
  catastralCode?: string;
  landUse?: string;
}

export interface CadastralFormFields {
  municipalityHeader: string;
  jurisdictionSubtitle: string;
  planTitle: string;
  ownerName: string;
  sellerOrProcess: string;
  locationAddress: string;
  district: string;
  zone: string;
  urbanizationName: string;
  manzanoCode: string;
  lotCode: string;
  surfaceTestimonioM2: string;
  surfaceLevantamientoM2: string;
  surfaceUtilM2: string;
  surfaceConstruidaM2: string;
  frontM: string;
  depthM: string;
  landUse: string;
  ddrrMatricula: string;
  catastralCode: string;
  architectName: string;
  professionalRegistry: string;
  projectDate: string;
  sheetCode: string;
  revision: string;
}

export interface LayoutDisplayOptions {
  showNorthArrow: boolean;
  showLocationNorthArrow: boolean;
  showScaleTextBadge: boolean;
  showGraphicScaleBar: boolean;
  showLocationScaleBar: boolean;
  showGrid: boolean;
  gridIntervalMode: 'auto' | 'manual';
  gridIntervalMeters: number;
  showVertexTable: boolean;
  showVertexMarkers: boolean;
  showExtraDataBox: boolean;
  showLotLabels: boolean;
  showLotDimensions: boolean;
  showStreetNames: boolean;
  showNeighbors: boolean;
  showLocationOsmTiles: boolean;
}

export interface LayoutConfig {
  paperSize: PaperSizeId;
  orientation: PaperOrientation;
  customPaper: CustomPaperSize;
  marginMm: number;
  carimboFitMode: CarimboFitMode;
  carimboScalePercent: number;
  theme: LayoutThemeId;
  compositionMode: LayoutCompositionMode;
  scopeMode: LayoutScopeMode;
  dataDrivenEnabled: boolean;
  selectedLotId: string | null;
  mainViewport: ViewportSpec;
  locationViewport: ViewportSpec;
  cadastral: CadastralFormFields;
  customFields: CustomCarimboField[];
  dxfTextOverrides: Record<string, string>;
  dxfEntityEdits: Record<string, DxfEntityEdit>;
  sheetAnnotations: SheetAnnotationEntity[];
  widgets: Record<CartoWidgetId, CartoWidgetSpec>;
  lotAttributeOverrides: Record<string, LotAttributeOverride>;
  display: LayoutDisplayOptions;
}

export const PAPER_DIMENSIONS_MM: Record<PaperSizeId, { widthMm: number; heightMm: number; label: string }> = {
  OFICIO_BOL: { widthMm: 330.2, heightMm: 215.9, label: 'Oficio 8.5×13" (330.2 × 215.9 mm)' },
  LETTER: { widthMm: 279.4, heightMm: 215.9, label: 'Carta / Letter 8.5×11" (279 × 216 mm)' },
  LEGAL: { widthMm: 355.6, heightMm: 215.9, label: 'Legal 8.5×14" (355.6 × 215.9 mm)' },
  TABLOID: { widthMm: 431.8, heightMm: 279.4, label: 'Tabloide 11×17" (432 × 279 mm)' },
  A4: { widthMm: 297, heightMm: 210, label: 'ISO A4 (297 × 210 mm)' },
  A3: { widthMm: 420, heightMm: 297, label: 'ISO A3 (420 × 297 mm)' },
  A2: { widthMm: 594, heightMm: 420, label: 'ISO A2 (594 × 420 mm)' },
  A1: { widthMm: 841, heightMm: 594, label: 'ISO A1 (841 × 594 mm)' },
  A0: { widthMm: 1189, heightMm: 841, label: 'ISO A0 (1189 × 841 mm)' },
  ARCH_D: { widthMm: 914.4, heightMm: 609.6, label: 'ARCH D 24×36" (914 × 610 mm)' },
  CUSTOM: { widthMm: 500, heightMm: 350, label: 'Personalizado (Medidas Libre)' },
};

export function getEffectivePaperDimensionsMm(
  config: Pick<LayoutConfig, 'paperSize' | 'orientation' | 'customPaper'>
): {
  widthMm: number;
  heightMm: number;
  baseWidthMm: number;
  baseHeightMm: number;
  label: string;
} {
  if (config.paperSize === 'CUSTOM') {
    const w = Math.max(80, Math.min(3000, config.customPaper.widthMm || 500));
    const h = Math.max(80, Math.min(3000, config.customPaper.heightMm || 350));
    return {
      widthMm: w,
      heightMm: h,
      baseWidthMm: Math.max(w, h),
      baseHeightMm: Math.min(w, h),
      label: `Personalizado (${w.toFixed(1)} × ${h.toFixed(1)} mm)`,
    };
  }
  const base = PAPER_DIMENSIONS_MM[config.paperSize];
  const isLandscape = config.orientation === 'landscape';
  return {
    widthMm: isLandscape ? base.widthMm : base.heightMm,
    heightMm: isLandscape ? base.heightMm : base.widthMm,
    baseWidthMm: base.widthMm,
    baseHeightMm: base.heightMm,
    label: base.label,
  };
}

export const MAIN_PRESET_SCALES: number[] = [
  50, 75, 100, 125, 150, 200, 250, 300, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000, 10000,
];

export const LOCATION_PRESET_SCALES: number[] = [
  500, 750, 1000, 1250, 1500, 2000, 2500, 5000, 7500, 10000, 15000, 25000, 50000,
];

export interface ThemePalette {
  isMonochrome: boolean;
  isLight: boolean;
  sheetBg: string;
  mapBg: string;
  locMapBg: string;
  panelBg: string;
  panelHeaderBg: string;
  panelHeaderText: string;
  borderOuter: string;
  borderInner: string;
  dxfStrokeDefault: string;
  dxfTextDefault: string;
  dxfHatchFill: string;
  gridMajor: string;
  gridMinor: string;
  gridText: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentPrimary: string;
  accentSecondary: string;
  streetRoadFill: string;
  streetSidewalkFill: string;
  streetCenterline: string;
  manzanaFill: string;
  manzanaStroke: string;
  loteFill: string;
  loteStroke: string;
  selectedLotFill: string;
  selectedLotStroke: string;
  perimetroStroke: string;
}

export const THEME_PALETTES: Record<LayoutThemeId, ThemePalette> = {
  'monochrome-cad-white': {
    isMonochrome: true,
    isLight: true,
    sheetBg: '#FFFFFF',
    mapBg: '#FFFFFF',
    locMapBg: '#FFFFFF',
    panelBg: '#FFFFFF',
    panelHeaderBg: '#111827',
    panelHeaderText: '#FFFFFF',
    borderOuter: '#000000',
    borderInner: '#374151',
    dxfStrokeDefault: '#000000',
    dxfTextDefault: '#000000',
    dxfHatchFill: '#111827',
    gridMajor: 'rgba(0, 0, 0, 0.24)',
    gridMinor: 'rgba(0, 0, 0, 0.10)',
    gridText: '#111827',
    textPrimary: '#000000',
    textSecondary: '#1F2937',
    textMuted: '#4B5563',
    accentPrimary: '#000000',
    accentSecondary: '#374151',
    streetRoadFill: '#F3F4F6',
    streetSidewalkFill: '#E5E7EB',
    streetCenterline: '#111827',
    manzanaFill: 'rgba(0, 0, 0, 0.04)',
    manzanaStroke: '#111827',
    loteFill: 'rgba(0, 0, 0, 0.015)',
    loteStroke: '#1F2937',
    selectedLotFill: 'rgba(0, 0, 0, 0.09)',
    selectedLotStroke: '#000000',
    perimetroStroke: '#000000',
  },
  'autocad-model-dark': {
    isMonochrome: true,
    isLight: false,
    sheetBg: '#090C12',
    mapBg: '#090C12',
    locMapBg: '#0B0F17',
    panelBg: '#0E131D',
    panelHeaderBg: '#E5E7EB',
    panelHeaderText: '#090C12',
    borderOuter: '#FFFFFF',
    borderInner: '#9CA3AF',
    dxfStrokeDefault: '#F9FAFB',
    dxfTextDefault: '#FFFFFF',
    dxfHatchFill: '#E5E7EB',
    gridMajor: 'rgba(255, 255, 255, 0.22)',
    gridMinor: 'rgba(255, 255, 255, 0.08)',
    gridText: '#E5E7EB',
    textPrimary: '#FFFFFF',
    textSecondary: '#D1D5DB',
    textMuted: '#9CA3AF',
    accentPrimary: '#FFFFFF',
    accentSecondary: '#D1D5DB',
    streetRoadFill: '#141923',
    streetSidewalkFill: '#1E2533',
    streetCenterline: '#E5E7EB',
    manzanaFill: 'rgba(255, 255, 255, 0.05)',
    manzanaStroke: '#F3F4F6',
    loteFill: 'rgba(255, 255, 255, 0.02)',
    loteStroke: '#D1D5DB',
    selectedLotFill: 'rgba(255, 255, 255, 0.16)',
    selectedLotStroke: '#FFFFFF',
    perimetroStroke: '#FFFFFF',
  },
  'technical-light': {
    isMonochrome: false,
    isLight: true,
    sheetBg: '#FFFFFF',
    mapBg: '#F8FAFC',
    locMapBg: '#EFF6FF',
    panelBg: '#FFFFFF',
    panelHeaderBg: '#0F172A',
    panelHeaderText: '#FFFFFF',
    borderOuter: '#0F172A',
    borderInner: '#334155',
    dxfStrokeDefault: '#0F172A',
    dxfTextDefault: '#0F172A',
    dxfHatchFill: '#334155',
    gridMajor: 'rgba(30, 64, 175, 0.22)',
    gridMinor: 'rgba(100, 116, 139, 0.12)',
    gridText: '#1E3A8A',
    textPrimary: '#0F172A',
    textSecondary: '#334155',
    textMuted: '#64748B',
    accentPrimary: '#EA580C',
    accentSecondary: '#0284C7',
    streetRoadFill: '#CBD5E1',
    streetSidewalkFill: '#E2E8F0',
    streetCenterline: '#475569',
    manzanaFill: 'rgba(245, 158, 11, 0.14)',
    manzanaStroke: '#D97706',
    loteFill: 'rgba(14, 165, 233, 0.10)',
    loteStroke: '#0369A1',
    selectedLotFill: 'rgba(234, 88, 12, 0.18)',
    selectedLotStroke: '#EA580C',
    perimetroStroke: '#0F172A',
  },
  'urbigeo-dark': {
    isMonochrome: false,
    isLight: false,
    sheetBg: '#0B0F17',
    mapBg: '#0F1623',
    locMapBg: '#131C2E',
    panelBg: '#111827',
    panelHeaderBg: '#1E293B',
    panelHeaderText: '#FFFFFF',
    borderOuter: '#38BDF8',
    borderInner: '#334155',
    dxfStrokeDefault: '#E2E8F0',
    dxfTextDefault: '#F8FAFC',
    dxfHatchFill: '#38BDF8',
    gridMajor: 'rgba(56, 189, 248, 0.22)',
    gridMinor: 'rgba(148, 163, 184, 0.09)',
    gridText: '#38BDF8',
    textPrimary: '#F8FAFC',
    textSecondary: '#CBD5E1',
    textMuted: '#94A3B8',
    accentPrimary: '#FF6B4A',
    accentSecondary: '#2DD4BF',
    streetRoadFill: '#1E293B',
    streetSidewalkFill: '#334155',
    streetCenterline: '#FF6B4A',
    manzanaFill: 'rgba(245, 158, 11, 0.18)',
    manzanaStroke: '#F59E0B',
    loteFill: 'rgba(45, 212, 191, 0.12)',
    loteStroke: '#2DD4BF',
    selectedLotFill: 'rgba(255, 107, 74, 0.26)',
    selectedLotStroke: '#FF6B4A',
    perimetroStroke: '#F8FAFC',
  },
  blueprint: {
    isMonochrome: false,
    isLight: false,
    sheetBg: '#07192F',
    mapBg: '#0A2240',
    locMapBg: '#0D2B52',
    panelBg: '#091E3A',
    panelHeaderBg: '#103460',
    panelHeaderText: '#FFFFFF',
    borderOuter: '#7DD3FC',
    borderInner: '#38BDF8',
    dxfStrokeDefault: '#BAE6FD',
    dxfTextDefault: '#F0F9FF',
    dxfHatchFill: '#38BDF8',
    gridMajor: 'rgba(125, 211, 252, 0.28)',
    gridMinor: 'rgba(125, 211, 252, 0.12)',
    gridText: '#BAE6FD',
    textPrimary: '#F0F9FF',
    textSecondary: '#BAE6FD',
    textMuted: '#7DD3FC',
    accentPrimary: '#FBBF24',
    accentSecondary: '#38BDF8',
    streetRoadFill: '#12355B',
    streetSidewalkFill: '#1B4978',
    streetCenterline: '#FDE047',
    manzanaFill: 'rgba(56, 189, 248, 0.16)',
    manzanaStroke: '#7DD3FC',
    loteFill: 'rgba(255, 255, 255, 0.08)',
    loteStroke: '#E0F2FE',
    selectedLotFill: 'rgba(251, 191, 36, 0.24)',
    selectedLotStroke: '#FBBF24',
    perimetroStroke: '#FDE047',
  },
};
