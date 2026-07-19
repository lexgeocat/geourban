// src/map/scene/RoundaboutDrawInteraction.ts
import Interaction from 'ol/interaction/Interaction.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type Map from 'ol/Map.js';

export interface RoundaboutDrawPreview {
  center: number[];
  current: number[];
}

/**
 * Traza una rotonda con 2 clics: el primero fija el centro, el segundo fija
 * el radio (distancia al punto). Expone `getPreview()` para que el
 * postrender pinte el radio en vivo — mismo patrón "click, mover, click"
 * que TransformClickInteraction, con preview propio.
 */
export class RoundaboutDrawInteraction extends Interaction {
  private readonly hostMap: Map;
  private readonly onComplete: (center: number[], radiusM: number) => void;
  private readonly onCancel: () => void;

  private center: number[] | null = null;
  private current: number[] | null = null;

  constructor(options: {
    map: Map;
    onComplete: (center: number[], radiusM: number) => void;
    onCancel: () => void;
  }) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.hostMap = options.map;
    this.onComplete = options.onComplete;
    this.onCancel = options.onCancel;
  }

  getPreview(): RoundaboutDrawPreview | null {
    if (!this.center) return null;
    return { center: this.center, current: this.current ?? this.center };
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const type = evt.type;

    if (type === 'pointermove' && this.center) {
      this.current = evt.coordinate as number[];
      this.hostMap.render();
      return false;
    }

    if (type === 'click' || type === 'singleclick') {
      const coord = evt.coordinate as number[];
      if (!this.center) {
        this.center = coord;
        this.current = coord;
        this.hostMap.render();
        return false;
      }
      const radius = Math.hypot(coord[0] - this.center[0], coord[1] - this.center[1]);
      const center = this.center;
      this.center = null;
      this.current = null;
      this.hostMap.render();
      if (radius < 0.5) this.onCancel();
      else this.onComplete(center, radius);
      return false;
    }

    return true;
  }
}