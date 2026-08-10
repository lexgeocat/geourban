import type Map from 'ol/Map.js';
import type BaseLayer from 'ol/layer/Base.js';
import { BASE_MAP_DEFS, type BaseMapId } from '../baseMaps';

export class BaseLayerManager {
  private currentLayer: BaseLayer | null = null;
  private cleanup: (() => void) | null = null;

  install(map: Map, baseMapId: BaseMapId): BaseLayer {
    this.cleanup?.();
    this.cleanup = null;
    if (this.currentLayer) {
      map.removeLayer(this.currentLayer);
      this.currentLayer = null;
    }
    const def = BASE_MAP_DEFS.find((d) => d.id === baseMapId) ?? BASE_MAP_DEFS[0];
    const layer = def.create() as BaseLayer;
    layer.set('__baseMapId', def.id);
    this.currentLayer = layer;
    map.getLayers().insertAt(0, layer);
    if (def.attach) {
      this.cleanup = def.attach(map, layer);
    }
    return layer;
  }

  dispose(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.currentLayer = null;
  }
}
