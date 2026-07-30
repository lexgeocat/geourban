import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import { useStreetStore, type Street } from '../store/entities/streetStore';
import { useRoundaboutStore, type Roundabout } from '../store/entities/roundaboutStore';
import { roundaboutGeometry } from '../geo/roundabout/roundaboutEngine';

let source: VectorSource | null = null;
/** Guardados para que un eventual `disposeRoadSnapSource` (HMR/tests) pueda liberarlos. */
let unsubscribeStreets: (() => void) | null = null;
let unsubscribeRoundabouts: (() => void) | null = null;

function streetToFeature(s: Street): Feature {
  const coords: Array<[number, number]> = [s.start, ...(s.waypoints ?? []), s.end];
  const feat = new Feature({ geometry: new LineString(coords) });
  feat.setId(s.id);
  feat.set('kind', 'calle', true);
  feat.set('layerId', s.layerId, true);
  feat.set('label', s.name, true);
  feat.set('roadWidthM', s.widthM, true);
  return feat;
}

function roundaboutToFeature(rb: Roundabout): Feature {
  const ring = roundaboutGeometry(rb).sideOuter;
  const closed = ring.length > 0 ? [...ring, ring[0]] : ring;
  const feat = new Feature({ geometry: new Polygon([closed as number[][]]) });
  feat.setId(rb.id);
  feat.set('kind', 'rotonda', true);
  feat.set('layerId', rb.layerId, true);
  feat.set('label', rb.name, true);
  return feat;
}

function resync(src: VectorSource): void {
  const streets = useStreetStore.getState().streets;
  const roundabouts = useRoundaboutStore.getState().roundabouts;
  src.clear(true);
  src.addFeatures([
    ...streets.map(streetToFeature),
    ...roundabouts.map(roundaboutToFeature),
  ]);
  src.changed();
}

/** Devuelve (creando si hace falta) la fuente fantasma, ya sincronizada. */
export function getOrCreateRoadSnapSource(): VectorSource {
  if (!source) {
    source = new VectorSource();
    resync(source);
    unsubscribeStreets = useStreetStore.subscribe(() => {
      if (source) resync(source);
    });
    unsubscribeRoundabouts = useRoundaboutStore.subscribe(() => {
      if (source) resync(source);
    });
  }
  return source;
}

/** Libera los listeners y reinicia el singleton. Pensado para HMR/tests. */
export function disposeRoadSnapSource(): void {
  unsubscribeStreets?.();
  unsubscribeStreets = null;
  unsubscribeRoundabouts?.();
  unsubscribeRoundabouts = null;
  source?.clear(true);
  source = null;
}
