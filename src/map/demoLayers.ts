import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature';
import type Polygon from 'ol/geom/Polygon';
import { generateDemoGrid, buildSpatialIndex } from './demoDataset';

/* ================================================================
   DEMO LAYERS — 3 sub-capas WebGL (LOD 0/1/2)
   ================================================================
   El estilo WebGL no puede cambiar la geometria de un feature en
   runtime (solo atributos visuales). Por eso el LOD se implementa
   como 3 sub-capas, cada una con su propio subset de features
   (LOD 0/1/2) y visibilidad ligada al zoom del view.

   - LOD 2 (mas simplificado):  visible a zoom < 15
   - LOD 1:                       visible a 15 <= zoom < 18
   - LOD 0 (geometria completa):  visible a zoom >= 18

   Ademas, la capa entera solo se renderiza a partir de zoom 14
   (antes no hay detalle suficiente para que valga la pena pintarla).
   ================================================================ */

const DEMO_VISIBLE_MIN_ZOOM = 14;
const LOD2_MAX_ZOOM = 15; // 14..14.999 -> LOD 2
const LOD1_MAX_ZOOM = 18; // 15..17.999 -> LOD 1
// >= 18 -> LOD 0

const DEMO_FILL = 'rgba(0, 212, 255, 0.15)';
const DEMO_STROKE = 'rgba(0, 212, 255, 0.5)';

function makeDemoLayer(
  features: Feature<Polygon>[],
  visible: boolean
): WebGLVectorLayer {
  return new WebGLVectorLayer({
    source: new VectorSource({ features }),
    visible,
    disableHitDetection: true,
    style: {
      'fill-color': DEMO_FILL,
      'stroke-color': DEMO_STROKE,
      'stroke-width': 1,
    },
  });
}

export interface DemoLayerBundle {
  lod0: WebGLVectorLayer;
  lod1: WebGLVectorLayer;
  lod2: WebGLVectorLayer;
  /** Refresca la visibilidad de las 3 capas segun el zoom actual */
  updateVisibility(zoom: number): void;
}

/**
 * Construye las 3 sub-capas LOD para el dataset demo.
 * El indice espacial se construye una sola vez (R-Tree).
 */
export function createDemoLayers(countPerSide = 100): DemoLayerBundle {
  const features = generateDemoGrid(countPerSide);
  buildSpatialIndex(features);

  // Subsets por nivel de detalle
  const lod0Features = features.map((f) => {
    const clone = f.clone();
    clone.setId(f.getId());
    clone.setGeometry(f.get('lod_0') as Polygon);
    return clone;
  });
  const lod1Features = features.map((f) => {
    const clone = f.clone();
    clone.setId(f.getId());
    clone.setGeometry(f.get('lod_1') as Polygon);
    return clone;
  });
  const lod2Features = features.map((f) => {
    const clone = f.clone();
    clone.setId(f.getId());
    clone.setGeometry(f.get('lod_2') as Polygon);
    return clone;
  });

  // Empezamos con todas apagadas; la visibilidad la maneja updateVisibility()
  const lod0 = makeDemoLayer(lod0Features, false);
  const lod1 = makeDemoLayer(lod1Features, false);
  const lod2 = makeDemoLayer(lod2Features, false);

  const updateVisibility = (zoom: number) => {
    const enabled = zoom >= DEMO_VISIBLE_MIN_ZOOM;
    let activeLod: WebGLVectorLayer;
    if (zoom >= LOD1_MAX_ZOOM) activeLod = lod0;
    else if (zoom >= LOD2_MAX_ZOOM) activeLod = lod1;
    else activeLod = lod2;

    lod0.setVisible(enabled && activeLod === lod0);
    lod1.setVisible(enabled && activeLod === lod1);
    lod2.setVisible(enabled && activeLod === lod2);
  };

  return { lod0, lod1, lod2, updateVisibility };
}
