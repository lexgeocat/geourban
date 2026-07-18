import type Map from 'ol/Map.js';
import type BaseLayer from 'ol/layer/Base.js';
import { BASE_MAP_DEFS, type BaseMapId } from '../baseMaps';

/**
 * Encapsula la creación/cambio/limpieza del mapa base (raster).
 *
 * Responsabilidad única: dado un `baseMapId` y un `ol/Map`, instala la
 * capa raster correspondiente, devuelve un cleanup callback y permite
 * cambiarla en caliente.
 */
export class BaseLayerManager {
  private currentLayer: BaseLayer | null = null;
  private cleanup: (() => void) | null = null;

  /** Id del mapa base actualmente instalado. */
  getCurrentId(): BaseMapId | null {
    return this.currentLayer ? this.getIdOf(this.currentLayer) : null;
  }

  private getIdOf(layer: BaseLayer): BaseMapId | null {
    for (const def of BASE_MAP_DEFS) {
      if (def.id === (layer.get('__baseMapId') as string)) return def.id;
    }
    return null;
  }

  /**
   * Instala el mapa base en el map. Devuelve la layer creada.
   * Si ya había una, la reemplaza.
   */
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

  /** Libera la capa y los listeners. Llamar en unmount. */
  dispose(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.currentLayer = null;
  }
}
