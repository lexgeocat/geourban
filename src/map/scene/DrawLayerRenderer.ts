import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { createMeasurementStyle } from '../styleFactory';

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

export function buildDrawLayers(
  visibility: WorkVisibility,
): DrawLayers {
  const source = new VectorSource();

  const mznFillExpr = ['match', ['get', 'colorIdx'],
    0, MZN_COLORS_22[0], 1, MZN_COLORS_22[1], 2, MZN_COLORS_22[2],
    3, MZN_COLORS_22[3], 4, MZN_COLORS_22[4], 5, MZN_COLORS_22[5],
    6, MZN_COLORS_22[6], 7, MZN_COLORS_22[7], 8, MZN_COLORS_22[8],
    9, MZN_COLORS_22[9], 'rgba(16,185,129,0.30)',
  ] as any[];
  const mznStrokeExpr = ['match', ['get', 'colorIdx'],
    0, MZN_COLORS_STR[0], 1, MZN_COLORS_STR[1], 2, MZN_COLORS_STR[2],
    3, MZN_COLORS_STR[3], 4, MZN_COLORS_STR[4], 5, MZN_COLORS_STR[5],
    6, MZN_COLORS_STR[6], 7, MZN_COLORS_STR[7], 8, MZN_COLORS_STR[8],
    9, MZN_COLORS_STR[9], '#10b981',
  ] as any[];

  const webglLayer = new WebGLVectorLayer({
    source,
    disableHitDetection: true,
    style: {
      'fill-color': ['case', ['==', ['get', 'type'], 'manzana'], mznFillExpr, 'rgba(16,185,129,0.30)'],
      'stroke-color': ['case', ['==', ['get', 'type'], 'manzana'], mznStrokeExpr, '#10b981'],
      'stroke-width': 2,
    },
  });

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
