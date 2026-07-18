import Interaction from 'ol/interaction/Interaction.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type Map from 'ol/Map.js';

export type LassoMode = 'rect' | 'lasso';

export type LassoPreview =
  | { mode: 'rect'; start: number[]; current: number[] }
  | { mode: 'lasso'; points: number[][]; current: number[] | null }
  | null;

export class LassoSelection extends Interaction {
  private hostMap: Map;
  private mode: LassoMode;
  private onComplete: (result:
    | { kind: 'rect'; extent: [number, number, number, number] }
    | { kind: 'lasso'; polygon: number[][] },
  ) => void;
  private onCancel: () => void;

  private anchor: number[] | null = null;
  private lassoPoints: number[][] = [];
  private dragging_ = false;
  /** Último current point para el preview. */
  private current_: number[] | null = null;

  private static readonly MIN_DRAG_PX = 3;

  constructor(options: {
    map: Map;
    mode: LassoMode;
    onComplete: (result:
      | { kind: 'rect'; extent: [number, number, number, number] }
      | { kind: 'lasso'; polygon: number[][] },
    ) => void;
    onCancel: () => void;
  }) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.hostMap = options.map;
    this.mode = options.mode;
    this.onComplete = options.onComplete;
    this.onCancel = options.onCancel;
  }

  /** Snapshot del preview actual (para PostrenderPainter). */
  getPreview(): LassoPreview {
    if (!this.dragging_ || !this.anchor) return null;
    if (this.mode === 'rect') {
      return { mode: 'rect', start: this.anchor, current: this.current_ ?? this.anchor };
    }
    return { mode: 'lasso', points: this.lassoPoints, current: this.current_ };
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const type = evt.type;
    if (type === 'pointerdown') {
      const coord = evt.coordinate as number[];
      this.anchor = coord;
      this.current_ = coord;
      this.lassoPoints = this.mode === 'lasso' ? [coord] : [];
      this.dragging_ = true;
      this.hostMap.getViewport().style.cursor = 'crosshair';
      this.hostMap.render();
      return false; // empezamos drag
    }
    if (type === 'pointermove' && this.dragging_ && this.anchor) {
      const cur = evt.coordinate as number[];
      this.current_ = cur;
      if (this.mode === 'lasso') {
        // Sample point only if moved at least a few pixels from last
        const last = this.lassoPoints[this.lassoPoints.length - 1];
        if (last) {
          const lastPx = this.hostMap.getPixelFromCoordinate(last as [number, number]);
          const curPx = this.hostMap.getPixelFromCoordinate(cur as [number, number]);
          if (lastPx && curPx) {
            const dpx = Math.hypot(curPx[0] - lastPx[0], curPx[1] - lastPx[1]);
            if (dpx >= LassoSelection.MIN_DRAG_PX) {
              this.lassoPoints.push(cur);
            }
          }
        } else {
          this.lassoPoints.push(cur);
        }
      }
      this.hostMap.render();
      return false;
    }
    if (type === 'pointerup' && this.dragging_ && this.anchor) {
      this.dragging_ = false;
      const start = this.anchor;
      const end = this.current_ ?? start;
      this.anchor = null;
      this.current_ = null;
      this.hostMap.getViewport().style.cursor = '';
      this.hostMap.render();

      if (this.mode === 'rect') {
        const extent: [number, number, number, number] = [
          Math.min(start[0], end[0]),
          Math.min(start[1], end[1]),
          Math.max(start[0], end[0]),
          Math.max(start[1], end[1]),
        ];
        // Si el rectángulo es demasiado pequeño, lo tratamos como cancel
        const minPx = 4;
        const sp = this.hostMap.getPixelFromCoordinate(start as [number, number]);
        const ep = this.hostMap.getPixelFromCoordinate(end as [number, number]);
        if (!sp || !ep || Math.hypot(sp[0] - ep[0], sp[1] - ep[1]) < minPx) {
          this.lassoPoints = [];
          this.onCancel();
          return false;
        }
        this.lassoPoints = [];
        this.onComplete({ kind: 'rect', extent });
        return false;
      }

      // lasso: necesitamos al menos 3 puntos para formar un polígono
      const poly = this.lassoPoints.slice();
      // Cerramos el polígono con el último current si no está
      if (poly.length > 0) {
        const last = poly[poly.length - 1];
        if (!last || last[0] !== end[0] || last[1] !== end[1]) poly.push(end);
      }
      this.lassoPoints = [];
      if (poly.length < 3) {
        this.onCancel();
        return false;
      }
      this.onComplete({ kind: 'lasso', polygon: poly });
      return false;
    }
    if (type === 'pointercancel' || (type === 'pointerup' && !this.dragging_)) {
      if (this.anchor) this.onCancel();
      this.anchor = null;
      this.current_ = null;
      this.lassoPoints = [];
      this.dragging_ = false;
      this.hostMap.getViewport().style.cursor = '';
      this.hostMap.render();
      return false;
    }
    return true;
  }
}
