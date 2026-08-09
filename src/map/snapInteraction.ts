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

/** Eventos que "confirman" una acción: siempre recalculan el snap en
 *  fresco, porque son mucho menos frecuentes que pointermove/pointerdrag
 *  y ahí sí importa la precisión exacta. */
const SNAP_COMMIT_EVENT_TYPES = new Set(['pointerdown', 'pointerup', 'click', 'singleclick']);

/** Cada cuánto (ms) se recalcula el snap completo durante pointermove/drag.
 *  Antes se recalculaba en CADA evento crudo de pointermove (que dispara
 *  mucho más seguido que el refresco de pantalla), lo cual era la causa
 *  principal del lag con snap activo. Entre recálculos se reutiliza el
 *  último resultado mientras el cursor siga dentro de su radio de captura. */
const SNAP_COMPUTE_THROTTLE_MS = 32;

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
  private lastComputeAt = 0;
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

    const tolerancePx = this.opts.pixelTolerance ?? 10;
    const now = performance.now();
    const mustRecompute =
      SNAP_COMMIT_EVENT_TYPES.has(type) || now - this.lastComputeAt >= SNAP_COMPUTE_THROTTLE_MS;

    let result: SnapResult | null;
    if (mustRecompute) {
      const effective = getEffectiveSnapSettings();
      const roadFeatures = getOrCreateRoadSnapSource().getFeatures() as Feature[];
      result = findSnap(evt.coordinate, src, {
        resolution,
        pixelTolerance: tolerancePx,
        spatialIndex: this.opts.spatialIndex,
        enabled: effective,
        previous: this.lastResult,
        anchor: this.opts.getAnchor?.(),
        excludeFeature: this.opts.getExcludeFeature?.(),
        extraFeatures: roadFeatures,
        filter: this.opts.getFilter?.() as
          ((feature: import('ol/Feature.js').default) => boolean) | undefined,
      });
      this.lastComputeAt = now;
      this.lastResult = result;
      this.emitVisualUpdate_(result);
    } else {
      const cached = this.lastResult;
      const baseTolerance = tolerancePx * resolution;
      result =
        cached &&
        Math.hypot(cached.point[0] - evt.coordinate[0], cached.point[1] - evt.coordinate[1]) <
          baseTolerance * 1.5
          ? cached
          : null;
    }

    if (result && this.opts.shouldSnapCoordinate(type)) {
      evt.coordinate = [result.point[0], result.point[1]];
      const px = map.getPixelFromCoordinate(result.point);
      if (px) evt.pixel = px;
    }

    return true;
  }
}
