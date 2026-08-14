import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { LabelStyleConfig } from '../model/labelModel';
import { defaultLabelStyleConfig, resolveEffectiveLabelConfig } from '../model/labelModel';
import type { LabelClass } from '../model/labelClass';
import { formatOrderLabel } from '../model/labelNumbering';
import type { LabelNumberingMode } from '../model/labelNumbering';

export interface ResolvedLabel {
  style: LabelStyleConfig;
  text: string;
  source: 'override' | 'class' | 'none';
  classId?: string;
}

export interface ResolveContext {
  zoom?: number;
  parentCode?: string;
  orderIndex?: number;
  total?: number;
  numberingFallback?: LabelNumberingMode;
}

function zoomAllowed(classObj: LabelClass, zoom: number | undefined): boolean {
  if (zoom == null) return true;
  if (classObj.visibleMinZoom != null && zoom < classObj.visibleMinZoom) return false;
  if (classObj.visibleMaxZoom != null && zoom > classObj.visibleMaxZoom) return false;
  return true;
}

function resolveTextFromClass(
  feature: Feature<Geometry>,
  classObj: LabelClass,
  ctx: ResolveContext
): string {
  const explicit = feature.get('labelText') as string | undefined;
  if (explicit) return explicit;
  if (classObj.numbering && ctx.orderIndex != null) {
    const total = ctx.total ?? ctx.orderIndex + 1;
    return formatOrderLabel(classObj.numbering.mode, ctx.orderIndex, total, ctx.parentCode);
  }
  return '';
}

export function resolveFeatureLabel(
  feature: Feature<Geometry>,
  classObj: LabelClass | undefined,
  ctx: ResolveContext = {}
): ResolvedLabel {
  const override = feature.get('labelConfig') as LabelStyleConfig | undefined;
  if (override) {
    return {
      style: override,
      text: (feature.get('labelText') as string | undefined) ?? '',
      source: 'override',
    };
  }

  if (!classObj || !classObj.enabled) {
    return { style: defaultStyleFor(feature), text: '', source: 'none' };
  }

  if (!zoomAllowed(classObj, ctx.zoom)) {
    return { style: classObj.style, text: '', source: 'class', classId: classObj.id };
  }

  const numberingMode: LabelNumberingMode =
    classObj.numbering?.mode ?? ctx.numberingFallback ?? 'numeric';
  const effective = resolveEffectiveLabelConfig(classObj.style, numberingMode);
  const text = resolveTextFromClass(feature, classObj, { ...ctx, orderIndex: ctx.orderIndex });
  return { style: effective, text, source: 'class', classId: classObj.id };
}

function defaultStyleFor(_feature: Feature<Geometry>): LabelStyleConfig {
  return defaultLabelStyleConfig({ enabled: false });
}

export function resolveEntityLabelFromClass(
  classObj: LabelClass | undefined,
  text: string,
  ctx: ResolveContext = {}
): ResolvedLabel {
  if (!classObj || !classObj.enabled) {
    return { style: defaultEntityStyle(), text: '', source: 'none' };
  }
  if (!zoomAllowed(classObj, ctx.zoom)) {
    return { style: classObj.style, text: '', source: 'class', classId: classObj.id };
  }
  const effective = classObj.numbering
    ? resolveEffectiveLabelConfig(classObj.style, classObj.numbering.mode)
    : classObj.style;
  return { style: effective, text, source: 'class', classId: classObj.id };
}

function defaultEntityStyle(): LabelStyleConfig {
  return defaultLabelStyleConfig({ enabled: false });
}
