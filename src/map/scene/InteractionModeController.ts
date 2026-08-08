import type Map from 'ol/Map.js';
import VectorSource from 'ol/source/Vector.js';
import VectorLayer from 'ol/layer/Vector.js';
import type Draw from 'ol/interaction/Draw.js';
import type { DrawMode } from '../../store/map/drawStore';
import { isFeatureLayerLocked, isFeatureLayerVisible } from '../../core/layerVisibility';
import type { PostrenderPainter } from './PostrenderPainter';
import type { HitTestSelect } from './HitTestSelect';
import type { ModeContext, RefreshableDrawLayer } from './modes/ModeContext';
import { activateSelect } from './modes/SelectEditMode';
import { activateEdit } from './modes/EditMode';
import { activatePolygon } from './modes/PolygonMode';
import { activateLine } from './modes/LineMode';
import { activateRectangle } from './modes/RectangleMode';
import { activateStreet } from './modes/StreetMode';
import { activateRoundabout } from './modes/RoundaboutMode';
import { activateErase } from './modes/EraseMode';
import { activateLabelOrder } from './modes/LabelOrderMode';

export interface InteractionContext {
  map: Map;
  drawSource: VectorSource;
  drawLayer: RefreshableDrawLayer;
  streetLayer: VectorLayer<VectorSource>;
  streetSource: VectorSource;
  postrenderPainter?: PostrenderPainter;
}

export class InteractionModeController {
  private ctx: InteractionContext;
  private toClean: (() => void)[] = [];

  private readonly highlightSource = new VectorSource();
  private readonly highlightLayer: VectorLayer<VectorSource>;

  readonly activeDrawRef: { current: Draw | null } = { current: null };
  private readonly selectInteractionRef: { current: HitTestSelect | null } = { current: null };

  constructor(ctx: InteractionContext) {
    this.ctx = ctx;
    this.highlightLayer = new VectorLayer({ source: this.highlightSource });
    this.ctx.map.addLayer(this.highlightLayer);
  }

  activate(mode: DrawMode): void {
    const { map, drawSource: src, drawLayer } = this.ctx;
    if (!map || !src) return;

    this.cleanup();
    this.highlightSource.clear();
    this.selectInteractionRef.current = null;

    const viewport = map.getViewport();
    const previousCursor = viewport.getAttribute('data-cursor');
    if (mode === 'polygon' || mode === 'line' || mode === 'rectangle' || mode === 'roundabout' || mode === 'labelOrder') {
      viewport.setAttribute('data-cursor', mode);
    } else {
      viewport.removeAttribute('data-cursor');
    }
    this.toClean.push(() => {
      if (previousCursor === null) viewport.removeAttribute('data-cursor');
      else viewport.setAttribute('data-cursor', previousCursor);
    });

    const modeCtx: ModeContext = {
      map,
      drawSource: src,
      drawLayer,
      streetLayer: this.ctx.streetLayer,
      streetSource: this.ctx.streetSource,
      postrenderPainter: this.ctx.postrenderPainter,
      highlightSource: this.highlightSource,
      highlightLayer: this.highlightLayer,
      activeDrawRef: this.activeDrawRef,
      selectInteractionRef: this.selectInteractionRef,
      addCleanup: (fn) => this.toClean.push(fn),
      refreshLayers: () => drawLayer?.changed(),
      isLayerLocked: isFeatureLayerLocked,
      isLayerVisible: isFeatureLayerVisible,
    };

    switch (mode) {
      case 'select':
        activateSelect(modeCtx);
        break;
      case 'edit': {
        const select = activateSelect(modeCtx);
        activateEdit(modeCtx, select);
        break;
      }
      case 'polygon':
        activatePolygon(modeCtx);
        break;
      case 'line':
        activateLine(modeCtx);
        break;
      case 'rectangle':
        activateRectangle(modeCtx);
        break;
      case 'street':
        activateStreet(modeCtx);
        break;
      case 'roundabout':
        activateRoundabout(modeCtx);
        break;
      case 'erase':
        activateErase(modeCtx);
        break;
      case 'labelOrder':
        activateLabelOrder(modeCtx);
        break;
      case 'none':
        break;
    }
  }

  getActiveDraw(): Draw | null {
    return this.activeDrawRef.current;
  }

  private cleanup(): void {
    this.toClean.forEach((fn) => fn());
    this.toClean = [];
  }

  dispose(): void {
    this.cleanup();
    this.selectInteractionRef.current = null;
    this.activeDrawRef.current = null;
    this.ctx.map.removeLayer(this.highlightLayer);
  }
}