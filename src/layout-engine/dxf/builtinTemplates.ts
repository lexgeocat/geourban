import type { DxfTemplateDoc, LayoutTemplateEntry } from '../model/dxfTemplateModel';
import type {
  CartoWidgetId,
  CartoWidgetSpec,
  DxfEntityEdit,
  SheetAnnotationEntity,
  ViewportBoxNormalized,
} from '../model/layoutTypes';
import { parseDxfString } from './dxfParser';
import { detectDxfTemplateViewports } from './dxfViewportDetector';

const STORAGE_KEY_SAVED_TEMPLATES = 'urbigeo_saved_layout_templates_v2';

export const EMPTY_SHEET_FALLBACK: LayoutTemplateEntry = {
  id: '__empty-sheet__',
  name: 'Hoja Vacía',
  description: 'Lienzo vacío sin plantilla preestablecida',
  kind: 'iso-procedural',
  isBlankSheet: true,
  defaultMainBox: { x: 0.02, y: 0.02, w: 0.71, h: 0.96 },
  defaultLocationBox: { x: 0.75, y: 0.02, w: 0.23, h: 0.34 },
};

interface SerializedCustomTemplate {
  id: string;
  name: string;
  description: string;
  kind: 'dxf-custom' | 'iso-procedural';
  isBlankSheet?: boolean;
  isoPreset?: 'catastral-lateral' | 'banda-inferior';
  rawDxfText?: string;
  defaultMainBox: ViewportBoxNormalized;
  defaultLocationBox: ViewportBoxNormalized;
  savedDxfEntityEdits?: Record<string, DxfEntityEdit>;
  savedAnnotations?: SheetAnnotationEntity[];
  savedWidgets?: Partial<Record<CartoWidgetId, CartoWidgetSpec>>;
}

export function buildDxfTemplateFromText(
  id: string,
  name: string,
  description: string,
  dxfText: string,
  kind: 'dxf-builtin' | 'dxf-custom',
  saved?: boolean
): LayoutTemplateEntry {
  const parsed = parseDxfString(dxfText);
  const detected = detectDxfTemplateViewports(parsed);
  const dxfDoc: DxfTemplateDoc = {
    bbox: detected.frameBBox,
    entities: parsed.entities,
    layerColors: parsed.layerColors,
    detected,
  };

  return {
    id,
    name,
    description,
    kind,
    rawDxfText: dxfText,
    dxfDoc,
    defaultMainBox: detected.mainViewportBox,
    defaultLocationBox: detected.locationViewportBox,
    saved: saved ?? kind === 'dxf-custom',
  };
}

export function loadPersistedCustomTemplates(): LayoutTemplateEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SAVED_TEMPLATES);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SerializedCustomTemplate[];
    if (!Array.isArray(parsed)) return [];
    const restored: LayoutTemplateEntry[] = [];

    for (const item of parsed) {
      if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
      if (item.rawDxfText) {
        const entry = buildDxfTemplateFromText(
          item.id,
          item.name,
          item.description || 'Plantilla DXF guardada',
          item.rawDxfText,
          'dxf-custom',
          true
        );
        entry.defaultMainBox = item.defaultMainBox || entry.defaultMainBox;
        entry.defaultLocationBox = item.defaultLocationBox || entry.defaultLocationBox;
        entry.savedDxfEntityEdits = item.savedDxfEntityEdits;
        entry.savedAnnotations = item.savedAnnotations;
        entry.savedWidgets = item.savedWidgets;
        restored.push(entry);
      } else {
        restored.push({
          id: item.id,
          name: item.name,
          description: item.description || 'Plantilla CAD guardada',
          kind: 'iso-procedural',
          isBlankSheet: item.isBlankSheet ?? true,
          isoPreset: item.isoPreset,
          defaultMainBox: item.defaultMainBox,
          defaultLocationBox: item.defaultLocationBox,
          savedDxfEntityEdits: item.savedDxfEntityEdits,
          savedAnnotations: item.savedAnnotations,
          savedWidgets: item.savedWidgets,
          saved: true,
        });
      }
    }
    return restored;
  } catch {
    return [];
  }
}

export function savePersistedCustomTemplates(templates: LayoutTemplateEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const toPersist: SerializedCustomTemplate[] = templates
      .filter((t) => t.kind === 'dxf-custom' || t.saved === true)
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        kind: t.kind === 'dxf-custom' ? 'dxf-custom' : 'iso-procedural',
        isBlankSheet: t.isBlankSheet,
        isoPreset: t.isoPreset,
        rawDxfText: t.rawDxfText,
        defaultMainBox: t.defaultMainBox,
        defaultLocationBox: t.defaultLocationBox,
        savedDxfEntityEdits: t.savedDxfEntityEdits,
        savedAnnotations: t.savedAnnotations,
        savedWidgets: t.savedWidgets,
      }));
    window.localStorage.setItem(STORAGE_KEY_SAVED_TEMPLATES, JSON.stringify(toPersist));
  } catch {
    // Ignorar error de cuota en localStorage
  }
}

export function getBuiltinTemplates(): LayoutTemplateEntry[] {
  return [];
}
