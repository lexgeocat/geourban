import Interaction from 'ol/interaction/Interaction.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type Map from 'ol/Map.js';
import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Collection from 'ol/Collection.js';
import BaseEvent from 'ol/events/Event.js';
import { click as clickCondition, pointerMove } from 'ol/events/condition.js';
import { hitTestAtCoordinateAsync } from '../hitTest';

export class HitTestSelectEvent extends BaseEvent {
  selected: Feature<Geometry>[];
  deselected: Feature<Geometry>[];
  originalEvent?: Event;
  constructor(selected: Feature<Geometry>[], deselected: Feature<Geometry>[], originalEvent?: Event) {
    super('select');
    this.selected = selected;
    this.deselected = deselected;
    this.originalEvent = originalEvent;
  }
}

export interface HitTestSelectOptions {
  map: Map;
  source: VectorSource;
  pixelTolerance?: number;
  multi?: boolean;
  filter?: (feature: Feature<Geometry>) => boolean;
  getExtraFeatures?: () => Feature<Geometry>[];
}

export class HitTestSelect extends Interaction {
  private readonly map: Map;
  private readonly source: VectorSource;
  private readonly pixelTolerance: number;
  private readonly multi: boolean;
  private readonly filterFn?: (feature: Feature<Geometry>) => boolean;
  private readonly getExtraFeatures_?: () => Feature<Geometry>[];
  private readonly features_ = new Collection<Feature<Geometry>>();
  private requestSeq_ = 0;

  constructor(options: HitTestSelectOptions) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.map = options.map;
    this.source = options.source;
    this.pixelTolerance = options.pixelTolerance ?? 6;
    this.multi = options.multi ?? false;
    this.filterFn = options.filter;
    this.getExtraFeatures_ = options.getExtraFeatures;
  }

  getFeatures(): Collection<Feature<Geometry>> {
    return this.features_;
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    if (!clickCondition(evt) || pointerMove(evt)) return true;

    const resolution = this.map.getView().getResolution() ?? 1;
    const tolerance = this.pixelTolerance * resolution;
    const coordinate = evt.coordinate;
    const oe = evt.originalEvent as MouseEvent | undefined;
    const additive = this.multi && !!oe?.shiftKey;
    const mySeq = ++this.requestSeq_;

    void hitTestAtCoordinateAsync(coordinate, this.source, {
      tolerance,
      filter: this.filterFn,
      extraFeatures: this.getExtraFeatures_?.(),
    }).then((hit) => {
      if (mySeq !== this.requestSeq_) return;

      const prevArr = this.features_.getArray().slice();
      let selected: Feature<Geometry>[] = [];
      let deselected: Feature<Geometry>[] = [];

      if (!hit) {
        if (prevArr.length === 0) return;
        deselected = prevArr;
        this.features_.clear();
      } else if (additive) {
        if (prevArr.includes(hit)) {
          this.features_.remove(hit);
          deselected = [hit];
        } else {
          this.features_.push(hit);
          selected = [hit];
        }
      } else {
        deselected = prevArr.filter((f) => f !== hit);
        this.features_.clear();
        this.features_.push(hit);
        selected = [hit];
      }

      this.dispatchEvent(new HitTestSelectEvent(selected, deselected, oe));
    });
    return false;
  }
}