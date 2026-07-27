import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import type { Layer } from '../../core/objectModel';
import { MZN_COLORS, MZN_COLOR_COUNT } from '../../geo/manzanoColor';

export type WorkVisibility = {
  lots: boolean;
  streets: boolean;
  /** Ya no controla ninguna capa de render (ver nota en DrawLayers más
   *  abajo); se mantiene el campo para no romper el store/ribbon. */
  measurements: boolean;
};

export const MZN_COLORS_22 = MZN_COLORS.map((c) => withAlpha(c, 0.13));

export const MZN_COLORS_STR: readonly string[] = MZN_COLORS;

export interface DrawLayers {
  webglLayer: WebGLVectorLayer;
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

export function buildWebglStyle(layers: Layer[]): Record<string, any> {
  const layerMap = new Map<string, Layer>();
  for (const l of layers) layerMap.set(l.id, l);

  const colorForLayer = (layerId: string, property: 'fill' | 'stroke'): any => {
    const layer = layerMap.get(layerId);
    if (!layer || layer.colorMode !== 'colorIdx') {
      const a = layer?.opacity ?? 1;
      return property === 'fill'
        ? withAlpha(layer?.fillColor ?? layer?.color ?? '#10b981', 0.30 * a)
        : withAlpha(layer?.color ?? '#10b981', a);
    }
    const a = property === 'fill' ? 0.30 : 1;
    const lo = layer?.opacity ?? 1;
    const expr: any[] = ['match', ['get', 'colorIdx']];
    for (let i = 0; i < MZN_COLOR_COUNT; i++) expr.push(i, withAlpha(MZN_COLORS[i], a * lo));
    expr.push(withAlpha(MZN_COLORS[0], a * lo));
    return expr;
  };

  const fillMatch: any[] = ['match', ['get', 'layerId']];
  const strokeMatch: any[] = ['match', ['get', 'layerId']];

  for (const l of layers) {
    fillMatch.push(l.id, colorForLayer(l.id, 'fill'));
    strokeMatch.push(l.id, colorForLayer(l.id, 'stroke'));
  }
  fillMatch.push('rgba(16,185,129,0.30)');
  strokeMatch.push('#10b981');

  return {
    'fill-color': fillMatch,
    'stroke-color': strokeMatch,
    'stroke-width': 2,
  };
}

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
  // Visibilidad inicial de lotes/manzanos — antes solo se aplicaba desde un
  // useEffect en Map.tsx atado a layerStore.workVisibility (fuente de
  // verdad duplicada, ver plan-optimizacion-geourban.md Fase 1). Ahora el
  // caller (Map.tsx) calcula `visibility.lots` desde el registro de capas
  // y la pasamos acá, igual que ya se hacía con `streetLayer` más abajo.
  webglLayer.setVisible(visibility.lots);

  // La antigua `measurementLayer` (VectorLayer Canvas2D invisible, mismo
  // source que webglLayer, con `declutter: true`) existía SOLO para que
  // `ol/interaction/Select` / `forEachFeatureAtPixel` tuvieran una capa
  // donde hacer hit-testing (WebGL no soporta hit-testing nativo acá) —
  // ver diagnóstico H2. Ese hit-testing ahora corre por fuera del
  // pipeline de render (RBush + test exacto de geometría, ver
  // `map/hitTest.ts` y `map/scene/HitTestSelect.ts`), así que esta capa
  // se elimina por completo: un rasterizado Canvas2D menos por frame
  // sobre TODO el proyecto, sin cambiar nada visible.

  const streetSource = new VectorSource();
  const streetLayer = new VectorLayer({
    source: streetSource,
    visible: visibility.streets,
    // null (NO undefined): `undefined` hace que OL aplique su estilo por
    // DEFECTO (visible) a cualquier feature que quede en streetSource —
    // que se supone vacío entre trazados, ya que quien realmente dibuja
    // las calles es el postrender de PostrenderPainter. Con `undefined`,
    // cualquier feature huérfana ahí (ver fix en StreetMode.ts) se veía
    // como una línea fantasma con el estilo azul por defecto de OL.
    style: null,
  });

  const postrenderLayer = new VectorLayer({
    source: new VectorSource(),
    style: () => undefined,
    renderOrder: undefined,
  });

  return { webglLayer, streetLayer, postrenderLayer, source, streetSource };
}