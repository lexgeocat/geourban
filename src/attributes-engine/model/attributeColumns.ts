import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { GeoUrbanFeatureKind } from '@kernel/domain-model/featureModel';
import { formatMetricArea, formatMetricLength, streetLengthMetricM } from '@georef-engine/metrics';
import { roundaboutRoadAreaM2 } from '@vias-engine/geometry/roundaboutEngine';
import type { Street } from '@vias-engine/store/streetStore';
import type { Roundabout } from '@vias-engine/store/roundaboutStore';

export interface AttributeColumnDef<T> {
  key: string;
  label: string;
  editable: boolean;
  align?: 'left' | 'right';
  get: (item: T) => string;
  parse?: (raw: string) => unknown;
}

function withFid<T>(
  cols: AttributeColumnDef<T>[],
  getFid: (item: T) => number | undefined
): AttributeColumnDef<T>[] {
  const fidCol: AttributeColumnDef<T> = {
    key: 'fid',
    label: 'ID',
    editable: false,
    align: 'right',
    get: (item) => {
      const v = getFid(item);
      return v == null ? '—' : String(v);
    },
  };
  return [fidCol, ...cols];
}

function textCol(
  key: string,
  label: string,
  editable = true
): AttributeColumnDef<Feature<Geometry>> {
  return {
    key,
    label,
    editable,
    get: (f) => ((f.get(key) as string | undefined) ?? '').toString(),
    parse: (raw) => raw,
  };
}

function numCol(
  key: string,
  label: string,
  formatter: (v: number) => string
): AttributeColumnDef<Feature<Geometry>> {
  return {
    key,
    label,
    editable: false,
    align: 'right',
    get: (f) => {
      const v = f.get(key) as number | undefined;
      return v == null || !Number.isFinite(v) ? '—' : formatter(v);
    },
  };
}

function boolCol(key: string, label: string): AttributeColumnDef<Feature<Geometry>> {
  return { key, label, editable: false, get: (f) => (f.get(key) ? 'Sí' : 'No') };
}

const RAW_FEATURE_COLUMNS: Partial<
  Record<GeoUrbanFeatureKind, AttributeColumnDef<Feature<Geometry>>[]>
> = {
  lote: [
    textCol('code', 'Código'),
    textCol('label', 'Etiqueta'),
    numCol('areaM2', 'Área', formatMetricArea),
    numCol('frontM', 'Frente', formatMetricLength),
    numCol('depthM', 'Fondo', formatMetricLength),
    boolCol('isRemnant', 'Remanente'),
    textCol('subdivisionMethod', 'Método', false),
  ],
  manzana: [
    textCol('code', 'Código'),
    textCol('label', 'Etiqueta'),
    numCol('areaM2', 'Área', formatMetricArea),
    textCol('lotStatus', 'Estado lotes', false),
  ],
  perimetro: [
    textCol('label', 'Etiqueta'),
    numCol('areaM2', 'Área', formatMetricArea),
    numCol('perimeterM', 'Perímetro', formatMetricLength),
  ],
  linea: [textCol('label', 'Etiqueta'), numCol('lengthM', 'Longitud', formatMetricLength)],
  polilinea: [textCol('label', 'Etiqueta'), numCol('lengthM', 'Longitud', formatMetricLength)],
  circulo: [
    textCol('label', 'Etiqueta'),
    numCol('areaM2', 'Área', formatMetricArea),
    numCol('perimeterM', 'Perímetro', formatMetricLength),
  ],
  punto: [textCol('label', 'Etiqueta')],
};

export const FEATURE_COLUMNS_BY_KIND = Object.fromEntries(
  Object.entries(RAW_FEATURE_COLUMNS).map(([kind, cols]) => [
    kind,
    withFid(cols!, (f) => f.get('fid') as number | undefined),
  ])
) as Partial<Record<GeoUrbanFeatureKind, AttributeColumnDef<Feature<Geometry>>[]>>;

export const STREET_COLUMNS: AttributeColumnDef<Street>[] = withFid<Street>(
  [
    { key: 'name', label: 'Nombre', editable: true, get: (s) => s.name, parse: (raw) => raw },
    {
      key: 'widthM',
      label: 'Calzada (m)',
      editable: true,
      align: 'right',
      get: (s) => s.widthM.toFixed(2),
      parse: (raw) => Math.max(0.5, parseFloat(raw) || 0.5),
    },
    {
      key: 'sideWidthM',
      label: 'Vereda (m)',
      editable: true,
      align: 'right',
      get: (s) => s.sideWidthM.toFixed(2),
      parse: (raw) => Math.max(0, parseFloat(raw) || 0),
    },
    {
      key: 'lengthM',
      label: 'Longitud',
      editable: false,
      align: 'right',
      get: (s) => formatMetricLength(streetLengthMetricM(s)),
    },
  ],
  (s) => s.fid
);

export const ROUNDABOUT_COLUMNS: AttributeColumnDef<Roundabout>[] = withFid<Roundabout>(
  [
    { key: 'name', label: 'Nombre', editable: true, get: (r) => r.name, parse: (raw) => raw },
    {
      key: 'radiusM',
      label: 'Radio (m)',
      editable: true,
      align: 'right',
      get: (r) => r.radiusM.toFixed(2),
      parse: (raw) => Math.max(1, parseFloat(raw) || 1),
    },
    {
      key: 'roadWidthM',
      label: 'Calzada (m)',
      editable: true,
      align: 'right',
      get: (r) => r.roadWidthM.toFixed(2),
      parse: (raw) => Math.max(1, parseFloat(raw) || 1),
    },
    {
      key: 'sidewalkWidthM',
      label: 'Vereda (m)',
      editable: true,
      align: 'right',
      get: (r) => r.sidewalkWidthM.toFixed(2),
      parse: (raw) => Math.max(0, parseFloat(raw) || 0),
    },
    {
      key: 'areaM2',
      label: 'Área calzada',
      editable: false,
      align: 'right',
      get: (r) => formatMetricArea(roundaboutRoadAreaM2(r)),
    },
  ],
  (r) => r.fid
);

// ─── Correlación con el motor de etiquetado ─────────────────────────────

export function listBindableFieldsForKind(
  kind: GeoUrbanFeatureKind
): Array<{ key: string; label: string }> {
  if (kind === 'via') return STREET_COLUMNS.map((c) => ({ key: c.key, label: c.label }));
  if (kind === 'rotonda') return ROUNDABOUT_COLUMNS.map((c) => ({ key: c.key, label: c.label }));
  return (FEATURE_COLUMNS_BY_KIND[kind] ?? []).map((c) => ({ key: c.key, label: c.label }));
}

export function getFeatureFieldText(
  feature: Feature<Geometry>,
  kind: GeoUrbanFeatureKind,
  key: string
): string {
  const col = (FEATURE_COLUMNS_BY_KIND[kind] ?? []).find((c) => c.key === key);
  return col ? col.get(feature) : '';
}

export function getStreetFieldText(street: Street, key: string): string {
  const col = STREET_COLUMNS.find((c) => c.key === key);
  return col ? col.get(street) : '';
}

export function getRoundaboutFieldText(rb: Roundabout, key: string): string {
  const col = ROUNDABOUT_COLUMNS.find((c) => c.key === key);
  return col ? col.get(rb) : '';
}
