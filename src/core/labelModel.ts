import type { GeoUrbanFeatureKind } from './objectModel';

export type AreaUnit = 'm2' | 'ha' | 'km2';

export interface LabelStyleConfig {
  enabled: boolean;
  prefix: string;
  showPrefix: boolean;
  unit: AreaUnit;
  showArea: boolean;
  showPerimeter: boolean;
  showEdgeCotas: boolean;
  labelFontSizePx: number;
  cotaFontSizePx: number;
  color: string;
  fontFamily: string;
}

export const LABEL_FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
  { value: "'Courier New', monospace", label: 'Courier New' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
];

export const AREA_UNIT_OPTIONS: { value: AreaUnit; label: string }[] = [
  { value: 'm2', label: 'm²' },
  { value: 'ha', label: 'ha' },
  { value: 'km2', label: 'km²' },
];

export function defaultColorForKind(kind: GeoUrbanFeatureKind | null): string {
  switch (kind) {
    case 'manzana':
      return '#f59e0b';
    case 'lote':
      return '#38bdf8';
    case 'perimetro':
      return '#f0f6fc';
    case 'equipamiento':
      return '#4dd0c4';
    case 'calle':
      return '#8b5cf6';
    case 'rotonda':
      return '#f78166';
    default:
      return '#dffcff';
  }
}

export function defaultLabelStyleConfig(overrides?: Partial<LabelStyleConfig>): LabelStyleConfig {
  return {
    enabled: true,
    prefix: '',
    showPrefix: true,
    unit: 'm2',
    showArea: true,
    showPerimeter: false,
    showEdgeCotas: false,
    labelFontSizePx: 11,
    cotaFontSizePx: 10,
    color: '#dffcff',
    fontFamily: "'JetBrains Mono', monospace",
    ...overrides,
  };
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
  const prefixPart = cfg.showPrefix && cfg.prefix ? cfg.prefix : '';
  const title = [prefixPart, metrics.text ?? ''].filter(Boolean).join(' ').trim();
  if (title) lines.push(title);

  if (cfg.showArea && metrics.primaryValue !== undefined) {
    const format =
      metrics.primaryFormatter ?? ((v: number, unit: AreaUnit) => formatAreaWithUnit(v, unit));
    lines.push(format(metrics.primaryValue, cfg.unit));
  }
  if (cfg.showPerimeter && metrics.secondaryValue !== undefined) {
    lines.push(`${metrics.secondaryLabel ?? 'Perím.'} ${metrics.secondaryValue.toFixed(2)} m`);
  }
  return lines;
}
