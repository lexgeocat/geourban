import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  buildDxfTemplateFromText,
  EMPTY_SHEET_FALLBACK,
  loadPersistedCustomTemplates,
  savePersistedCustomTemplates,
} from '../dxf/builtinTemplates';
import type { LayoutTemplateEntry } from '../model/dxfTemplateModel';
import {
  DEFAULT_CARTO_WIDGETS,
  type ActiveViewportTarget,
  type CadastralFormFields,
  type CanvasEditorTool,
  type CarimboFitMode,
  type CartoWidgetId,
  type CartoWidgetSpec,
  type CustomCarimboField,
  type CustomPaperSize,
  type DxfEntityEdit,
  type LayoutCompositionMode,
  type LayoutConfig,
  type LayoutDisplayOptions,
  type LayoutScopeMode,
  type LayoutThemeId,
  type LotAttributeOverride,
  type PaperOrientation,
  type PaperSizeId,
  type QgisInteractionTool,
  type SelectedCanvasItem,
  type SheetAnnotationEntity,
  type SheetAnnotationKind,
  type ViewportBoxNormalized,
  type ViewportFocusTarget,
} from '../model/layoutTypes';
import type { LotCatalogItem } from '../extractors/cartographyExtractor';

function cloneDefaultWidgets(): Record<CartoWidgetId, CartoWidgetSpec> {
  return {
    northArrow: { ...DEFAULT_CARTO_WIDGETS.northArrow },
    locationNorthArrow: { ...DEFAULT_CARTO_WIDGETS.locationNorthArrow },
    numericScale: { ...DEFAULT_CARTO_WIDGETS.numericScale },
    graphicScale: { ...DEFAULT_CARTO_WIDGETS.graphicScale },
    locationGraphicScale: { ...DEFAULT_CARTO_WIDGETS.locationGraphicScale },
    coordTable: { ...DEFAULT_CARTO_WIDGETS.coordTable },
    extraDataBox: { ...DEFAULT_CARTO_WIDGETS.extraDataBox },
  };
}

function emptyCadastralFields(): CadastralFormFields {
  return {
    municipalityHeader: '',
    jurisdictionSubtitle: '',
    planTitle: '',
    ownerName: '',
    sellerOrProcess: '',
    locationAddress: '',
    district: '',
    zone: '',
    urbanizationName: '',
    manzanoCode: '',
    lotCode: '',
    surfaceTestimonioM2: '',
    surfaceLevantamientoM2: '',
    surfaceUtilM2: '',
    surfaceConstruidaM2: '',
    frontM: '',
    depthM: '',
    landUse: '',
    ddrrMatricula: '',
    catastralCode: '',
    architectName: '',
    professionalRegistry: '',
    projectDate: '',
    sheetCode: '',
    revision: '',
  };
}

const WIDGET_TO_DISPLAY_KEY: Partial<Record<CartoWidgetId, keyof LayoutDisplayOptions>> = {
  northArrow: 'showNorthArrow',
  locationNorthArrow: 'showLocationNorthArrow',
  numericScale: 'showScaleTextBadge',
  graphicScale: 'showGraphicScaleBar',
  locationGraphicScale: 'showLocationScaleBar',
  coordTable: 'showVertexTable',
  extraDataBox: 'showExtraDataBox',
};

const DISPLAY_TO_WIDGET_ID: Partial<Record<keyof LayoutDisplayOptions, CartoWidgetId>> = {
  showNorthArrow: 'northArrow',
  showLocationNorthArrow: 'locationNorthArrow',
  showScaleTextBadge: 'numericScale',
  showGraphicScaleBar: 'graphicScale',
  showLocationScaleBar: 'locationGraphicScale',
  showVertexTable: 'coordTable',
  showExtraDataBox: 'extraDataBox',
};

const MAX_HISTORY = 60;

function pushConfigSnapshot(state: {
  config: LayoutConfig;
  undoStack: LayoutConfig[];
  redoStack: LayoutConfig[];
}): void {
  const snap = JSON.parse(JSON.stringify(state.config)) as LayoutConfig;
  state.undoStack.push(snap);
  if (state.undoStack.length > MAX_HISTORY) {
    state.undoStack.shift();
  }
  state.redoStack = [];
}

interface LayoutStoreState {
  templates: LayoutTemplateEntry[];
  activeTemplateId: string;
  config: LayoutConfig;
  undoStack: LayoutConfig[];
  redoStack: LayoutConfig[];
  canvasTool: CanvasEditorTool;
  qgisTool: QgisInteractionTool;
  activeViewport: ActiveViewportTarget;
  selectedItem: SelectedCanvasItem;
  viewportFocusTarget: ViewportFocusTarget;
  viewportFocusNonce: number;
  previewZoom: number;
  sheetPanPx: [number, number];

  pushHistorySnapshot: () => void;
  undoLayout: () => void;
  redoLayout: () => void;

  selectTemplate: (id: string) => void;
  importCustomDxf: (fileName: string, rawDxfText: string) => LayoutTemplateEntry;
  saveActiveTemplateToLibrary: (customName?: string, asNew?: boolean) => LayoutTemplateEntry | null;
  removeCustomTemplate: (id: string) => void;

  setPaperSize: (size: PaperSizeId) => void;
  setOrientation: (orientation: PaperOrientation) => void;
  setCustomPaper: (patch: Partial<CustomPaperSize>) => void;
  setMarginMm: (mm: number) => void;
  setCarimboFitMode: (mode: CarimboFitMode) => void;
  setCarimboScalePercent: (pct: number) => void;
  setTheme: (theme: LayoutThemeId) => void;

  setCompositionMode: (mode: LayoutCompositionMode) => void;
  setScopeMode: (scope: LayoutScopeMode) => void;
  setDataDrivenEnabled: (enabled: boolean) => void;
  setSelectedLotId: (lotId: string | null) => void;

  setCanvasTool: (tool: CanvasEditorTool) => void;
  setQgisTool: (tool: QgisInteractionTool) => void;
  setActiveViewport: (target: ActiveViewportTarget) => void;
  setSelectedItem: (item: SelectedCanvasItem) => void;
  setViewportFocusTarget: (target: ViewportFocusTarget) => void;
  setPreviewZoom: (zoom: number) => void;
  setSheetPanPx: (pan: [number, number]) => void;
  panSheetPx: (dx: number, dy: number) => void;
  resetSheetView: () => void;

  setMainScale: (mode: 'auto' | 'preset' | 'manual', denominator?: number) => void;
  setLocationScale: (mode: 'auto' | 'preset' | 'manual', denominator?: number) => void;
  zoomViewportScale: (target: ActiveViewportTarget, currentEffectiveScale: number, factor: number) => void;

  updateViewportBox: (target: ActiveViewportTarget, box: ViewportBoxNormalized) => void;
  panViewport: (target: ActiveViewportTarget, dxMeters: number, dyMeters: number) => void;
  resetViewportPan: (target?: ActiveViewportTarget) => void;
  resetViewportsToTemplate: () => void;

  updateWidgetSpec: (id: CartoWidgetId, patch: Partial<CartoWidgetSpec>) => void;
  resetWidgetsLayout: () => void;

  updateDxfEntityEdit: (entityId: string, patch: Partial<DxfEntityEdit>) => void;
  restoreAllDxfEntities: () => void;
  deleteSelectedCanvasItem: () => void;

  addSheetAnnotation: (kind: SheetAnnotationKind, x: number, y: number, w: number, h: number, text?: string) => string;
  updateSheetAnnotation: (id: string, patch: Partial<SheetAnnotationEntity>) => void;
  removeSheetAnnotation: (id: string) => void;

  setCadastralField: <K extends keyof CadastralFormFields>(key: K, value: CadastralFormFields[K]) => void;
  clearAllCadastralFields: () => void;
  fillCadastralFromSelectedLot: (lot: LotCatalogItem | null) => void;

  setLotAttributeOverride: <K extends keyof LotAttributeOverride>(
    lotId: string,
    key: K,
    value: string
  ) => void;
  clearLotAttributeOverrides: (lotId: string) => void;

  addCustomField: (label: string, value: string, placement?: 'carimbo' | 'viewport') => void;
  updateCustomField: (id: string, patch: Partial<CustomCarimboField>) => void;
  removeCustomField: (id: string) => void;

  setDxfTextOverride: (entityId: string, text: string) => void;
  clearDxfTextOverride: (entityId: string) => void;
  resetDxfTextOverrides: () => void;

  setDisplayOption: <K extends keyof LayoutDisplayOptions>(key: K, value: LayoutDisplayOptions[K]) => void;
}

const initialTemplates: LayoutTemplateEntry[] = loadPersistedCustomTemplates();
const defaultTemplate = initialTemplates[0] ?? EMPTY_SHEET_FALLBACK;

export const useLayoutStore = create<LayoutStoreState>()(
  immer((set, get) => ({
    templates: initialTemplates,
    activeTemplateId: initialTemplates[0]?.id ?? '',
    undoStack: [],
    redoStack: [],
    canvasTool: 'edit-elements',
    qgisTool: 'pan-content',
    activeViewport: 'main',
    selectedItem: null,
    viewportFocusTarget: 'sheet',
    viewportFocusNonce: 0,
    previewZoom: 1,
    sheetPanPx: [0, 0],

    pushHistorySnapshot: () =>
      set((state) => {
        pushConfigSnapshot(state);
      }),

    undoLayout: () =>
      set((state) => {
        const prev = state.undoStack.pop();
        if (!prev) return;
        const currentSnap = JSON.parse(JSON.stringify(state.config)) as LayoutConfig;
        state.redoStack.push(currentSnap);
        if (state.redoStack.length > MAX_HISTORY) {
          state.redoStack.shift();
        }
        state.config = prev;
        state.selectedItem = null;
      }),

    redoLayout: () =>
      set((state) => {
        const next = state.redoStack.pop();
        if (!next) return;
        const currentSnap = JSON.parse(JSON.stringify(state.config)) as LayoutConfig;
        state.undoStack.push(currentSnap);
        if (state.undoStack.length > MAX_HISTORY) {
          state.undoStack.shift();
        }
        state.config = next;
        state.selectedItem = null;
      }),

    config: {
      paperSize: 'A3',
      orientation: 'landscape',
      customPaper: {
        widthMm: 330.2,
        heightMm: 215.9,
        unit: 'mm',
      },
      marginMm: 8,
      carimboFitMode: 'adapt-sheet',
      carimboScalePercent: 100,
      theme: 'monochrome-cad-white',
      compositionMode: 'qgis-viewport',
      scopeMode: 'lot',
      dataDrivenEnabled: true,
      selectedLotId: null,
      mainViewport: {
        boxNormalized: { ...defaultTemplate.defaultMainBox },
        scaleMode: 'preset',
        scaleDenominator: 200,
        panOffsetMetric: [0, 0],
      },
      locationViewport: {
        boxNormalized: { ...defaultTemplate.defaultLocationBox },
        scaleMode: 'preset',
        scaleDenominator: 1000,
        panOffsetMetric: [0, 0],
      },
      cadastral: emptyCadastralFields(),
      customFields: [],
      dxfTextOverrides: {},
      dxfEntityEdits: {},
      sheetAnnotations: [],
      widgets: cloneDefaultWidgets(),
      lotAttributeOverrides: {},
      display: {
        showNorthArrow: true,
        showLocationNorthArrow: true,
        showScaleTextBadge: true,
        showGraphicScaleBar: true,
        showLocationScaleBar: true,
        showGrid: true,
        gridIntervalMode: 'auto',
        gridIntervalMeters: 10,
        showVertexTable: true,
        showVertexMarkers: true,
        showExtraDataBox: true,
        showLotLabels: true,
        showLotDimensions: true,
        showStreetNames: true,
        showNeighbors: true,
        showLocationOsmTiles: false,
      },
    },

    selectTemplate: (id) =>
      set((state) => {
        const tpl = state.templates.find((t) => t.id === id);
        if (!tpl) return;
        state.activeTemplateId = tpl.id;
        state.selectedItem = null;
        state.config.mainViewport.boxNormalized = { ...tpl.defaultMainBox };
        state.config.locationViewport.boxNormalized = { ...tpl.defaultLocationBox };
        state.config.mainViewport.panOffsetMetric = [0, 0];
        state.config.locationViewport.panOffsetMetric = [0, 0];
        state.config.dxfTextOverrides = {};
        state.config.dxfEntityEdits = tpl.savedDxfEntityEdits ? { ...tpl.savedDxfEntityEdits } : {};
        state.config.sheetAnnotations = tpl.savedAnnotations ? tpl.savedAnnotations.map((a) => ({ ...a })) : [];
        if (tpl.savedWidgets) {
          const base = cloneDefaultWidgets();
          for (const k of Object.keys(tpl.savedWidgets) as CartoWidgetId[]) {
            const w = tpl.savedWidgets[k];
            if (w) {
              base[k] = { ...w };
              const dKey = WIDGET_TO_DISPLAY_KEY[k];
              if (dKey) {
                (state.config.display as Record<string, unknown>)[dKey] = w.visible;
              }
            }
          }
          state.config.widgets = base;
        }
      }),

    importCustomDxf: (fileName, rawDxfText) => {
      const cleanName = fileName.replace(/\.dxf$/i, '').trim() || 'Carimbo Propio';
      const id = `dxf-custom-${Date.now()}`;
      const tpl = buildDxfTemplateFromText(
        id,
        cleanName,
        `Plantilla .DXF guardada (${fileName})`,
        rawDxfText,
        'dxf-custom',
        true
      );
      set((state) => {
        state.templates.push(tpl);
        state.activeTemplateId = tpl.id;
        state.selectedItem = null;
        state.config.mainViewport.boxNormalized = { ...tpl.defaultMainBox };
        state.config.locationViewport.boxNormalized = { ...tpl.defaultLocationBox };
        state.config.mainViewport.panOffsetMetric = [0, 0];
        state.config.locationViewport.panOffsetMetric = [0, 0];
        state.config.dxfTextOverrides = {};
        state.config.dxfEntityEdits = {};
        state.config.sheetAnnotations = [];
      });
      savePersistedCustomTemplates(get().templates);
      return tpl;
    },

    saveActiveTemplateToLibrary: (customName, asNew = false) => {
      let savedEntry: LayoutTemplateEntry | null = null;
      set((state) => {
        const foundCur = state.templates.find((t) => t.id === state.activeTemplateId);
        const cur = foundCur ?? EMPTY_SHEET_FALLBACK;

        const isExistingUserTpl =
          Boolean(foundCur) && !asNew && (cur.kind === 'dxf-custom' || cur.saved === true);
        const clonedWidgets: Partial<Record<CartoWidgetId, CartoWidgetSpec>> = {};
        for (const k of Object.keys(state.config.widgets) as CartoWidgetId[]) {
          clonedWidgets[k] = { ...state.config.widgets[k] };
        }
        const clonedEdits: Record<string, DxfEntityEdit> = {};
        for (const [k, v] of Object.entries(state.config.dxfEntityEdits)) {
          clonedEdits[k] = { ...v };
        }
        const clonedAnnotations = state.config.sheetAnnotations.map((a) => ({ ...a }));

        if (isExistingUserTpl && foundCur) {
          if (customName && customName.trim()) foundCur.name = customName.trim();
          foundCur.defaultMainBox = { ...state.config.mainViewport.boxNormalized };
          foundCur.defaultLocationBox = { ...state.config.locationViewport.boxNormalized };
          foundCur.savedDxfEntityEdits = clonedEdits;
          foundCur.savedAnnotations = clonedAnnotations;
          foundCur.savedWidgets = clonedWidgets;
          foundCur.saved = true;
          savedEntry = foundCur;
        } else {
          const newId = `${cur.rawDxfText ? 'dxf-custom' : 'tpl-custom'}-${Date.now()}`;
          const name =
            (customName && customName.trim()) ||
            (foundCur ? `${cur.name.replace(/\s*\(.*?\)\s*/g, '').trim()}` : 'Mi Plantilla');
          const created: LayoutTemplateEntry = {
            ...cur,
            id: newId,
            name,
            description: 'Plantilla personalizada guardada.',
            kind: cur.rawDxfText ? 'dxf-custom' : 'iso-procedural',
            defaultMainBox: { ...state.config.mainViewport.boxNormalized },
            defaultLocationBox: { ...state.config.locationViewport.boxNormalized },
            savedDxfEntityEdits: clonedEdits,
            savedAnnotations: clonedAnnotations,
            savedWidgets: clonedWidgets,
            saved: true,
          };
          state.templates.push(created);
          state.activeTemplateId = created.id;
          savedEntry = created;
        }
      });
      savePersistedCustomTemplates(get().templates);
      return savedEntry;
    },

    removeCustomTemplate: (id) => {
      set((state) => {
        const idx = state.templates.findIndex((t) => t.id === id && (t.kind === 'dxf-custom' || t.saved));
        if (idx === -1) return;
        state.templates.splice(idx, 1);
        if (state.activeTemplateId === id) {
          const fallback = state.templates[0];
          if (fallback) {
            state.activeTemplateId = fallback.id;
            state.config.mainViewport.boxNormalized = { ...fallback.defaultMainBox };
            state.config.locationViewport.boxNormalized = { ...fallback.defaultLocationBox };
            state.config.dxfTextOverrides = {};
            state.config.dxfEntityEdits = fallback.savedDxfEntityEdits ? { ...fallback.savedDxfEntityEdits } : {};
            state.config.sheetAnnotations = fallback.savedAnnotations
              ? fallback.savedAnnotations.map((a) => ({ ...a }))
              : [];
          } else {
            state.activeTemplateId = '';
            state.config.mainViewport.boxNormalized = { ...EMPTY_SHEET_FALLBACK.defaultMainBox };
            state.config.locationViewport.boxNormalized = { ...EMPTY_SHEET_FALLBACK.defaultLocationBox };
            state.config.dxfTextOverrides = {};
            state.config.dxfEntityEdits = {};
            state.config.sheetAnnotations = [];
          }
        }
      });
      savePersistedCustomTemplates(get().templates);
    },

    setPaperSize: (size) =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.paperSize = size;
      }),

    setOrientation: (orientation) =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.orientation = orientation;
        if (state.config.paperSize === 'CUSTOM') {
          const w = state.config.customPaper.widthMm;
          const h = state.config.customPaper.heightMm;
          if ((orientation === 'portrait' && w > h) || (orientation === 'landscape' && h > w)) {
            state.config.customPaper.widthMm = h;
            state.config.customPaper.heightMm = w;
          }
        }
      }),

    setCustomPaper: (patch) =>
      set((state) => {
        state.config.paperSize = 'CUSTOM';
        state.config.customPaper = {
          ...state.config.customPaper,
          ...patch,
        };
        state.config.orientation =
          state.config.customPaper.widthMm >= state.config.customPaper.heightMm
            ? 'landscape'
            : 'portrait';
      }),

    setMarginMm: (mm) =>
      set((state) => {
        state.config.marginMm = Math.max(2, Math.min(35, Math.round(mm)));
      }),

    setCarimboFitMode: (mode) =>
      set((state) => {
        state.config.carimboFitMode = mode;
      }),

    setCarimboScalePercent: (pct) =>
      set((state) => {
        state.config.carimboScalePercent = Math.max(60, Math.min(140, Math.round(pct)));
      }),

    setTheme: (theme) =>
      set((state) => {
        state.config.theme = theme;
      }),

    setCompositionMode: (mode) =>
      set((state) => {
        state.config.compositionMode = mode;
        if (mode === 'direct' && state.canvasTool === 'edit-viewport-box') {
          state.canvasTool = 'edit-elements';
        }
      }),

    setScopeMode: (scope) =>
      set((state) => {
        state.config.scopeMode = scope;
        state.config.mainViewport.panOffsetMetric = [0, 0];
        state.config.locationViewport.panOffsetMetric = [0, 0];
        if (scope === 'lot') {
          state.config.mainViewport.scaleMode = 'preset';
          state.config.mainViewport.scaleDenominator = 200;
          state.config.locationViewport.scaleMode = 'preset';
          state.config.locationViewport.scaleDenominator = 1000;
        } else {
          state.config.mainViewport.scaleMode = 'auto';
          state.config.locationViewport.scaleMode = 'preset';
          state.config.locationViewport.scaleDenominator = 5000;
        }
      }),

    setDataDrivenEnabled: (enabled) =>
      set((state) => {
        state.config.dataDrivenEnabled = enabled;
      }),

    setSelectedLotId: (lotId) =>
      set((state) => {
        state.config.selectedLotId = lotId;
        state.config.mainViewport.panOffsetMetric = [0, 0];
        state.config.locationViewport.panOffsetMetric = [0, 0];
      }),

    setCanvasTool: (tool) =>
      set((state) => {
        state.canvasTool = tool;
        if (tool === 'edit-viewport-box') {
          state.config.compositionMode = 'qgis-viewport';
          state.qgisTool = 'edit-viewport-box';
        } else if (tool === 'pan-content') {
          state.qgisTool = 'pan-content';
        }
      }),

    setQgisTool: (tool) =>
      set((state) => {
        state.qgisTool = tool;
        state.canvasTool = tool;
      }),

    setActiveViewport: (target) =>
      set((state) => {
        state.activeViewport = target;
      }),

    setSelectedItem: (item) =>
      set((state) => {
        state.selectedItem = item;
      }),

    setViewportFocusTarget: (target) =>
      set((state) => {
        state.viewportFocusTarget = target;
        state.viewportFocusNonce += 1;
        state.sheetPanPx = [0, 0];
        if (target === 'main' || target === 'location') {
          state.activeViewport = target;
        }
        state.previewZoom =
          target === 'sheet' ? 1 : target === 'main' ? 1.35 : target === 'location' ? 2.4 : 2.2;
      }),

    setPreviewZoom: (zoom) =>
      set((state) => {
        state.previewZoom = Math.max(0.4, Math.min(4.0, +zoom.toFixed(2)));
      }),

    setSheetPanPx: (pan) =>
      set((state) => {
        state.sheetPanPx = pan;
      }),

    panSheetPx: (dx, dy) =>
      set((state) => {
        state.sheetPanPx = [state.sheetPanPx[0] + dx, state.sheetPanPx[1] + dy];
      }),

    resetSheetView: () =>
      set((state) => {
        state.viewportFocusTarget = 'sheet';
        state.previewZoom = 1;
        state.sheetPanPx = [0, 0];
      }),

    setMainScale: (mode, denominator) =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.mainViewport.scaleMode = mode;
        if (denominator != null && Number.isFinite(denominator) && denominator >= 10) {
          state.config.mainViewport.scaleDenominator = Math.round(denominator);
        }
      }),

    setLocationScale: (mode, denominator) =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.locationViewport.scaleMode = mode;
        if (denominator != null && Number.isFinite(denominator) && denominator >= 50) {
          state.config.locationViewport.scaleDenominator = Math.round(denominator);
        }
      }),

    zoomViewportScale: (target, currentEffectiveScale, factor) =>
      set((state) => {
        pushConfigSnapshot(state);
        if (target === 'main') {
          const next = Math.max(20, Math.round((currentEffectiveScale * factor) / 10) * 10);
          state.config.mainViewport.scaleMode = 'manual';
          state.config.mainViewport.scaleDenominator = next;
        } else {
          const next = Math.max(50, Math.round((currentEffectiveScale * factor) / 50) * 50);
          state.config.locationViewport.scaleMode = 'manual';
          state.config.locationViewport.scaleDenominator = next;
        }
      }),

    updateViewportBox: (target, box) =>
      set((state) => {
        const clamped: ViewportBoxNormalized = {
          x: Math.max(0, Math.min(0.92, box.x)),
          y: Math.max(0, Math.min(0.92, box.y)),
          w: Math.max(0.08, Math.min(1 - Math.max(0, box.x), box.w)),
          h: Math.max(0.08, Math.min(1 - Math.max(0, box.y), box.h)),
        };
        if (target === 'main') state.config.mainViewport.boxNormalized = clamped;
        else state.config.locationViewport.boxNormalized = clamped;
      }),

    panViewport: (target, dxMeters, dyMeters) =>
      set((state) => {
        const vp = target === 'main' ? state.config.mainViewport : state.config.locationViewport;
        vp.panOffsetMetric = [vp.panOffsetMetric[0] + dxMeters, vp.panOffsetMetric[1] + dyMeters];
      }),

    resetViewportPan: (target) =>
      set((state) => {
        if (!target || target === 'main') state.config.mainViewport.panOffsetMetric = [0, 0];
        if (!target || target === 'location') state.config.locationViewport.panOffsetMetric = [0, 0];
      }),

    resetViewportsToTemplate: () =>
      set((state) => {
        pushConfigSnapshot(state);
        const tpl = state.templates.find((t) => t.id === state.activeTemplateId) ?? EMPTY_SHEET_FALLBACK;
        state.config.mainViewport.boxNormalized = { ...tpl.defaultMainBox };
        state.config.locationViewport.boxNormalized = { ...tpl.defaultLocationBox };
        state.config.mainViewport.panOffsetMetric = [0, 0];
        state.config.locationViewport.panOffsetMetric = [0, 0];
      }),

    updateWidgetSpec: (id, patch) =>
      set((state) => {
        const w = state.config.widgets[id];
        if (!w) return;
        Object.assign(w, patch);
        if (patch.xNorm !== undefined) w.xNorm = Math.max(0, Math.min(1, patch.xNorm));
        if (patch.yNorm !== undefined) w.yNorm = Math.max(0, Math.min(1, patch.yNorm));
        if (patch.scale !== undefined) w.scale = Math.max(0.4, Math.min(2.6, +patch.scale.toFixed(2)));
        if (patch.visible !== undefined) {
          const dKey = WIDGET_TO_DISPLAY_KEY[id];
          if (dKey) {
            (state.config.display as Record<string, unknown>)[dKey] = patch.visible;
          }
        }
      }),

    resetWidgetsLayout: () =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.widgets = cloneDefaultWidgets();
        state.config.display.showNorthArrow = true;
        state.config.display.showLocationNorthArrow = true;
        state.config.display.showScaleTextBadge = true;
        state.config.display.showGraphicScaleBar = true;
        state.config.display.showLocationScaleBar = true;
        state.config.display.showVertexTable = true;
        state.config.display.showExtraDataBox = true;
      }),

    updateDxfEntityEdit: (entityId, patch) =>
      set((state) => {
        const cur = state.config.dxfEntityEdits[entityId] ?? {};
        state.config.dxfEntityEdits[entityId] = { ...cur, ...patch };
      }),

    restoreAllDxfEntities: () =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.dxfEntityEdits = {};
      }),

    deleteSelectedCanvasItem: () =>
      set((state) => {
        const sel = state.selectedItem;
        if (!sel) return;
        pushConfigSnapshot(state);
        if (sel.kind === 'dxf') {
          const cur = state.config.dxfEntityEdits[sel.id] ?? {};
          state.config.dxfEntityEdits[sel.id] = { ...cur, deleted: true };
        } else if (sel.kind === 'annotation') {
          state.config.sheetAnnotations = state.config.sheetAnnotations.filter((a) => a.id !== sel.id);
        } else if (sel.kind === 'widget') {
          state.config.widgets[sel.id].visible = false;
          const dKey = WIDGET_TO_DISPLAY_KEY[sel.id];
          if (dKey) {
            (state.config.display as Record<string, unknown>)[dKey] = false;
          }
        }
        state.selectedItem = null;
      }),

    addSheetAnnotation: (kind, x, y, w, h, text) => {
      const id = `ann-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      set((state) => {
        pushConfigSnapshot(state);
        state.config.sheetAnnotations.push({
          id,
          kind,
          x: Math.max(0, Math.min(0.95, x)),
          y: Math.max(0, Math.min(0.95, y)),
          w,
          h,
          text: kind === 'text' ? text || 'TEXTO' : undefined,
          fontSizePt: kind === 'text' ? 14 : undefined,
          fontFamily: kind === 'text' ? 'cad' : undefined,
          bold: kind === 'text' ? true : undefined,
          italic: kind === 'text' ? false : undefined,
          underline: kind === 'text' ? false : undefined,
          lineWidth: kind === 'text' ? undefined : 1.6,
          lineStyle: kind === 'text' ? undefined : 'solid',
          dashed: false,
          doubleBorder: false,
          fillOpaque: false,
        });
        state.selectedItem = { kind: 'annotation', id };
        state.canvasTool = 'edit-elements';
      });
      return id;
    },

    updateSheetAnnotation: (id, patch) =>
      set((state) => {
        const ann = state.config.sheetAnnotations.find((a) => a.id === id);
        if (ann) Object.assign(ann, patch);
      }),

    removeSheetAnnotation: (id) =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.sheetAnnotations = state.config.sheetAnnotations.filter((a) => a.id !== id);
        if (state.selectedItem?.kind === 'annotation' && state.selectedItem.id === id) {
          state.selectedItem = null;
        }
      }),

    setCadastralField: (key, value) =>
      set((state) => {
        state.config.cadastral[key] = value;
      }),

    clearAllCadastralFields: () =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.cadastral = emptyCadastralFields();
        state.config.customFields = [];
        state.config.dxfTextOverrides = {};
      }),

    fillCadastralFromSelectedLot: (lot) =>
      set((state) => {
        if (!lot) return;
        pushConfigSnapshot(state);
        const fa = lot.featureAttributes;
        state.config.cadastral.planTitle = 'PLANO DE LOTE';
        state.config.cadastral.manzanoCode = lot.manzanoCode;
        state.config.cadastral.lotCode = lot.code;
        state.config.cadastral.surfaceLevantamientoM2 = `${lot.areaM2.toFixed(2)} m²`;
        state.config.cadastral.surfaceUtilM2 = `${lot.areaM2.toFixed(2)} m²`;
        state.config.cadastral.frontM = `${lot.frontM.toFixed(2)} m`;
        state.config.cadastral.depthM = `${lot.depthM.toFixed(2)} m`;
        state.config.cadastral.locationAddress = fa.locationAddress || fa.direccion || lot.frontStreetName;
        if (fa.ownerName || fa.propietario) {
          state.config.cadastral.ownerName = fa.ownerName || fa.propietario;
        }
        if (fa.surfaceConstruidaM2 || fa.supConstruida) {
          state.config.cadastral.surfaceConstruidaM2 = fa.surfaceConstruidaM2 || fa.supConstruida;
        }
      }),

    setLotAttributeOverride: (lotId, key, value) =>
      set((state) => {
        if (!state.config.lotAttributeOverrides[lotId]) {
          state.config.lotAttributeOverrides[lotId] = {};
        }
        state.config.lotAttributeOverrides[lotId][key] = value;
      }),

    clearLotAttributeOverrides: (lotId) =>
      set((state) => {
        delete state.config.lotAttributeOverrides[lotId];
      }),

    addCustomField: (label, value, placement = 'carimbo') =>
      set((state) => {
        pushConfigSnapshot(state);
        const id = `cf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        state.config.customFields.push({
          id,
          label: label.trim() || 'Dato Extra',
          value,
          visible: true,
          placement,
        });
        state.config.display.showExtraDataBox = true;
        state.config.widgets.extraDataBox.visible = true;
      }),

    updateCustomField: (id, patch) =>
      set((state) => {
        const item = state.config.customFields.find((f) => f.id === id);
        if (item) Object.assign(item, patch);
      }),

    removeCustomField: (id) =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.customFields = state.config.customFields.filter((f) => f.id !== id);
      }),

    setDxfTextOverride: (entityId, text) =>
      set((state) => {
        state.config.dxfTextOverrides[entityId] = text;
        const cur = state.config.dxfEntityEdits[entityId] ?? {};
        state.config.dxfEntityEdits[entityId] = { ...cur, text };
      }),

    clearDxfTextOverride: (entityId) =>
      set((state) => {
        pushConfigSnapshot(state);
        delete state.config.dxfTextOverrides[entityId];
        if (state.config.dxfEntityEdits[entityId]) {
          delete state.config.dxfEntityEdits[entityId].text;
        }
      }),

    resetDxfTextOverrides: () =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.dxfTextOverrides = {};
        for (const edit of Object.values(state.config.dxfEntityEdits)) {
          delete edit.text;
        }
      }),

    setDisplayOption: (key, value) =>
      set((state) => {
        pushConfigSnapshot(state);
        state.config.display[key] = value;
        const wId = DISPLAY_TO_WIDGET_ID[key];
        if (wId && typeof value === 'boolean') {
          state.config.widgets[wId].visible = value;
        }
      }),
  }))
);
