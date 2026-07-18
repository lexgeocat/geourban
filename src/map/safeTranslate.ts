import Interaction from 'ol/interaction/Interaction.js';
import type { TranslateOnSignature } from 'ol/interaction/Translate.js';
import BaseEvent from 'ol/events/Event.js';
import type { EventsKey } from 'ol/events.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type Map from 'ol/Map.js';
import type VectorLayer from 'ol/layer/Vector.js';
import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type Collection from 'ol/Collection.js';

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
  hitDetectionLayer: VectorLayer<VectorSource>;
  hitTolerance?: number;
}

export default class SafeTranslate extends Interaction {
  declare on: TranslateOnSignature<EventsKey>;
  declare once: TranslateOnSignature<EventsKey>;
  declare un: TranslateOnSignature<EventsKey>;
  private features_: Collection<Feature<Geometry>>;
  private hitLayer_: VectorLayer<VectorSource>;
  private hitTolerance_: number;
  private lastCoordinate_: [number, number] | null = null;
  private dragging_ = false;

  constructor(options: SafeTranslateOptions) {
    super({
      handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent),
    });
    this.features_ = options.features;
    this.hitLayer_ = options.hitDetectionLayer;
    this.hitTolerance_ = options.hitTolerance ?? 5;
  }

  private featureAtPixel_(map: Map, pixel: number[]): Feature<Geometry> | null {
    const hitLayer = this.hitLayer_;
    const found = map.forEachFeatureAtPixel(pixel, (feature) => feature as Feature<Geometry>, {
      hitTolerance: this.hitTolerance_,
      layerFilter: (layer) => layer === hitLayer,
    });
    return found ?? null;
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const map = evt.map;
    const type = evt.type;

    if (type === 'pointerdown') {
      const feature = this.featureAtPixel_(map, evt.pixel);
      if (feature && this.features_.getArray().includes(feature)) {
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