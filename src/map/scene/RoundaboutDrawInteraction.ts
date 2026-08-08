import Interaction from 'ol/interaction/Interaction.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type Map from 'ol/Map.js';

export interface RoundaboutDrawPreview {
  center: number[];
  current: number[];
}

export class RoundaboutDrawInteraction extends Interaction {
  private readonly hostMap: Map;
  private readonly onComplete: (center: number[], radiusM: number) => void;
  private readonly onCancel: () => void;

  private center: number[] | null = null;
  private current: number[] | null = null;
  private dragging = false;

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

  private isPrimaryButton(evt: MapBrowserEvent): boolean {
    const oe = evt.originalEvent;
    return !(oe instanceof MouseEvent) || oe.button === 0;
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const type = evt.type;

    if (type === 'pointerdown') {
      if (!this.isPrimaryButton(evt)) return true;
      this.center = evt.coordinate as number[];
      this.current = this.center;
      this.dragging = true;
      this.hostMap.render();
      return false;
    }

    if ((type === 'pointerdrag' || type === 'pointermove') && this.dragging) {
      this.current = evt.coordinate as number[];
      this.hostMap.render();
      return false;
    }

    if (type === 'pointerup' && this.dragging) {
      const coord = evt.coordinate as number[];
      const center = this.center!;
      const radius = Math.hypot(coord[0] - center[0], coord[1] - center[1]);
      this.center = null;
      this.current = null;
      this.dragging = false;
      this.hostMap.render();
      if (radius < 0.5) this.onCancel();
      else this.onComplete(center, radius);
      return false;
    }

    return true;
  }
}
