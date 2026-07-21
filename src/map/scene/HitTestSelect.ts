import Interaction from 'ol/interaction/Interaction.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type Map from 'ol/Map.js';
import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Collection from 'ol/Collection.js';
import BaseEvent from 'ol/events/Event.js';
import { click as clickCondition, pointerMove } from 'ol/events/condition.js';
import type { SpatialIndex } from '../spatialIndex';
import { hitTestAtCoordinate } from '../hitTest';

/** Evento emitido en cada cambio de selección — mismo shape mínimo
 *  (`selected`/`deselected`) que `ol/interaction/Select`, para que el
 *  código que lo consume no tenga que cambiar de forma drástica. */
export class HitTestSelectEvent extends BaseEvent {
  selected: Feature<Geometry>[];
  deselected: Feature<Geometry>[];
  originalEvent?: Event;
  constructor(selected: Feature<Geometry>[], deselected: Feature<Geometry>[], originalEvent?: Event) {
    super('select');
    this.selected = selected;
    this.deselected = deselected;
    this.originalEvent = originalEvent;
  }
}

export interface HitTestSelectOptions {
  map: Map;
  source: VectorSource;
  spatialIndex: SpatialIndex;
  /** Tolerancia de hit-test en píxeles (se multiplica por la resolución
   *  vigente en cada evento). */
  pixelTolerance?: number;
  /** true: shift+click agrega/quita de la selección. false: cada click
   *  reemplaza (single-select), sin importar shift. */
  multi?: boolean;
  filter?: (feature: Feature<Geometry>) => boolean;
}

/**
 * Reemplazo de `ol/interaction/Select` que NO depende de una capa de
 * render para hacer hit-testing (ver diagnóstico H2). Antes, tanto
 * `Select` como `SafeTranslate` necesitaban `measurementLayer` — una
 * capa Canvas2D invisible clonando el mismo VectorSource del WebGL
 * layer, solo para que `forEachFeatureAtPixel` tuviera dónde buscar (y
 * de paso quedaba atada, por accidente, a la visibilidad de "Cotas").
 * Acá el hit-test corre contra el índice espacial (RBush) + test exacto
 * de geometría (`hitTest.ts`), sin ningún layer adicional.
 *
 * El resaltado visual de la selección lo maneja el llamador (ver
 * `InteractionModeController` → `highlightLayer`); esta clase no
 * renderiza nada por sí misma.
 */
export class HitTestSelect extends Interaction {
  private readonly map: Map;
  private readonly source: VectorSource;
  private readonly spatialIndex: SpatialIndex;
  private readonly pixelTolerance: number;
  private readonly multi: boolean;
  private readonly filterFn?: (feature: Feature<Geometry>) => boolean;
  private readonly features_ = new Collection<Feature<Geometry>>();

  constructor(options: HitTestSelectOptions) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.map = options.map;
    this.source = options.source;
    this.spatialIndex = options.spatialIndex;
    this.pixelTolerance = options.pixelTolerance ?? 6;
    this.multi = options.multi ?? false;
    this.filterFn = options.filter;
  }

  getFeatures(): Collection<Feature<Geometry>> {
    return this.features_;
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    if (!clickCondition(evt) || pointerMove(evt)) return true;

    const resolution = this.map.getView().getResolution() ?? 1;
    const tolerance = this.pixelTolerance * resolution;
    const hit = hitTestAtCoordinate(evt.coordinate, this.spatialIndex, this.source, {
      tolerance,
      filter: this.filterFn,
    });

    const oe = evt.originalEvent as MouseEvent | undefined;
    const additive = this.multi && !!oe?.shiftKey;
    const prevArr = this.features_.getArray().slice();

    let selected: Feature<Geometry>[] = [];
    let deselected: Feature<Geometry>[] = [];

    if (!hit) {
      if (prevArr.length === 0) return true;
      deselected = prevArr;
      this.features_.clear();
    } else if (additive) {
      if (prevArr.includes(hit)) {
        this.features_.remove(hit);
        deselected = [hit];
      } else {
        this.features_.push(hit);
        selected = [hit];
      }
    } else {
      deselected = prevArr.filter((f) => f !== hit);
      this.features_.clear();
      this.features_.push(hit);
      selected = [hit];
    }

    this.dispatchEvent(new HitTestSelectEvent(selected, deselected, oe));
    return false;
  }
}