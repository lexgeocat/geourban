import Interaction from 'ol/interaction/Interaction.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import {
  findSnap,
  pickBetterSnap,
  type SnapResult,
  type SnapGuideVisual,
  type SpatialIndexLike,
} from './advancedSnap';
import { findGridSnap } from './gridSnap';
import { getEffectiveSnapSettings } from '../store/snapSettingsStore';
import { useSnapLiveStore } from '../store/snapStateStore';

const SNAP_COORD_EVENT_TYPES = new Set([
  'pointermove',
  'pointerdrag',
  'pointerdown',
  'click',
  'singleclick',
]);

export interface SnapEngineOptions {
  /** Fuente donde buscar geometrías candidatas a snap (drawSource). */
  getSource: () => VectorSource | null;
  spatialIndex?: SpatialIndexLike;
  getGridOrigin: () => [number, number];
  /** false => no evalúa nada (ej. modo 'erase'); limpia el indicador. */
  getEnabled?: () => boolean;
  /**
   * true => esta interacción IMANTA el evento real (sobreescribe
   * evt.coordinate/evt.pixel) para el tipo de evento dado. Cualquier
   * interacción agregada ANTES que esta (Draw/Modify/Translate/Select)
   * recibe la coordenada ya corregida.
   * false => solo se actualiza el indicador visual; el evento no se
   * toca (p.ej. clicks de selección en modo 'select').
   */
  shouldSnapCoordinate: (eventType: string) => boolean;
  /** Punto anterior del trazo activo, para perpendicular/paralelo. */
  getAnchor?: () => number[] | undefined;
  /** Feature a excluir (ej. la que se está editando). */
  getExcludeFeature?: () => Feature<Geometry> | undefined;
  /**
   * Snap de máxima prioridad (ej. cerrar polígono contra el primer
   * vértice). Si devuelve un punto, gana por sobre cualquier otro
   * candidato y no dispara el indicador circular.
   */
  getPriorityTarget?: (coordinate: number[]) => number[] | null;
  pixelTolerance?: number;
  onResultChange?: (result: SnapResult | null) => void;
  onGuideChange?: (guide: SnapGuideVisual | null) => void;
}

/**
 * SnapEngine — motor de snap unificado (endpoint/midpoint/intersección/
 * perpendicular/paralelo/extensión/grilla) implementado como
 * `ol/interaction/Interaction`.
 *
 * A diferencia del enfoque anterior (mutar solo la geometría del sketch
 * de Draw dentro de un `map.on('pointermove', ...)`), esta interacción
 * corrige DIRECTAMENTE `evt.coordinate` / `evt.pixel` — el mismo
 * mecanismo que usa `ol/interaction/Snap`. Es indispensable porque
 * Draw/Modify/Translate leen `evt.coordinate` tanto para el preview
 * (pointermove) COMO para el click/pointerup que confirma el vértice
 * final. Mutar solo el sketch arreglaba el preview visual, pero el
 * click real seguía usando la coordenada cruda del mouse — el vértice
 * quedaba "cerca pero no exacto" del punto de snap mostrado.
 *
 * IMPORTANTE — orden de interacciones: OpenLayers despacha eventos de
 * la ÚLTIMA interacción agregada hacia la PRIMERA. Para que SnapEngine
 * alcance a corregir la coordenada ANTES que Draw/Modify/Translate la
 * usen, debe agregarse al mapa DESPUÉS de esas interacciones (en
 * Map.tsx se remueve y se vuelve a agregar al final de cada
 * reconfiguración de modo, para quedar siempre última).
 */
export default class SnapEngine extends Interaction {
  private opts: SnapEngineOptions;
  private lastResult: SnapResult | null = null;

  constructor(opts: SnapEngineOptions) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.opts = opts;
  }

  getLastResult(): SnapResult | null {
    return this.lastResult;
  }

  private clear_() {
    if (this.lastResult !== null) {
      this.lastResult = null;
      useSnapLiveStore.getState().setActive(null);
      this.opts.onResultChange?.(null);
      this.opts.onGuideChange?.(null);
    }
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const type = evt.type;
    if (!SNAP_COORD_EVENT_TYPES.has(type)) return true;

    const enabled = this.opts.getEnabled ? this.opts.getEnabled() : true;
    const src = this.opts.getSource();
    if (!enabled || !src) {
      this.clear_();
      return true;
    }

    const map = evt.map;
    const resolution = map.getView().getResolution() ?? 1;

    // 1) Snap de máxima prioridad (ej. cierre de polígono contra el
    //    primer vértice). Gana siempre; no pasa por el indicador circular.
    const priorityPoint = this.opts.getPriorityTarget?.(evt.coordinate);
    if (priorityPoint) {
      if (this.opts.shouldSnapCoordinate(type)) {
        evt.coordinate = [priorityPoint[0], priorityPoint[1]];
        const px = map.getPixelFromCoordinate(priorityPoint);
        if (px) evt.pixel = px;
      }
      return true;
    }

    // 2) Snap general (endpoint/midpoint/intersección/perpendicular/
    //    paralelo/extensión) + snap a grilla.
    const effective = getEffectiveSnapSettings();
    let result = findSnap(evt.coordinate, src, {
      resolution,
      pixelTolerance: this.opts.pixelTolerance ?? 10,
      spatialIndex: this.opts.spatialIndex,
      enabled: effective,
      previous: this.lastResult,
      anchor: this.opts.getAnchor?.(),
      excludeFeature: this.opts.getExcludeFeature?.(),
    });

    if (effective.grid !== false) {
      const gridResult = findGridSnap(evt.coordinate, {
        resolution,
        pixelTolerance: 12,
        origin: this.opts.getGridOrigin(),
      });
      result = pickBetterSnap(result, gridResult);
    }

    this.lastResult = result;
    useSnapLiveStore.getState().setActive(result);
    this.opts.onResultChange?.(result);
    this.opts.onGuideChange?.(result?.guide ?? null);

    // 3) Imán: si corresponde imantar este tipo de evento en el modo
    //    actual, pisamos coordinate/pixel — Draw/Modify/Translate
    //    (agregados ANTES que esta interacción) ven el punto ya
    //    corregido, tanto en preview como en el click de confirmación.
    if (result && this.opts.shouldSnapCoordinate(type)) {
      evt.coordinate = [result.point[0], result.point[1]];
      const px = map.getPixelFromCoordinate(result.point);
      if (px) evt.pixel = px;
    }

    return true;
  }
}