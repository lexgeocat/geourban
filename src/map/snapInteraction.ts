import Interaction from 'ol/interaction/Interaction.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import {
  findSnap,
  type SnapResult,
  type SnapGuideVisual,
  type SpatialIndexLike,
} from './advancedSnap';
import { getEffectiveSnapSettings } from '../store/map/snapSettingsStore';
import { useSnapLiveStore } from '../store/map/snapLiveStore';
import { rafThrottle } from '../utils/rafThrottle';
import { getOrCreateRoadSnapSource } from './roadSnapSource';

const SNAP_COORD_EVENT_TYPES = new Set([
  'pointermove',
  'pointerdrag',
  'pointerdown',
  'pointerup',
  'click',
  'singleclick',
]);

export interface SnapEngineOptions {
  getSource: () => VectorSource | null;
  spatialIndex?: SpatialIndexLike;
  getEnabled?: () => boolean;
  shouldSnapCoordinate: (eventType: string) => boolean;
  getAnchor?: () => number[] | undefined;
  getExcludeFeature?: () => Feature<Geometry> | undefined;
  getPriorityTarget?: (coordinate: number[]) => number[] | null;
  getFilter?: () => (feature: Feature<Geometry>) => boolean;
  pixelTolerance?: number;
  onResultChange?: (result: SnapResult | null) => void;
  onGuideChange?: (guide: SnapGuideVisual | null) => void;
}

export default class SnapEngine extends Interaction {
  private opts: SnapEngineOptions;
  private lastResult: SnapResult | null = null;
  private readonly emitVisualUpdate_: (result: SnapResult | null) => void;

  constructor(opts: SnapEngineOptions) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.opts = opts;
    this.emitVisualUpdate_ = rafThrottle((result: SnapResult | null) => {
      useSnapLiveStore.getState().setActive(result);
      this.opts.onResultChange?.(result);
      this.opts.onGuideChange?.(result?.guide ?? null);
    });
  }

  getLastResult(): SnapResult | null {
    return this.lastResult;
  }

  private clear_() {
    if (this.lastResult !== null) {
      this.lastResult = null;
      this.emitVisualUpdate_(null);
    }
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const type = evt.type;
    if (!SNAP_COORD_EVENT_TYPES.has(type)) return true;

    const enabled = this.opts.getEnabled ? this.opts.getEnabled() : true;
    const src = this.opts.getSource();
    if (!enabled || !src) {
      this.clear_();
      return true;
    }

    const map = evt.map;
    const resolution = map.getView().getResolution() ?? 1;

    const priorityPoint = this.opts.getPriorityTarget?.(evt.coordinate);
    if (priorityPoint) {
      if (this.opts.shouldSnapCoordinate(type)) {
        evt.coordinate = [priorityPoint[0], priorityPoint[1]];
        const px = map.getPixelFromCoordinate(priorityPoint);
        if (px) evt.pixel = px;
      }
      return true;
    }

    const effective = getEffectiveSnapSettings();
    const roadFeatures = getOrCreateRoadSnapSource().getFeatures() as Feature[];
    const result = findSnap(evt.coordinate, src, {
      resolution,
      pixelTolerance: this.opts.pixelTolerance ?? 10,
      spatialIndex: this.opts.spatialIndex,
      enabled: effective,
      previous: this.lastResult,
      anchor: this.opts.getAnchor?.(),
      excludeFeature: this.opts.getExcludeFeature?.(),
      extraFeatures: roadFeatures,
      filter: this.opts.getFilter?.() as ((feature: import('ol/Feature.js').default) => boolean) | undefined,
    });

    this.lastResult = result;
    this.emitVisualUpdate_(result);
    if (result && this.opts.shouldSnapCoordinate(type)) {
      evt.coordinate = [result.point[0], result.point[1]];
      const px = map.getPixelFromCoordinate(result.point);
      if (px) evt.pixel = px;
    }

    return true;
  }
}