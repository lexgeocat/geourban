import Interaction from 'ol/interaction/Interaction.js';
import type { TranslateOnSignature } from 'ol/interaction/Translate.js';
import BaseEvent from 'ol/events/Event.js';
import type { EventsKey } from 'ol/events.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type Map from 'ol/Map.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type Collection from 'ol/Collection.js';
import { hitTestFeature } from './hitTest';

export class TranslateEvent extends BaseEvent {
  features: Collection<Feature<Geometry>>;
  coordinate: [number, number];
  constructor(
    type: string,
    features: Collection<Feature<Geometry>>,
    coordinate: [number, number]
  ) {
    super(type);
    this.features = features;
    this.coordinate = coordinate;
  }
}

export interface SafeTranslateOptions {
  features: Collection<Feature<Geometry>>;
  /** Tolerancia de hit-test en píxeles (se convierte a unidades de mapa
   *  con la resolución vigente en cada evento). */
  hitTolerance?: number;
}

/**
 * Traslada las features seleccionadas por arrastre. Antes necesitaba una
 * capa de render dedicada (`hitDetectionLayer`, la `measurementLayer`
 * invisible) solo para que `map.forEachFeatureAtPixel` tuviera dónde
 * buscar — ver diagnóstico H2. Ahora el hit-test corre directo contra
 * las geometrías de `features` (el propio conjunto ya seleccionado,
 * típicamente unas pocas), sin depender de ningún layer.
 */
export default class SafeTranslate extends Interaction {
  declare on: TranslateOnSignature<EventsKey>;
  declare once: TranslateOnSignature<EventsKey>;
  declare un: TranslateOnSignature<EventsKey>;
  private features_: Collection<Feature<Geometry>>;
  private hitTolerancePx_: number;
  private lastCoordinate_: [number, number] | null = null;
  private dragging_ = false;

  constructor(options: SafeTranslateOptions) {
    super({
      handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent),
    });
    this.features_ = options.features;
    this.hitTolerancePx_ = options.hitTolerance ?? 6;
  }

  private featureAtCoordinate_(map: Map, coordinate: [number, number]): Feature<Geometry> | null {
    const resolution = map.getView().getResolution() ?? 1;
    const tolerance = this.hitTolerancePx_ * resolution;
    for (const feature of this.features_.getArray()) {
      if (hitTestFeature(coordinate, feature, tolerance)) return feature;
    }
    return null;
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const map = evt.map;
    const type = evt.type;

    if (type === 'pointerdown') {
      const feature = this.featureAtCoordinate_(map, evt.coordinate as [number, number]);
      if (feature) {
        this.lastCoordinate_ = evt.coordinate as [number, number];
        this.dragging_ = true;
        this.dispatchEvent(
          new TranslateEvent('translatestart', this.features_, this.lastCoordinate_)
        );
        return false;
      }
      return true;
    }

    if (type === 'pointerdrag' || (type === 'pointermove' && this.dragging_)) {
      if (!this.dragging_ || !this.lastCoordinate_) return true;
      const newCoordinate = evt.coordinate as [number, number];
      const deltaX = newCoordinate[0] - this.lastCoordinate_[0];
      const deltaY = newCoordinate[1] - this.lastCoordinate_[1];

      this.features_.forEach((feature) => {
        feature.getGeometry()?.translate(deltaX, deltaY);
      });

      this.lastCoordinate_ = newCoordinate;
      this.dispatchEvent(new TranslateEvent('translating', this.features_, newCoordinate));
      return false;
    }

    if (type === 'pointerup' && this.dragging_) {
      const coordinate = (evt.coordinate as [number, number]) ?? this.lastCoordinate_!;
      this.dragging_ = false;
      this.lastCoordinate_ = null;
      this.dispatchEvent(new TranslateEvent('translateend', this.features_, coordinate));
      return false;
    }

    return true;
  }
}