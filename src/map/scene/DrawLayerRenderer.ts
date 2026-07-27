import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import type BaseLayer from 'ol/layer/Base.js';
import type Map from 'ol/Map.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { Layer } from '../../core/objectModel';
import { MZN_COLORS, MZN_COLOR_COUNT } from '../../geo/manzanoColor';

export type WorkVisibility = {
  lots: boolean;
  streets: boolean;
  /** Ya no controla ninguna capa de render (ver nota en DrawLayers más
   *  abajo); se mantiene el campo para no romper el store/ribbon. */
  measurements: boolean;
};

export const MZN_COLORS_22 = MZN_COLORS.map((c) => withAlpha(c, 0.13));
export const MZN_COLORS_STR: readonly string[] = MZN_COLORS;

export interface DrawLayers {
  webglRenderer: LayeredWebglRenderer;
  streetLayer: VectorLayer<VectorSource>;
  postrenderLayer: VectorLayer<VectorSource>;
  source: VectorSource;
  streetSource: VectorSource;
}

/** Hex `#rrggbb` o `#rgb` → `rgba(r,g,b,a)`. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * @deprecated Fase 5: el estilo combinado por `match(layerId)` sobre UN
 * único WebGLVectorLayer quedó reemplazado por `LayeredWebglRenderer`
 * (un WebGLVectorLayer real por capa, con estilo propio — ver
 * `buildSingleLayerStyle` más abajo). Se deja exportada solo por
 * compatibilidad con algún consumidor externo no auditado; nada del
 * motor de render actual la usa.
 */
export function buildWebglStyle(layers: Layer[]): Record<string, any> {
  const layerMap = new globalThis.Map<string, Layer>();
  for (const l of layers) layerMap.set(l.id, l);

  const colorForLayer = (layerId: string, property: 'fill' | 'stroke'): any => {
    const layer = layerMap.get(layerId);
    if (!layer || layer.colorMode !== 'colorIdx') {
      const a = layer?.opacity ?? 1;
      return property === 'fill'
        ? withAlpha(layer?.fillColor ?? layer?.color ?? '#10b981', 0.30 * a)
        : withAlpha(layer?.color ?? '#10b981', a);
    }
    const a = property === 'fill' ? 0.30 : 1;
    const lo = layer?.opacity ?? 1;
    const expr: any[] = ['match', ['get', 'colorIdx']];
    for (let i = 0; i < MZN_COLOR_COUNT; i++) expr.push(i, withAlpha(MZN_COLORS[i], a * lo));
    expr.push(withAlpha(MZN_COLORS[0], a * lo));
    return expr;
  };

  const fillMatch: any[] = ['match', ['get', 'layerId']];
  const strokeMatch: any[] = ['match', ['get', 'layerId']];

  for (const l of layers) {
    fillMatch.push(l.id, colorForLayer(l.id, 'fill'));
    strokeMatch.push(l.id, colorForLayer(l.id, 'stroke'));
  }
  fillMatch.push('rgba(16,185,129,0.30)');
  strokeMatch.push('#10b981');

  return {
    'fill-color': fillMatch,
    'stroke-color': strokeMatch,
    'stroke-width': 2,
  };
}

/** @deprecated Fase 5 — ver nota de `buildWebglStyle`. La visibilidad
 *  por capa ahora es literal: `layer.setVisible(...)` en el
 *  WebGLVectorLayer propio de cada capa, sin filtrar por expresión. */
export function buildLayerFilter(layers: Layer[]): any[] {
  const hiddenIds = layers.filter((l) => !l.visible).map((l) => l.id);
  if (hiddenIds.length === 0) return ['==', 1, 1];
  return [
    'all',
    ['==', 1, 1],
    [
      'any',
      ['==', ['get', 'layerId'], null],
      ['!', ['in', ['get', 'layerId'], ['literal', hiddenIds]]],
    ],
  ];
}

/** Estilo WebGL de UNA capa del registro (Fase 5) — reemplaza el gran
 *  `match` por `layerId` combinado de `buildWebglStyle`: cada capa ya
 *  es su propio layer, así que solo necesita SU color/opacidad, o —
 *  para "colorear por manzano" — el mismo `match` por `colorIdx` de
 *  siempre, pero acotado a esta capa. */
function buildSingleLayerStyle(layer: Layer): Record<string, unknown> {
  const op = layer.opacity ?? 1;
  if (layer.colorMode !== 'colorIdx') {
    return {
      'fill-color': withAlpha(layer.fillColor ?? layer.color, 0.3 * op),
      'stroke-color': withAlpha(layer.color, op),
      'stroke-width': 2,
    };
  }
  const fillExpr: unknown[] = ['match', ['get', 'colorIdx']];
  const strokeExpr: unknown[] = ['match', ['get', 'colorIdx']];
  for (let i = 0; i < MZN_COLOR_COUNT; i++) {
    fillExpr.push(i, withAlpha(MZN_COLORS[i], 0.3 * op));
    strokeExpr.push(i, withAlpha(MZN_COLORS[i], op));
  }
  fillExpr.push(withAlpha(MZN_COLORS[0], 0.3 * op));
  strokeExpr.push(withAlpha(MZN_COLORS[0], op));
  return { 'fill-color': fillExpr, 'stroke-color': strokeExpr, 'stroke-width': 2 };
}

/** Estilo de fallback (features cuyo `layerId` no resuelve a ninguna
 *  capa viva del registro — huérfanas transitorias; ver nota grande en
 *  `LayeredWebglRenderer`). Mismo verde genérico que usaba el `match`
 *  legado como último caso. */
const FALLBACK_STYLE = {
  'fill-color': 'rgba(16,185,129,0.30)',
  'stroke-color': '#10b981',
  'stroke-width': 2,
};

const FALLBACK_KEY = '__geourban_unassigned_mirror__';

/** zIndex reservados para las capas que NO son parte del registro
 *  (sketch de calles + overlay de postrender: vías, rotondas,
 *  etiquetas, guías de snap). Deben quedar SIEMPRE por encima de
 *  cualquier capa de polígonos del registro — ver la nota larga en
 *  `LayeredWebglRenderer` sobre "coexistencia con vías". Un valor fijo
 *  bien por encima de cualquier `layer.zIndex` realista evita cualquier
 *  ambigüedad de empate, sin importar cuántas capas custom cree el
 *  usuario. */
const STREET_SKETCH_Z_INDEX = 10_000;
const POSTRENDER_Z_INDEX = 10_001;

interface MirrorEntry {
  source: VectorSource;
  layer: WebGLVectorLayer;
}

/**
 * Fase 5 — Orden de dibujo real (diagnostico-plan-sistema-capas.md §4,
 * hallazgo 2.7 / 9).
 *
 * ANTES: lotes/manzanos/equipamiento/áreas-verdes vivían en un único
 * `WebGLVectorLayer` con un único `VectorSource` compartido — el orden
 * de dibujo real dependía del orden interno del renderer WebGL (basado
 * en un RBush espacial, no en orden de inserción ni en ningún atributo
 * de la feature), así que `layer.zIndex` y
 * `layersRegistryStore.reorder()` no tenían NINGÚN efecto visual
 * comprobable.
 *
 * AHORA: cada capa del registro tiene su PROPIO `WebGLVectorLayer` +
 * `VectorSource` "espejo", apilados en el `Map` de OpenLayers vía
 * `layer.setZIndex()` — el único mecanismo de OL con garantía real de
 * orden de dibujo entre capas.
 *
 * El `drawSource` MAESTRO (una sola fuente — la que usa el resto de la
 * app: `SpatialIndex`, snap, hit-test, métricas, comandos) NO cambia,
 * sigue siendo la única fuente de verdad de datos. Este renderer solo
 * ESPEJA cada `Feature` (por REFERENCIA, sin clonar geometría — una
 * misma instancia de OL Feature puede pertenecer a más de un
 * `VectorSource` sin problema) hacia el `VectorSource` del mirror-layer
 * que corresponde a su `layerId` vigente, y la remueve del mirror
 * anterior si su capa cambió.
 *
 * Coexistencia con vías (documentado, ver §4 Fase 5 del diagnóstico):
 * `StreetPainter`/`RoundaboutPainter`/`LabelPainter`/etc. pintan en el
 * canvas 2D de `postrenderLayer` (ver Map.tsx), que se fija a un
 * `zIndex` muy alto (`POSTRENDER_Z_INDEX`) para quedar SIEMPRE por
 * encima de TODAS las capas de polígonos del registro, sin importar el
 * `zIndex` real que tenga la capa "Viales" en el panel. Separar ese
 * canvas por zIndex de registro (para que, por ejemplo, un lote pueda
 * dibujarse ENCIMA de una calle) queda fuera de esta fase — el
 * diagnóstico permite documentar una relación fija en vez de hacerla
 * configurable, y esa es la decisión tomada acá.
 *
 * Nota de rendimiento: el pase caro (recorrer TODAS las features del
 * master para reubicarlas) solo corre cuando cambia el CONJUNTO de ids
 * de capas (alta/baja de una capa) — no en cada cambio de color/
 * opacidad/nombre/orden, que son O(capas), no O(features).
 */
export class LayeredWebglRenderer {
  private readonly master: VectorSource;
  private readonly mirrors = new globalThis.Map<string, MirrorEntry>();
  private readonly fallback: MirrorEntry;
  private readonly placement = new WeakMap<Feature<Geometry>, string>();
  private knownLayerIds = new Set<string>();
  private byIdCache: { layers: Layer[]; map: globalThis.Map<string, Layer> } | null = null;

  private map: Map | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private onAdd?: (evt: { feature?: Feature<Geometry> }) => void;
  private onRemove?: (evt: { feature?: Feature<Geometry> }) => void;
  private onChange?: (evt: { feature?: Feature<Geometry> }) => void;

  constructor(master: VectorSource) {
    this.master = master;
    this.fallback = this.createMirror(FALLBACK_STYLE, -1, true);
    // Arma los mirrors iniciales (sin `map` todavía) para que
    // `getLayers()` ya devuelva algo usable al construir el `Map` de OL.
    this.syncLayerSet(useLayersStore.getState().layers);
  }

  private createMirror(style: Record<string, unknown>, zIndex: number, visible: boolean): MirrorEntry {
    const source = new VectorSource();
    const layer = new WebGLVectorLayer({
      source,
      disableHitDetection: true,
      style,
      zIndex,
    });
    layer.setVisible(visible);
    return { source, layer };
  }

  private getByIdMap(): globalThis.Map<string, Layer> {
    const layers = useLayersStore.getState().layers;
    if (this.byIdCache && this.byIdCache.layers === layers) return this.byIdCache.map;
    const map = new globalThis.Map(layers.map((l) => [l.id, l] as const));
    this.byIdCache = { layers, map };
    return map;
  }

  private resolveMirrorKey(feature: Feature<Geometry>, byId: globalThis.Map<string, Layer>): string {
    const layerId = feature.get('layerId') as string | undefined;
    if (layerId && byId.has(layerId)) return layerId;
    return FALLBACK_KEY;
  }

  private entryFor(key: string): MirrorEntry | undefined {
    return key === FALLBACK_KEY ? this.fallback : this.mirrors.get(key);
  }

  private place(feature: Feature<Geometry>, byId: globalThis.Map<string, Layer>): void {
    const key = this.resolveMirrorKey(feature, byId);
    const prevKey = this.placement.get(feature);
    if (prevKey === key) return; // ya está en el mirror correcto — nada que mover
    if (prevKey != null) this.entryFor(prevKey)?.source.removeFeature(feature);
    this.entryFor(key)?.source.addFeature(feature);
    this.placement.set(feature, key);
  }

  private unplace(feature: Feature<Geometry>): void {
    const prevKey = this.placement.get(feature);
    if (prevKey == null) return;
    this.entryFor(prevKey)?.source.removeFeature(feature);
    this.placement.delete(feature);
  }

  /** Reconstruye el set de mirror-layers a partir del registro actual:
   *  crea los que faltan, destruye los que ya no existen (migrando sus
   *  features restantes al fallback antes), y refresca estilo/zIndex/
   *  visibilidad de los que se mantienen. */
  private syncLayerSet(layers: Layer[]): void {
    const byId = new globalThis.Map(layers.map((l) => [l.id, l] as const));
    const currentIds = new Set(byId.keys());

    let membershipChanged = currentIds.size !== this.knownLayerIds.size;
    if (!membershipChanged) {
      for (const id of currentIds) {
        if (!this.knownLayerIds.has(id)) { membershipChanged = true; break; }
      }
    }

    for (const layer of layers) {
      let entry = this.mirrors.get(layer.id);
      if (!entry) {
        entry = this.createMirror(buildSingleLayerStyle(layer), layer.zIndex, layer.visible);
        this.mirrors.set(layer.id, entry);
        this.map?.addLayer(entry.layer);
      } else {
        entry.layer.setStyle(buildSingleLayerStyle(layer));
        entry.layer.setZIndex(layer.zIndex);
        entry.layer.setVisible(layer.visible);
      }
    }

    for (const [id, entry] of Array.from(this.mirrors.entries())) {
      if (byId.has(id)) continue;
      // Capa eliminada del registro: cualquier feature que le haya
      // quedado sin reconciliar migra al fallback en vez de perderse
      // del render.
      for (const f of entry.source.getFeatures().slice()) {
        entry.source.removeFeature(f);
        this.fallback.source.addFeature(f);
        this.placement.set(f as Feature<Geometry>, FALLBACK_KEY);
      }
      this.map?.removeLayer(entry.layer);
      entry.layer.dispose();
      this.mirrors.delete(id);
    }

    this.knownLayerIds = currentIds;
    this.byIdCache = { layers, map: byId };

    if (membershipChanged) {
      for (const f of this.master.getFeatures()) {
        this.place(f as Feature<Geometry>, byId);
      }
    }
  }

  /** Engancha el renderer al `Map` de OL + al `drawSource` maestro + al
   *  registro de capas. Devuelve una función de limpieza. Llamar una
   *  sola vez, apenas exista el `Map` (ver Map.tsx). */
  attach(map: Map): () => void {
    this.map = map;

    this.onAdd = (evt) => { if (evt.feature) this.place(evt.feature, this.getByIdMap()); };
    this.onRemove = (evt) => { if (evt.feature) this.unplace(evt.feature); };
    this.onChange = (evt) => { if (evt.feature) this.place(evt.feature, this.getByIdMap()); };

    this.master.on('addfeature', this.onAdd as never);
    this.master.on('removefeature', this.onRemove as never);
    this.master.on('changefeature', this.onChange as never);

    this.unsubscribeStore = useLayersStore.subscribe((state) => this.syncLayerSet(state.layers));

    return () => {
      if (this.onAdd) this.master.un('addfeature', this.onAdd as never);
      if (this.onRemove) this.master.un('removefeature', this.onRemove as never);
      if (this.onChange) this.master.un('changefeature', this.onChange as never);
      this.unsubscribeStore?.();
      this.unsubscribeStore = null;
      for (const entry of this.mirrors.values()) {
        this.map?.removeLayer(entry.layer);
        entry.layer.dispose();
      }
      this.map?.removeLayer(this.fallback.layer);
      this.fallback.layer.dispose();
      this.map = null;
    };
  }

  /** Capas OL a insertar en el `Map` al construirlo (el orden dentro del
   *  array es irrelevante: cada una trae su propio `zIndex`, que es lo
   *  que realmente ordena el dibujo). Tras `attach()`, mirrors creados/
   *  destruidos más tarde ya no pasan por acá — se agregan/quitan
   *  directo vía `map.addLayer()`/`removeLayer()` dentro de
   *  `syncLayerSet`. */
  getLayers(): BaseLayer[] {
    return [this.fallback.layer, ...Array.from(this.mirrors.values(), (m) => m.layer)];
  }

  /** Reemplazo de `drawLayer.changed()` — fuerza repintado de TODAS las
   *  capas espejo. */
  changed(): void {
    this.fallback.layer.changed();
    for (const entry of this.mirrors.values()) entry.layer.changed();
  }
}

export function buildDrawLayers(
  visibility: WorkVisibility,
): DrawLayers {
  const source = new VectorSource();
  const webglRenderer = new LayeredWebglRenderer(source);

  const streetSource = new VectorSource();
  const streetLayer = new VectorLayer({
    source: streetSource,
    visible: visibility.streets,
    // null (NO undefined): `undefined` hace que OL aplique su estilo por
    // DEFECTO (visible) a cualquier feature que quede en streetSource —
    // que se supone vacío entre trazados, ya que quien realmente dibuja
    // las calles es el postrender de PostrenderPainter. Con `undefined`,
    // cualquier feature huérfana ahí se veía como una línea fantasma con
    // el estilo azul por defecto de OL.
    style: null,
    zIndex: STREET_SKETCH_Z_INDEX,
  });

  const postrenderLayer = new VectorLayer({
    source: new VectorSource(),
    style: () => undefined,
    renderOrder: undefined,
    zIndex: POSTRENDER_Z_INDEX,
  });

  return { webglRenderer, streetLayer, postrenderLayer, source, streetSource };
}