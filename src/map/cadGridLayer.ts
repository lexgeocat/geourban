import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Polygon, { fromExtent } from 'ol/geom/Polygon.js';
import LayerGroup from 'ol/layer/Group.js';
import VectorLayer from 'ol/layer/Vector.js';
import type Map from 'ol/Map.js';
import { unByKey } from 'ol/Observable.js';
import VectorSource from 'ol/source/Vector.js';
import { Fill, Stroke, Style } from 'ol/style.js';

/** Extensión Web Mercator — cubre el mundo proyectado */
const WORLD_EXTENT: [number, number, number, number] = [
  -20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244,
];

const NICE_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

const CAD_BG = '#0a0e14';
const CAD_MINOR = 'rgba(36, 48, 68, 0.85)';
const CAD_MAJOR = 'rgba(0, 212, 255, 0.22)';
const CAD_AXIS = 'rgba(0, 212, 255, 0.45)';

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

export function snapSpacing(meters: number) {
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

function rebuildGridFeatures(source: VectorSource, map: Map) {
  const view = map.getView();
  const size = map.getSize();
  if (!size) return;

  const extent = view.calculateExtent(size);
  const resolution = view.getResolution() ?? 1;
  const minorSpacing = snapSpacing(resolution * 52);
  const majorSpacing = minorSpacing * 5;

  const [minX, minY, maxX, maxY] = extent;
  const pad = minorSpacing * 3;
  const x0 = Math.floor((minX - pad) / minorSpacing) * minorSpacing;
  const x1 = Math.ceil((maxX + pad) / minorSpacing) * minorSpacing;
  const y0 = Math.floor((minY - pad) / minorSpacing) * minorSpacing;
  const y1 = Math.ceil((maxY + pad) / minorSpacing) * minorSpacing;

  const features: Feature[] = [];

  for (let x = x0; x <= x1; x += minorSpacing) {
    const onAxis = Math.abs(x) < minorSpacing * 0.01;
    const isMajor = onAxis || isMultipleOf(x, majorSpacing);
    features.push(
      new Feature({
        geometry: new LineString([
          [x, y0],
          [x, y1],
        ]),
        gridKind: onAxis ? 'axis' : isMajor ? 'major' : 'minor',
      })
    );
  }

  for (let y = y0; y <= y1; y += minorSpacing) {
    const onAxis = Math.abs(y) < minorSpacing * 0.01;
    const isMajor = onAxis || isMultipleOf(y, majorSpacing);
    features.push(
      new Feature({
        geometry: new LineString([
          [x0, y],
          [x1, y],
        ]),
        gridKind: onAxis ? 'axis' : isMajor ? 'major' : 'minor',
      })
    );
  }

  source.clear(true);
  source.addFeatures(features);
}

function createBackgroundLayer() {
  const source = new VectorSource({
    features: [
      new Feature({
        geometry: fromExtent(WORLD_EXTENT),
      }),
    ],
  });

  return new VectorLayer({
    source,
    style: new Style({
      fill: new Fill({ color: CAD_BG }),
    }),
  });
}

export type CadBaseMapBundle = {
  layer: LayerGroup;
  attach: (map: Map) => () => void;
};

export function createCadBaseMap(): CadBaseMapBundle {
  const gridSource = new VectorSource();
  const gridLayer = new VectorLayer({
    source: gridSource,
    style: (feature) => GRID_STYLES[(feature.get('gridKind') as GridKind) ?? 'minor'],
    updateWhileAnimating: true,
    updateWhileInteracting: false,
    renderBuffer: 100,
  });

  const layer = new LayerGroup({
    layers: [createBackgroundLayer(), gridLayer],
  });

  const attach = (map: Map) => {
    const update = () => rebuildGridFeatures(gridSource, map);
    update();

    const moveKey = map.on('moveend', update);
    const resKey = map.getView().on('change:resolution', update);

    return () => {
      unByKey(moveKey);
      unByKey(resKey);
    };
  };

  return { layer, attach };
}

export const CAD_BASE_MAP_ATTRIBUTION = 'Fondo CAD — grilla métrica GeoUrban';

export const cadBaseMapBundles = new WeakMap<LayerGroup, CadBaseMapBundle>();