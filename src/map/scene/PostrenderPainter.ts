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
import { recordPostrenderDuration } from '../../store/debug/debugCounters';
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


  constructor(opts: { map: Map; drawSource: VectorSource; postrenderLayer: VectorLayer<VectorSource> }) {
    this.map = opts.map;
    this.drawSource = opts.drawSource;
    this.postrenderLayer = opts.postrenderLayer;
    this.snapGuidePainter = new SnapGuidePainter(this.map);
    this.streetPainter = new StreetPainter(() => this.map.render());
    this.selectionHighlightPainter.attach(this.map); // ← agregar

    const onFeatureChange = () => { this.dirty = true; };
    this.drawSource.on('addfeature', onFeatureChange);
    this.drawSource.on('removefeature', onFeatureChange);
    this.drawSource.on('change', onFeatureChange);

    this.listener = (event: any) => this.handle(event);
    this.postrenderLayer.on('postrender', this.listener);
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


    this.updateCaches(ctx, features, zoom, resolution);


    const toPx = (coord: number[]): [number, number] => {
      const px = this.map.getPixelFromCoordinate(coord as [number, number]);
      return px ? [px[0], px[1]] : [0, 0];
    };


    const visibleFeatures = this.getVisibleFeatures(features);


    this.labelPainter.paint(ctx, visibleFeatures, zoom, resolution, toPx, this.interacting);
    this.streetPainter.paint(ctx, zoom, resolution, toPx, this.interacting);
    this.roundaboutPainter.paint(ctx, toPx, resolution);
    this.selectionHighlightPainter.paint(ctx, toPx, resolution, this.drawSource);
    this.snapGuidePainter.paint(ctx, resolution);
    this.overlayPainter.paint(ctx, toPx);


    recordPostrenderDuration(performance.now() - t0);
  }


  private getVisibleFeatures(all: Array<Feature<Geometry>>): Array<Feature<Geometry>> {
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
    if (index.size === 0) return all;
    const size = this.map.getSize();
    if (!size) return all;
    const extent = this.map.getView().calculateExtent(size);
    const [minX, minY, maxX, maxY] = extent;
    const marginX = (maxX - minX) * 0.15;
    const marginY = (maxY - minY) * 0.15;
    return index.search(minX - marginX, minY - marginY, maxX + marginX, maxY + marginY) as unknown as Array<Feature<Geometry>>;
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
    this.streetPainter.dispose();
    this.selectionHighlightPainter.dispose(); // ← agregar
  }
}
