import { getOrCreateSpatialIndex } from '../spatialIndex';
import type Map from 'ol/Map.js';
import type VectorSource from 'ol/source/Vector.js';
import type VectorLayer from 'ol/layer/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type Polygon from 'ol/geom/Polygon.js';
import type { SnapGuideVisual } from '../advancedSnap';
import type { RoundaboutDrawPreview } from './RoundaboutDrawInteraction';
import type { LassoPreview } from './LassoSelection';
import type { Pt } from '../../geo/math/polygonEngine';
import { StreetPainter } from './painters/StreetPainter';
import { RoundaboutPainter } from './painters/RoundaboutPainter';
import { LabelPainter } from './painters/LabelPainter';
import { SnapGuidePainter } from './painters/SnapGuidePainter';
import { OverlayPainter } from './painters/OverlayPainter';
import { SelectionHighlightPainter } from './painters/SelectionHighlightPainter';
import { recordPostrenderDuration, recordPostrenderSplit } from '../../store/debug/debugCounters';
import { recordGeometrySanitizeEvent } from '../../store/debug/geometryTelemetry';


function getZoomFromResolution(resolution: number): number {
  return Math.log2(156543.03392804097 / resolution);
}


export class PostrenderPainter {
  private readonly map: Map;
  private readonly drawSource: VectorSource;
  private readonly postrenderLayer: VectorLayer<VectorSource>;
  private readonly listener: (event: any) => void;


  private readonly streetPainter: StreetPainter;
  private readonly roundaboutPainter = new RoundaboutPainter();
  private readonly labelPainter = new LabelPainter();
  private readonly snapGuidePainter: SnapGuidePainter;
  private readonly overlayPainter = new OverlayPainter();
  private readonly selectionHighlightPainter = new SelectionHighlightPainter();


  private dirty = true;
  private lastFeatureCount = -1;
  private interacting = false;

  private cachedVisibleFeatures: Array<Feature<Geometry>> | null = null;
  private cachedVisibleKey: string | null = null;


  constructor(opts: { map: Map; drawSource: VectorSource; postrenderLayer: VectorLayer<VectorSource> }) {
    this.map = opts.map;
    this.drawSource = opts.drawSource;
    this.postrenderLayer = opts.postrenderLayer;
    this.snapGuidePainter = new SnapGuidePainter(this.map);
    this.streetPainter = new StreetPainter(() => this.map.render());
    this.selectionHighlightPainter.attach(this.map, () => this.drawSource.getFeatures().length);
 

    const onFeatureChange = () => { this.dirty = true; };
    this.drawSource.on('addfeature', onFeatureChange);
    this.drawSource.on('removefeature', onFeatureChange);
    this.drawSource.on('change', onFeatureChange);
    // Ediciones en vivo (vértices, propiedades de etiqueta) — sin esto el
    // caché de LabelPainter (Fase 4.3) podría quedarse con etiquetas stale.
    this.drawSource.on('changefeature', onFeatureChange);

    this.listener = (event: any) => this.handle(event);
    this.postrenderLayer.on('postrender', this.listener);
    this.trackFullFrame();
  }

  private lastFullFrameAt = 0;
  private fullFrameKey: (() => void) | null = null;

  /** Mide la duración total del frame del mapa (todas las capas, incl. WebGL). */
  private trackFullFrame(): void {
    const onPostrender = () => {
      const now = performance.now();
      if (this.lastFullFrameAt > 0) {
        recordPostrenderSplit('fullFrame', now - this.lastFullFrameAt);
      }
      this.lastFullFrameAt = now;
    };
    this.map.on('postrender', onPostrender);
    this.fullFrameKey = () => this.map.un('postrender', onPostrender);
  }

  invalidate(): void {
    this.dirty = true;
  }


  setInteracting(value: boolean): void {
    if (this.interacting === value) return;
    this.interacting = value;
    this.postrenderLayer.changed();
  }


  setSnapGuide(guide: SnapGuideVisual | null): void {
    this.snapGuidePainter.setGuide(guide);
    this.postrenderLayer.changed();
  }


  setRoundaboutPreview(preview: RoundaboutDrawPreview | null): void {
    this.roundaboutPainter.setPreview(preview);
    this.postrenderLayer.changed();
  }


  setLassoPreview(preview: LassoPreview): void {
    this.overlayPainter.setLassoPreview(preview);
    this.postrenderLayer.changed();
  }


  setSubdivisionPreview(rings: Pt[][] | null): void {
    this.overlayPainter.setSubdivisionPreview(rings);
    this.postrenderLayer.changed();
  }


  private handle(event: any): void {
    const ctx = event.context as CanvasRenderingContext2D | undefined;
    if (!ctx) return;
    const t0 = performance.now();


    const resolution = this.map.getView().getResolution() ?? 1;
    const zoom = getZoomFromResolution(resolution);
    const features = (this.drawSource.getFeatures() ?? []) as Array<Feature<Geometry>>;
    const dataChanged = this.dirty;
    const t1 = performance.now();
    recordPostrenderSplit('prologue', t1 - t0);


    this.updateCaches(ctx, features, zoom, resolution);
    const t2 = performance.now();


    const toPx = (coord: number[]): [number, number] => {
      const px = this.map.getPixelFromCoordinate(coord as [number, number]);
      return px ? [px[0], px[1]] : [0, 0];
    };


    const visibleFeatures = this.getVisibleFeatures(features, dataChanged);
    const t3 = performance.now();

    const size = this.map.getSize();
    const viewportExtent = size ? this.map.getView().calculateExtent(size) : null;

    // antes: this.labelPainter.paint(ctx, visibleFeatures, zoom, resolution, toPx, this.interacting, viewportExtent);
    this.labelPainter.paint(ctx, visibleFeatures, zoom, resolution, toPx, this.interacting, viewportExtent, this.drawSource);
    const t4 = performance.now();
    this.streetPainter.paint(ctx, zoom, resolution, toPx, this.interacting);
    const t5 = performance.now();
    this.roundaboutPainter.paint(ctx, toPx, resolution);
    this.selectionHighlightPainter.paint(ctx, toPx, resolution, this.drawSource);
    this.snapGuidePainter.paint(ctx, resolution);
    this.overlayPainter.paint(ctx, toPx);
    const t6 = performance.now();


    recordPostrenderSplit('updateCaches', t2 - t1);
    recordPostrenderSplit('getVisibleFeatures', t3 - t2);
    recordPostrenderSplit('labels', t4 - t3);
    recordPostrenderSplit('street', t5 - t4);
    recordPostrenderSplit('resto', t6 - t5);
    recordPostrenderDuration(performance.now() - t0);
  }


  private getVisibleFeatures(
    all: Array<Feature<Geometry>>,
    dataChanged: boolean,
  ): Array<Feature<Geometry>> {
    const size = this.map.getSize();
    if (!size) return all;
    const extent = this.map.getView().calculateExtent(size);
    const [minX, minY, maxX, maxY] = extent;
    const marginX = (maxX - minX) * 0.15;
    const marginY = (maxY - minY) * 0.15;
    const px = Math.max((maxX - minX) / size[0], 1e-9);
    const py = Math.max((maxY - minY) / size[1], 1e-9);
    const key =
      `${Math.round(minX / px)},${Math.round(minY / py)},${Math.round(maxX / px)},${Math.round(maxY / py)}` +
      `|${all.length}|${dataChanged ? '1' : '0'}`;
    if (this.cachedVisibleKey === key && this.cachedVisibleFeatures) {
      return this.cachedVisibleFeatures;
    }
    const index = getOrCreateSpatialIndex();
    if (index.size === 0 && all.length > 0) {
      recordGeometrySanitizeEvent('spatialIndex.emptyOnPostrender', { featureCount: all.length });
      if (import.meta.env.DEV) {
        console.warn(
          `PostrenderPainter: índice espacial vacío con ${all.length} feature(s) presentes — reconstruyendo. ` +
          'Esto no debería pasar en uso normal; si se repite, revisar la sincronización addfeature/removefeature/changefeature en Map.tsx.',
        );
      }
      index.load(all as unknown as Feature<Polygon>[]);
    }
    if (index.size === 0) {
      this.cachedVisibleKey = null;
      this.cachedVisibleFeatures = null;
      return all;
    }
    const visible = index.search(minX - marginX, minY - marginY, maxX + marginX, maxY + marginY) as unknown as Array<Feature<Geometry>>;
    this.cachedVisibleKey = key;
    this.cachedVisibleFeatures = visible;
    return visible;
  }


  private updateCaches(ctx: CanvasRenderingContext2D, features: Array<Feature<Geometry>>, zoom: number, resolution: number): void {
    const featuresChanged = features.length !== this.lastFeatureCount;
    this.streetPainter.update(ctx, zoom, this.dirty, resolution);
    this.labelPainter.update(features, featuresChanged || this.dirty);
    this.lastFeatureCount = features.length;
    this.dirty = false;
  }


  dispose(): void {
    this.postrenderLayer.un('postrender', this.listener);
    this.fullFrameKey?.();
    this.streetPainter.dispose();
    this.selectionHighlightPainter.dispose(); // ← agregar
  }
}
