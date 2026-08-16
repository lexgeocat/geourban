import type { GeoUrbanFeatureKind } from '@kernel/domain-model/featureModel';
import type { LabelNumberingMode } from './labelNumbering';

export type AreaUnit = 'm2' | 'ha' | 'km2';

export interface LabelStyleConfig {
  enabled: boolean;
  prefix: string;
  showPrefix: boolean;
  unit: AreaUnit;
  showPrimaryMetric: boolean;
  showSecondaryMetric: boolean;
  showArea?: boolean;
  showPerimeter?: boolean;
  showEdgeCotas: boolean;
  labelFontSizePx: number;
  cotaFontSizePx: number;
  color: string;
  useLayerColor?: boolean;
  fontFamily: string;
  bold: boolean;
  cotaStyle: 'lines' | 'text';
  cotaPosition: 'external' | 'internal';
  titleBadge: 'none' | 'circle';
  visibleMinZoom?: number;
  visibleMaxZoom?: number;
  priority?: number;
}

export function normalizeLabelStyleConfig(cfg: LabelStyleConfig | undefined): LabelStyleConfig {
  if (!cfg) return defaultLabelStyleConfig();
  const showPrimary = cfg.showPrimaryMetric ?? cfg.showArea ?? false;
  const showSecondary = cfg.showSecondaryMetric ?? cfg.showPerimeter ?? false;
  return { ...cfg, showPrimaryMetric: showPrimary, showSecondaryMetric: showSecondary };
}

export interface LabelFontOption {
  value: string;
  label: string;
  group: (typeof LABEL_FONT_GROUPS)[number];
}

export const LABEL_FONT_GROUPS = [
  'Monoespaciadas (CAD)',
  'Técnicas / Ingeniería',
  'Sans profesionales',
] as const;

export const LABEL_FONT_OPTIONS: LabelFontOption[] = [
  {
    value: "'JetBrains Mono', 'Fira Code', monospace",
    label: 'JetBrains Mono',
    group: 'Monoespaciadas (CAD)',
  },
  {
    value: "'Fira Code', 'JetBrains Mono', monospace",
    label: 'Fira Code',
    group: 'Monoespaciadas (CAD)',
  },
  {
    value: "'IBM Plex Mono', 'Courier New', monospace",
    label: 'IBM Plex Mono',
    group: 'Monoespaciadas (CAD)',
  },
  {
    value: "'Roboto Mono', 'Courier New', monospace",
    label: 'Roboto Mono',
    group: 'Monoespaciadas (CAD)',
  },
  {
    value: "'Source Code Pro', 'Courier New', monospace",
    label: 'Source Code Pro',
    group: 'Monoespaciadas (CAD)',
  },
  {
    value: "'Space Mono', 'Courier New', monospace",
    label: 'Space Mono',
    group: 'Monoespaciadas (CAD)',
  },
  {
    value: "Consolas, 'Lucida Console', monospace",
    label: 'Consolas',
    group: 'Monoespaciadas (CAD)',
  },
  {
    value: "'Lucida Console', Consolas, monospace",
    label: 'Lucida Console',
    group: 'Monoespaciadas (CAD)',
  },
  {
    value: "'DejaVu Sans Mono', Consolas, monospace",
    label: 'DejaVu Sans Mono',
    group: 'Monoespaciadas (CAD)',
  },
  {
    value: "'Courier New', Courier, monospace",
    label: 'Courier New',
    group: 'Monoespaciadas (CAD)',
  },
  // Técnicas — usadas en rotulado de planos AutoCAD / Civil3D / ArcGIS
  {
    value: "Bahnschrift, 'Segoe UI', sans-serif",
    label: 'Bahnschrift',
    group: 'Técnicas / Ingeniería',
  },
  {
    value: "'Century Gothic', 'Century Gothic MT', sans-serif",
    label: 'Century Gothic',
    group: 'Técnicas / Ingeniería',
  },
  { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma', group: 'Técnicas / Ingeniería' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial', group: 'Sans profesionales' },
  { value: 'Calibri, Candara, sans-serif', label: 'Calibri', group: 'Sans profesionales' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana', group: 'Sans profesionales' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia', group: 'Sans profesionales' },
];

export const AREA_UNIT_OPTIONS: { value: AreaUnit; label: string }[] = [
  { value: 'm2', label: 'm²' },
  { value: 'ha', label: 'ha' },
  { value: 'km2', label: 'km²' },
];

export const labelRenderCaps: Record<string, number> = {
  lote: 10_000,
  manzana: 3_000,
};
export const labelRenderCapDefault = 20_000;

export function defaultColorForKind(kind: GeoUrbanFeatureKind | null): string {
  switch (kind) {
    case 'manzana':
      return '#f59e0b';
    case 'lote':
      return '#38bdf8';
    case 'perimetro':
      return '#f0f6fc';
    case 'via':
      return '#8b5cf6';
    case 'rotonda':
      return '#f78166';
    default:
      return '#dffcff';
  }
}

export function defaultLabelStyleConfig(overrides?: Partial<LabelStyleConfig>): LabelStyleConfig {
  const base: LabelStyleConfig = {
    enabled: true,
    prefix: '',
    showPrefix: true,
    unit: 'm2',
    showPrimaryMetric: true,
    showSecondaryMetric: false,
    showEdgeCotas: false,
    labelFontSizePx: 11,
    cotaFontSizePx: 10,
    color: '#dffcff',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    bold: true,
    cotaStyle: 'lines',
    cotaPosition: 'external',
    titleBadge: 'none',
  };
  if (!overrides) return base;
  const normalized = normalizeLabelStyleConfig(overrides as LabelStyleConfig);
  return { ...base, ...normalized };
}

export function formatAreaWithUnit(areaM2: number | undefined, unit: AreaUnit): string {
  if (!Number.isFinite(areaM2)) return '';
  const v = areaM2 ?? 0;
  switch (unit) {
    case 'ha':
      return `${(v / 10000).toFixed(3)} ha`;
    case 'km2':
      return `${(v / 1_000_000).toFixed(4)} km²`;
    default:
      return `${v.toFixed(2)} m²`;
  }
}

export interface LabelLineMetrics {
  text?: string;
  primaryValue?: number;
  primaryFormatter?: (value: number, unit: AreaUnit) => string;
  secondaryLabel?: string;
  secondaryValue?: number;
}

export function composeLabelLines(cfg: LabelStyleConfig, metrics: LabelLineMetrics): string[] {
  const lines: string[] = [];
  const showPrimary = cfg.showPrimaryMetric ?? cfg.showArea ?? false;
  const showSecondary = cfg.showSecondaryMetric ?? cfg.showPerimeter ?? false;
  const prefixPart = cfg.showPrefix && cfg.prefix ? cfg.prefix : '';
  const title = [prefixPart, metrics.text ?? ''].filter(Boolean).join(' ').trim();
  if (title) lines.push(title);

  if (showPrimary && metrics.primaryValue !== undefined) {
    const format =
      metrics.primaryFormatter ?? ((v: number, unit: AreaUnit) => formatAreaWithUnit(v, unit));
    lines.push(format(metrics.primaryValue, cfg.unit));
  }
  if (showSecondary && metrics.secondaryValue !== undefined) {
    lines.push(`${metrics.secondaryLabel ?? 'Perím.'} ${metrics.secondaryValue.toFixed(2)} m`);
  }
  return lines;
}

export function resolveEffectiveLabelConfig(
  config: LabelStyleConfig,
  numbering: LabelNumberingMode
): LabelStyleConfig {
  const isCircledMode = numbering === 'circled' || numbering === 'circled-alpha';
  return {
    ...config,
    titleBadge: isCircledMode ? 'circle' : 'none',
  };
}
