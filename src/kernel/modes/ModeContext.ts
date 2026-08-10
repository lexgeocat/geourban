import type Map from 'ol/Map.js';
import type VectorSource from 'ol/source/Vector.js';
import type VectorLayer from 'ol/layer/Vector.js';
import type Draw from 'ol/interaction/Draw.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { PostrenderPainter } from '@map-core/scene/PostrenderPainter';
import type { HitTestSelect } from '@selection-engine/interactions/HitTestSelect';

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
  highlightSource: VectorSource;
  highlightLayer: VectorLayer<VectorSource>;
  activeDrawRef: { current: Draw | null };
  selectInteractionRef: { current: HitTestSelect | null };
  addCleanup: (fn: () => void) => void;
  refreshLayers: () => void;
  isLayerLocked: (f: Feature<Geometry>) => boolean;
  isLayerVisible: (f: Feature<Geometry>) => boolean;
}
