import type Map from 'ol/Map.js';
import type VectorSource from 'ol/source/Vector.js';
import type VectorLayer from 'ol/layer/Vector.js';
import type Draw from 'ol/interaction/Draw.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { PostrenderPainter } from '../PostrenderPainter';
import type { SpatialIndex } from '../../spatialIndex';
import type { HitTestSelect } from '../HitTestSelect';

/** Fase 5 (sistema de capas): ya no es necesariamente un único
 *  WebGLVectorLayer — puede ser un `LayeredWebglRenderer` (N capas
 *  espejo, una por capa del registro) capaz de refrescarse entero. Los
 *  módulos de modo solo necesitan poder pedir un repaint, nunca tocan
 *  la(s) capa(s) directamente. */
export interface RefreshableDrawLayer {
  changed(): void;
}

export interface ModeContext {
  map: Map;
  drawSource: VectorSource;
  drawLayer: RefreshableDrawLayer;
  streetLayer: VectorLayer<VectorSource>;
  streetSource: VectorSource;
  postrenderPainter?: PostrenderPainter;
  spatialIndex: SpatialIndex;
  highlightSource: VectorSource;
  highlightLayer: VectorLayer<VectorSource>;
  /** Draw activo (si el modo usa `ol/interaction/Draw`) — lo lee
   *  SnapEngine para calcular el anchor del snap. */
  activeDrawRef: { current: Draw | null };
  /** El HitTestSelect activo del submodo select — edit lo reutiliza. */
  selectInteractionRef: { current: HitTestSelect | null };
  /** Registra una función de limpieza a ejecutar al salir del modo. */
  addCleanup: (fn: () => void) => void;
  refreshLayers: () => void;
  isLayerLocked: (f: Feature<Geometry>) => boolean;
}