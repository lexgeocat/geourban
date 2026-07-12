import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import Polygon, { fromExtent } from 'ol/geom/Polygon.js';
import LayerGroup from 'ol/layer/Group.js';
import VectorLayer from 'ol/layer/Vector.js';
import type Map from 'ol/Map.js';
import { unByKey } from 'ol/Observable.js';
import VectorSource from 'ol/source/Vector.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';

/**
 * CAD Grid profesional — port mejorado de LOTES_SAI.
 *
 * Features:
 *  - Grilla menor/mayor/eje con estilos diferenciados
 *  - Snap a intersecciones de grilla
 *  - Etiquetas de coordenadas en los ejes
 *  - Origen configurable (anclaje a punto del proyecto)
 *  - Rebuild con debounce para performance
 */

/** Extensión Web Mercator — cubre el mundo proyectado */
const WORLD_EXTENT: [number, number, number, number] = [
  -20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244,
];

const NICE_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

const CAD_BG = '#0a0e14';
const CAD_MINOR = 'rgba(36, 48, 68, 0.85)';
const CAD_MAJOR = 'rgba(0, 212, 255, 0.22)';
const CAD_AXIS = 'rgba(0, 212, 255, 0.45)';
const CAD_LABEL = 'rgba(0, 212, 255, 0.55)';

type GridKind = 'minor' | 'major' | 'axis';

const GRID_STYLES: Record<GridKind, Style> = {
  minor: new Style({
    stroke: new Stroke({ color: CAD_MINOR, width: 1 }),
  }),
  major: new Style({
    stroke: new Stroke({ color: CAD_MAJOR, width: 1.25 }),
  }),
  axis: new Style({
    stroke: new Stroke({ color: CAD_AXIS, width: 1.5 }),
  }),
};

function snapSpacing(meters: number) {
  for (const step of NICE_STEPS) {
    if (step >= meters) return step;
  }
  return NICE_STEPS[NICE_STEPS.length - 1];
}

function isMultipleOf(value: number, step: number) {
  if (step <= 0) return false;
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-4;
}

/** Formatea coordenada para etiqueta (abreviada) */
function formatCoord(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(0);
}

function rebuildGridFeatures(
  gridSource: VectorSource,
  snapSource: VectorSource,
  map: Map,
  origin: [number, number],
) {
  const view = map.getView();
  const size = map.getSize();
  if (!size) return;

  const extent = view.calculateExtent(size);
  const resolution = view.getResolution() ?? 1;
  const minorSpacing = snapSpacing(resolution * 52);
  const majorSpacing = minorSpacing * 5;

  const [minX, minY, maxX, maxY] = extent;
  const pad = minorSpacing * 3;

  // Ajustar origen: la grilla se alinea a `origin`
  const ox = origin[0];
  const oy = origin[1];

  const x0 = Math.floor((minX - pad - ox) / minorSpacing) * minorSpacing + ox;
  const x1 = Math.ceil((maxX + pad - ox) / minorSpacing) * minorSpacing + ox;
  const y0 = Math.floor((minY - pad - oy) / minorSpacing) * minorSpacing + oy;
  const y1 = Math.ceil((maxY + pad - oy) / minorSpacing) * minorSpacing + oy;

  const gridFeatures: Feature[] = [];
  const snapFeatures: Feature[] = [];

  // Líneas verticales
  for (let x = x0; x <= x1; x += minorSpacing) {
    const onAxis = Math.abs(x - ox) < minorSpacing * 0.01;
    const isMajor = onAxis || isMultipleOf(x - ox, majorSpacing);
    gridFeatures.push(
      new Feature({
        geometry: new LineString([[x, y0], [x, y1]]),
        gridKind: onAxis ? 'axis' : isMajor ? 'major' : 'minor',
      })
    );
  }

  // Líneas horizontales
  for (let y = y0; y <= y1; y += minorSpacing) {
    const onAxis = Math.abs(y - oy) < minorSpacing * 0.01;
    const isMajor = onAxis || isMultipleOf(y - oy, majorSpacing);
    gridFeatures.push(
      new Feature({
        geometry: new LineString([[x0, y], [x1, y]]),
        gridKind: onAxis ? 'axis' : isMajor ? 'major' : 'minor',
      })
    );
  }

  // Snap points en intersecciones mayores
  for (let x = x0; x <= x1; x += minorSpacing) {
    if (!isMultipleOf(x - ox, majorSpacing) && Math.abs(x - ox) > minorSpacing * 0.01) continue;
    for (let y = y0; y <= y1; y += minorSpacing) {
      if (!isMultipleOf(y - oy, majorSpacing) && Math.abs(y - oy) > minorSpacing * 0.01) continue;
      snapFeatures.push(
        new Feature({
          geometry: new Point([x, y]),
        })
      );
    }
  }

  gridSource.clear(true);
  gridSource.addFeatures(gridFeatures);
  snapSource.clear(true);
  snapSource.addFeatures(snapFeatures);
}

function createBackgroundLayer() {
  const source = new VectorSource({
    features: [new Feature({ geometry: fromExtent(WORLD_EXTENT) })],
  });
  return new VectorLayer({
    source,
    style: new Style({ fill: new Fill({ color: CAD_BG }) }),
  });
}

/** Etiquetas de coordenadas en los ejes (renderizadas como OL Text) */
function createAxisLabelsLayer(): VectorLayer<VectorSource> {
  const source = new VectorSource();
  return new VectorLayer({
    source,
    style: (feature) => {
      const kind = feature.get('labelKind');
      const text = feature.get('labelText') as string;
      if (!text) return GRID_STYLES.minor;
      return new Style({
        geometry: feature.getGeometry(),
        text: new Text({
          text,
          font: '10px JetBrains Mono, monospace',
          fill: new Fill({ color: CAD_LABEL }),
          placement: 'point',
          textAlign: kind === 'x' ? 'center' : 'right',
          textBaseline: kind === 'x' ? 'top' : 'middle',
          offsetY: kind === 'x' ? 4 : 0,
          offsetX: kind === 'x' ? 0 : -6,
        }),
      });
    },
  });
}

function rebuildAxisLabels(
  labelSource: VectorSource,
  map: Map,
  origin: [number, number],
) {
  const view = map.getView();
  const size = map.getSize();
  if (!size) return;

  const extent = view.calculateExtent(size);
  const resolution = view.getResolution() ?? 1;
  const minorSpacing = snapSpacing(resolution * 52);
  const majorSpacing = minorSpacing * 5;
  const zoom = view.getZoom() ?? 0;

  // Solo mostrar labels en zoom suficiente
  if (zoom < 16) {
    labelSource.clear(true);
    return;
  }

  const [minX, minY, maxX, maxY] = extent;
  const pad = minorSpacing * 3;
  const ox = origin[0];
  const oy = origin[1];

  const x0 = Math.floor((minX - pad - ox) / minorSpacing) * minorSpacing + ox;
  const x1 = Math.ceil((maxX + pad - ox) / minorSpacing) * minorSpacing + ox;
  const y0 = Math.floor((minY - pad - oy) / minorSpacing) * minorSpacing + oy;
  const y1 = Math.ceil((maxY + pad - oy) / minorSpacing) * minorSpacing + oy;

  const features: Feature[] = [];

  // Labels en eje Y (coordenadas X)
  for (let x = x0; x <= x1; x += minorSpacing) {
    if (!isMultipleOf(x - ox, majorSpacing) && Math.abs(x - ox) > minorSpacing * 0.01) continue;
    features.push(new Feature({
      geometry: new Point([x, oy]),
      labelKind: 'x',
      labelText: formatCoord(x),
    }));
  }

  // Labels en eje X (coordenadas Y)
  for (let y = y0; y <= y1; y += minorSpacing) {
    if (!isMultipleOf(y - oy, majorSpacing) && Math.abs(y - oy) > minorSpacing * 0.01) continue;
    features.push(new Feature({
      geometry: new Point([ox, y]),
      labelKind: 'y',
      labelText: formatCoord(y),
    }));
  }

  labelSource.clear(true);
  labelSource.addFeatures(features);
}

export type CadBaseMapBundle = {
  layer: LayerGroup;
  attach: (map: Map) => () => void;
  snapSource: VectorSource;
  setOrigin: (o: [number, number]) => void;
};

export function createCadBaseMap(): CadBaseMapBundle {
  const gridSource = new VectorSource();
  const snapSource = new VectorSource();
  const labelSource = new VectorSource();

  let currentOrigin: [number, number] = [0, 0];

  const gridLayer = new VectorLayer({
    source: gridSource,
    style: (feature) => GRID_STYLES[(feature.get('gridKind') as GridKind) ?? 'minor'],
    updateWhileAnimating: true,
    updateWhileInteracting: false,
    renderBuffer: 100,
  });

  const labelLayer = createAxisLabelsLayer();
  labelLayer.setSource(labelSource);

  const layer = new LayerGroup({
    layers: [createBackgroundLayer(), gridLayer, labelLayer],
  });

  const attach = (map: Map) => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        rebuildGridFeatures(gridSource, snapSource, map, currentOrigin);
        rebuildAxisLabels(labelSource, map, currentOrigin);
      }, 50);
    };

    debouncedUpdate();
    const moveKey = map.on('moveend', debouncedUpdate);
    const resKey = map.getView().on('change:resolution', debouncedUpdate);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unByKey(moveKey);
      unByKey(resKey);
    };
  };

  const setOrigin = (o: [number, number]) => {
    currentOrigin = o;
  };

  return { layer, attach, snapSource, setOrigin };
}

export const CAD_BASE_MAP_ATTRIBUTION = 'Fondo CAD — grilla métrica GeoUrban';

export const cadBaseMapBundles = new WeakMap<LayerGroup, CadBaseMapBundle>();
