import Interaction from 'ol/interaction/Interaction.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type Map from 'ol/Map.js';
import VectorSource from 'ol/source/Vector.js';
import VectorLayer from 'ol/layer/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style.js';
import { useManzanoStore } from '../../store/manzanoStore';

const HIT_TOLERANCE_PX = 14;

export class RotateLotsInteraction extends Interaction {
  private readonly hostMap: Map;
  private readonly onComplete: (id: string | number, dir: { ax: number; ay: number }) => void;
  private tempSource: VectorSource | null = null;
  private tempLayer: VectorLayer<VectorSource> | null = null;
  private unsubscribe: (() => void) | null = null;
  private dragging = false;

  constructor(map: Map, onComplete: (id: string | number, dir: { ax: number; ay: number }) => void) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.hostMap = map;
    this.onComplete = onComplete;
  }

  install(): () => void {
    const source = new VectorSource();
    this.tempSource = source;
    const layer = new VectorLayer({
      source,
      zIndex: 999,
      style: (feature) => {
        const role = feature.get('role') as string;
        if (role === 'handle') {
          return new Style({
            image: new CircleStyle({
              radius: 7,
              fill: new Fill({ color: '#f1c40f' }),
              stroke: new Stroke({ color: '#e74c3c', width: 1.5 }),
            }),
          });
        }
        if (role === 'anchor') {
          return new Style({
            image: new CircleStyle({
              radius: 5,
              fill: new Fill({ color: '#27ae60' }),
              stroke: new Stroke({ color: '#fff', width: 1.5 }),
            }),
          });
        }
        return new Style({
          stroke: new Stroke({ color: '#27ae60', width: 1.5, lineDash: [6, 4] }),
        });
      },
    });
    this.tempLayer = layer;
    this.hostMap.addLayer(layer);
    this.unsubscribe = useManzanoStore.subscribe((state) => {
      this.syncGizmo(state.rotateAnchor, state.rotateHandle);
    });
    const initial = useManzanoStore.getState();
    this.syncGizmo(initial.rotateAnchor, initial.rotateHandle);
    return () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.hostMap.removeLayer(layer);
      this.tempSource = null;
      this.tempLayer = null;
    };
  }

  private syncGizmo(anchor: [number, number] | null, handle: [number, number] | null): void {
    const source = this.tempSource;
    if (!source) return;
    source.clear();
    if (!anchor || !handle) {
      this.hostMap.render();
      return;
    }
    const line = new Feature({ geometry: new LineString([anchor, handle]) });
    line.set('role', 'line');
    const anchorFeat = new Feature({ geometry: new Point(anchor) });
    anchorFeat.set('role', 'anchor');
    const handleFeat = new Feature({ geometry: new Point(handle) });
    handleFeat.set('role', 'handle');
    source.addFeatures([line, anchorFeat, handleFeat]);
    this.hostMap.render();
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const state = useManzanoStore.getState();
    if (state.rotatingId == null || !state.rotateAnchor) return true;
    const type = evt.type;
    if (type === 'pointerdown') {
      const handle = state.rotateHandle;
      if (handle) {
        const handlePx = this.hostMap.getPixelFromCoordinate(handle);
        if (handlePx && Math.hypot(handlePx[0] - evt.pixel[0], handlePx[1] - evt.pixel[1]) <= HIT_TOLERANCE_PX) {
          this.dragging = true;
          return false;
        }
      }
      return true;
    }
    if (type === 'pointermove' && this.dragging) {
      useManzanoStore.getState().updateRotateHandle(evt.coordinate as [number, number]);
      return false;
    }
    if (type === 'pointerup' && this.dragging) {
      this.dragging = false;
      const result = useManzanoStore.getState().finishRotateLots();
      if (result) this.onComplete(result.id, result.dir);
      return false;
    }
    return true;
  }
}
