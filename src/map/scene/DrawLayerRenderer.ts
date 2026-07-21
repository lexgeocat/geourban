import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { createMeasurementStyle } from '../styleFactory';
import type { Layer } from '../../core/objectModel';

export type WorkVisibility = {
  lots: boolean;
  streets: boolean;
  measurements: boolean;
};

export const MZN_COLORS_22 = [
  'rgba(88,166,255,0.13)', 'rgba(63,185,80,0.13)', 'rgba(245,158,11,0.13)',
  'rgba(239,68,68,0.13)', 'rgba(139,92,246,0.13)', 'rgba(236,72,153,0.13)',
  'rgba(20,184,166,0.13)', 'rgba(249,115,22,0.13)', 'rgba(6,182,212,0.13)',
  'rgba(132,204,22,0.13)',
];

export const MZN_COLORS_STR = [
  '#58a6ff', '#3fb950', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
];

export interface DrawLayers {
  webglLayer: WebGLVectorLayer;
  measurementLayer: VectorLayer<VectorSource>;
  streetLayer: VectorLayer<VectorSource>;
  postrenderLayer: VectorLayer<VectorSource>;
  source: VectorSource;
  streetSource: VectorSource;
}

/** Hex `#rrggbb` o `#rgb` → `rgba(r,g,b,a)`. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Construye un `match` para WebGL style: `get('layerId')` ↔ color de la capa.
 *  Si no hay match (o `layerId` es null/undefined), cae al fallback de manzana
 *  (paleta clásica por `colorIdx`). */
function buildLayerColorMatch(
  layers: Layer[],
  property: 'fill' | 'stroke',
  fallbackManzanaExpr: any[],
  fallbackOther: string,
): any[] {
  const result: any[] = ['match', ['get', 'layerId']];
  for (const l of layers) {
    const color = l.color ?? '#10b981';
    const a = l.opacity ?? 1;
    result.push(l.id);
    result.push(property === 'fill' ? withAlpha(color, 0.30 * a) : color);
  }
  // default
  result.push(['case', ['==', ['get', 'type'], 'manzana'], fallbackManzanaExpr, fallbackOther]);
  return result;
}

/** Construye el style object de la WebGLVectorLayer. Acepta el array de
 *  capas para que el `match` por `layerId` use los colores reales. */
export function buildWebglStyle(layers: Layer[]): Record<string, any> {
  const mznFillExpr: any[] = ['match', ['get', 'colorIdx'],
    0, MZN_COLORS_22[0], 1, MZN_COLORS_22[1], 2, MZN_COLORS_22[2],
    3, MZN_COLORS_22[3], 4, MZN_COLORS_22[4], 5, MZN_COLORS_22[5],
    6, MZN_COLORS_22[6], 7, MZN_COLORS_22[7], 8, MZN_COLORS_22[8],
    9, MZN_COLORS_22[9], 'rgba(16,185,129,0.30)',
  ];
  const mznStrokeExpr: any[] = ['match', ['get', 'colorIdx'],
    0, MZN_COLORS_STR[0], 1, MZN_COLORS_STR[1], 2, MZN_COLORS_STR[2],
    3, MZN_COLORS_STR[3], 4, MZN_COLORS_STR[4], 5, MZN_COLORS_STR[5],
    6, MZN_COLORS_STR[6], 7, MZN_COLORS_STR[7], 8, MZN_COLORS_STR[8],
    9, MZN_COLORS_STR[9], '#10b981',
  ];

  return {
    'fill-color': buildLayerColorMatch(layers, 'fill', mznFillExpr, 'rgba(16,185,129,0.30)'),
    'stroke-color': buildLayerColorMatch(layers, 'stroke', mznStrokeExpr, '#10b981'),
    'stroke-width': 2,
  };
}

/** Filter para WebGLVectorLayer: oculta features cuya `layerId` apunte a
 *  una capa con `visible: false`. Features sin `layerId` siempre pasan. */
export function buildLayerFilter(layers: Layer[]): any[] {
  const hiddenIds = layers.filter((l) => !l.visible).map((l) => l.id);
  if (hiddenIds.length === 0) return ['==', 1, 1];
  return [
    'all',
    ['==', 1, 1],
    [
      'any',
      ['==', ['get', 'layerId'], null],
      ['!', ['in', ['get', 'layerId'], ['literal', hiddenIds]]],
    ],
  ];
}

export function buildDrawLayers(
  visibility: WorkVisibility,
  layers: Layer[] = [],
): DrawLayers {
  const source = new VectorSource();

  const webglLayer = new WebGLVectorLayer({
    source,
    disableHitDetection: true,
    style: buildWebglStyle(layers),
  });
  // El filter se aplica en la creación (filter no es parte del style).

  const measurementLayer = new VectorLayer({
    source,
    visible: visibility.measurements,
    declutter: true,
    style: createMeasurementStyle(),
  });

  const streetSource = new VectorSource();
  const streetLayer = new VectorLayer({
    source: streetSource,
    visible: visibility.streets,
    style: undefined, // el postrender de PostrenderPainter pinta las calles
  });

  // Capa vacía: hook para postrender de labels/snap guides.
  const postrenderLayer = new VectorLayer({
    source: new VectorSource(),
    style: () => undefined,
    renderOrder: undefined,
  });

  return { webglLayer, measurementLayer, streetLayer, postrenderLayer, source, streetSource };
}
