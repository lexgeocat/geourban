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
import { getEffectiveSnapSettings } from '../store/snapSettingsStore';
import { useSnapLiveStore } from '../store/snapStateStore';

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
  pixelTolerance?: number;
  onResultChange?: (result: SnapResult | null) => void;
  onGuideChange?: (guide: SnapGuideVisual | null) => void;
}

export default class SnapEngine extends Interaction {
  private opts: SnapEngineOptions;
  private lastResult: SnapResult | null = null;

  constructor(opts: SnapEngineOptions) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.opts = opts;
  }

  getLastResult(): SnapResult | null {
    return this.lastResult;
  }

  private clear_() {
    if (this.lastResult !== null) {
      this.lastResult = null;
      useSnapLiveStore.getState().setActive(null);
      this.opts.onResultChange?.(null);
      this.opts.onGuideChange?.(null);
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

    // 1) Snap de máxima prioridad (cierre de polígono contra el primer vértice)
    const priorityPoint = this.opts.getPriorityTarget?.(evt.coordinate);
    if (priorityPoint) {
      if (this.opts.shouldSnapCoordinate(type)) {
        evt.coordinate = [priorityPoint[0], priorityPoint[1]];
        const px = map.getPixelFromCoordinate(priorityPoint);
        if (px) evt.pixel = px;
      }
      return true;
    }

    // 2) Snap general (endpoint/midpoint/intersección/perpendicular/paralelo/extensión)
    const effective = getEffectiveSnapSettings();
    const result = findSnap(evt.coordinate, src, {
      resolution,
      pixelTolerance: this.opts.pixelTolerance ?? 10,
      spatialIndex: this.opts.spatialIndex,
      enabled: effective,
      previous: this.lastResult,
      anchor: this.opts.getAnchor?.(),
      excludeFeature: this.opts.getExcludeFeature?.(),
    });

    this.lastResult = result;
    useSnapLiveStore.getState().setActive(result);
    this.opts.onResultChange?.(result);
    this.opts.onGuideChange?.(result?.guide ?? null);

    // 3) Imán: corrige coordinate/pixel del evento REAL (incluye pointerup,
    //    que es el que Draw usa para fijar el vértice definitivo)
    if (result && this.opts.shouldSnapCoordinate(type)) {
      evt.coordinate = [result.point[0], result.point[1]];
      const px = map.getPixelFromCoordinate(result.point);
      if (px) evt.pixel = px;
    }

    return true;
  }
}