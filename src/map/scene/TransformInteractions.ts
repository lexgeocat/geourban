import Interaction from 'ol/interaction/Interaction.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type Map from 'ol/Map.js';

/* ================================================================
   TransformDragInteraction
   ================================================================
   PointerInteraction custom para Fase 3 (Edit Engine):
   - Modo 'rotate' (H): el primer click-down define el pivote/anchor
     en el sistema de coords del mapa; al mover el mouse se calcula
     el ángulo entre anchor→cursor_inicial y anchor→cursor_actual;
     al soltar (pointerup) se envía el resultado al bridge y se sale.
   - Modo 'scale' (K): primer click define el anchor. El factor de
     escala es 1 + dist/50 donde dist es la distancia del anchor al
     cursor. 50 unidades de drag = factor 2.0 (doble tamaño).
     Para achicar, el usuario arrastra "menos" (o a un lado).

   Mantener simple: el usuario puede usar el teclado para valores
   exactos en una versión futura.
   ================================================================ */

export class TransformDragInteraction extends Interaction {
  private hostMap: Map;
  private mode: 'rotate' | 'scale';
  private onComplete: (angleOrFactor: number, anchor: number[]) => void;
  private onCancel: () => void;

  private anchor: number[] | null = null;
  private dragging_ = false;
  /** Snapshot del ángulo/factor "actual" para el preview. */
  private preview_ = { value: 0, anchor: [0, 0] as number[] };

  constructor(options: {
    map: Map;
    mode: 'rotate' | 'scale';
    onComplete: (angleOrFactor: number, anchor: number[]) => void;
    onCancel: () => void;
  }) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.hostMap = options.map;
    this.mode = options.mode;
    this.onComplete = options.onComplete;
    this.onCancel = options.onCancel;
  }

  /** Llamado por el InteractionModeController para mostrar la preview
   *  (línea pivote→cursor, ángulo, etc.) en el postrender. */
  getPreview(): { value: number; anchor: number[]; mode: 'rotate' | 'scale' } | null {
    if (!this.anchor) return null;
    return { value: this.preview_.value, anchor: this.anchor, mode: this.mode };
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const type = evt.type;
    if (type === 'pointerdown') {
      this.anchor = evt.coordinate as number[];
      this.dragging_ = true;
      this.preview_ = { value: 0, anchor: this.anchor };
      this.hostMap.getViewport().style.cursor = 'crosshair';
      return false; // empezamos drag
    }
    if (type === 'pointermove' && this.dragging_ && this.anchor) {
      const cur = evt.coordinate as number[];
      const dx = cur[0] - this.anchor[0];
      const dy = cur[1] - this.anchor[1];
      if (this.mode === 'rotate') {
        const ang = Math.atan2(dy, dx);
        this.preview_ = { value: ang, anchor: this.anchor };
      } else {
        // scale: factor = 1.0 + dist/50 (en coords del mapa = 50m en 3857)
        const dist = Math.hypot(dx, dy);
        this.preview_ = { value: 1 + dist / 50, anchor: this.anchor };
      }
      this.hostMap.render();
      return false;
    }
    if (type === 'pointerup' && this.dragging_ && this.anchor) {
      this.dragging_ = false;
      const value = this.preview_.value;
      const anchor = this.anchor;
      this.anchor = null;
      this.hostMap.getViewport().style.cursor = '';
      this.hostMap.render();
      this.onComplete(value, anchor);
      return false;
    }
    if (type === 'pointercancel' || (type === 'pointerup' && !this.dragging_)) {
      if (this.anchor) this.onCancel();
      this.anchor = null;
      this.dragging_ = false;
      this.hostMap.getViewport().style.cursor = '';
      return false;
    }
    return true;
  }
}

/* ================================================================
   TransformClickInteraction
   ================================================================
   Para Mirror (M): 2 clicks definen el eje de reflexión. No hay drag.
   El primer click fija `a`, el segundo fija `b`, y al confirmarse
   se llama onComplete(a, b).
   ================================================================ */

export class TransformClickInteraction extends Interaction {
  private hostMap: Map;
  private onComplete: (a: number[], b: number[]) => void;
  private onCancel: () => void;
  private firstPoint: number[] | null = null;

  constructor(options: {
    map: Map;
    onComplete: (a: number[], b: number[]) => void;
    onCancel: () => void;
  }) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.hostMap = options.map;
    this.onComplete = options.onComplete;
    this.onCancel = options.onCancel;
  }

  getFirstPoint(): number[] | null {
    return this.firstPoint;
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const type = evt.type;
    // pointermove: muestra preview de la línea del primer punto al cursor
    if (type === 'pointermove' && this.firstPoint) {
      this.hostMap.render();
      return false;
    }
    if (type === 'click' || type === 'singleclick') {
      if (this.firstPoint == null) {
        this.firstPoint = evt.coordinate as number[];
        this.hostMap.render();
        return false;
      }
      const a = this.firstPoint;
      const b = evt.coordinate as number[];
      this.firstPoint = null;
      this.hostMap.render();
      this.onComplete(a, b);
      return false;
    }
    return true;
  }
}
