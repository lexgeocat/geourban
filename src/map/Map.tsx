import React, { useEffect, useRef } from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import type BaseLayer from 'ol/layer/Base.js';
import VectorLayer from 'ol/layer/Vector.js';
import { defaults } from 'ol/control.js';
import Attribution from 'ol/control/Attribution.js';
import VectorSource from 'ol/source/Vector.js';
import DragPan from 'ol/interaction/DragPan.js';
import { unByKey } from 'ol/Observable.js';
import { toLonLat, fromLonLat, transform } from 'ol/proj.js';
import { Stroke, Style, Circle as CircleStyle, RegularShape } from 'ol/style.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useUiShellStore } from '../store/ui/uiShellStore';
import { useLayersStore } from '../store/entities/layersRegistryStore';
import { useMapStore } from '../store/map/mapStore';
import { useDrawStore } from '../store/map/drawStore';
import { useSelectionStore } from '../store/map/selectionStore';
import { useProjectCrsStore } from '../store/project/projectCrsStore';
import { BaseLayerManager } from './scene/BaseLayerManager';
import { buildDrawLayers, LayeredWebglRenderer, type WorkVisibility } from './scene/DrawLayerRenderer';
import { PostrenderPainter } from './scene/PostrenderPainter';
import { InteractionModeController } from './scene/InteractionModeController';
import { SNAP_COLORS, type SnapGuideVisual } from './advancedSnap';
import SnapEngine from './snapInteraction';
import { RotateLotsInteraction } from './scene/RotateLotsInteraction';
import { useRoundaboutStore } from '../store/entities/roundaboutStore';
import { getOrCreateSpatialIndex } from './spatialIndex';
import { ensureUtmZoneRegistered } from '../geo/crs/utmZones';
import { useManzanoStore } from '../store/entities/manzanoStore';
import { runCommand } from '../commands/core/CommandStack';
import { RecomputeManzanoLotsCommand } from '../commands/lots/RecomputeManzanoLotsCommand';
import { polyArea, centroid, ringPerimeter } from '../geo/math/polygonEngine';
import { rafThrottle } from '../utils/rafThrottle';
import { useSubdivisionPreviewStore } from '../store/ui/subdivisionPreviewStore';
import { useStreetStore } from '../store/entities/streetStore';
import { useRoadCornerStore } from '../store/map/roadCornerStore';
import { reapplyRoadCornerMode } from '../geo/recomputeManzanos';

export default function MapView() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const baseLayerRef = useRef<BaseLayer | null>(null);
  const baseLayerMgrRef = useRef<BaseLayerManager | null>(null);
  const baseMapInitializedRef = useRef(false);
  const baseMapEffectPrimedRef = useRef(false);
  const webglRendererRef = useRef<LayeredWebglRenderer | null>(null);
  const streetLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawSrcRef = useRef<VectorSource | null>(null);
  const streetLayerSrcRef = useRef<VectorSource | null>(null);
  const snapGuideRef = useRef<SnapGuideVisual | null>(null);
  const snapEngineRef = useRef<SnapEngine | null>(null);
  const postrenderPainterRef = useRef<PostrenderPainter | null>(null);
const interactionCtrlRef = useRef<InteractionModeController | null>(null);
const rotateLotsInteractionRef = useRef<RotateLotsInteraction | null>(null);
const rotateLotsCleanupRef = useRef<(() => void) | null>(null);
const baseMapId = useUiShellStore((s) => s.baseMap);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const drawMode = useDrawStore().mode;

  // --- Inicializar mapa (solo una vez) ---
  useEffect(() => {
    if (!mapDivRef.current) return;

    // Visibilidad inicial derivada del registro de capas — reemplaza al
    // extinto layerStore.workVisibility (ver plan Fase 1).
    const initialWorkVisibility: WorkVisibility = {
      lots:
        useLayersStore.getState().hasKindVisible('lote') ||
        useLayersStore.getState().hasKindVisible('manzana'),
      streets: useLayersStore.getState().hasKindVisible('calle'),
      // Ya no controla ninguna capa de render — ver DrawLayerRenderer.ts.
      measurements: true,
    };
    const drawLayers = buildDrawLayers(initialWorkVisibility);
    const drawSrc = drawLayers.source;
    drawSrcRef.current = drawSrc;
    useMapStore.getState().setDrawSource(drawSrc);

    // Fase 5 (sistema de capas): ya no hay un único WebGLVectorLayer —
    // cada capa del registro tiene su propio layer/zIndex real de OL
    // (ver DrawLayerRenderer.ts::LayeredWebglRenderer).
    const webglRenderer = drawLayers.webglRenderer;
    webglRendererRef.current = webglRenderer;
    const streetLayerSrc = drawLayers.streetSource;
    streetLayerSrcRef.current = streetLayerSrc;
    const streetLayer = drawLayers.streetLayer;
    streetLayerRef.current = streetLayer;
    const postrenderLayer = drawLayers.postrenderLayer;

    // --- Mapa base (BaseLayerManager — Fase 11.2) ---
    const baseLayerMgr = new BaseLayerManager();

    const map = new Map({
      target: mapDivRef.current!,
      // Fase 5: N capas espejo del registro (una por capa, con su
      // propio zIndex real) + street sketch + postrender. Estos dos
      // últimos tienen zIndex fijo muy alto (ver DrawLayerRenderer.ts)
      // para quedar SIEMPRE por encima de cualquier capa de polígonos,
      // sin importar su zIndex en el panel — decisión documentada.
      layers: [...webglRenderer.getLayers(), streetLayer, postrenderLayer],
      view: new View({
        center: fromLonLat(viewConfig.center),
        zoom: viewConfig.zoom,
      }),
      controls: defaults({ attribution: false }).extend([
        new Attribution({
          collapsible: false,
          className: 'custom-attribution',
        }),
      ]),
    });
    // Engancha el renderer de capas al Map recién creado — a partir de
    // acá, altas/bajas de capas custom agregan/quitan sus propios
    // WebGLVectorLayer en vivo.
    const detachWebglRenderer = webglRenderer.attach(map);

    // Instalar mapa base (siempre en índice 0) vía BaseLayerManager.
    const baseLayer = baseLayerMgr.install(map, baseMapId);
    baseLayerRef.current = baseLayer;
    baseMapInitializedRef.current = true;

    // Reemplazar el DragPan por defecto (left-click) con uno de click derecho+medio
    // 1. Encontrar y remover el DragPan por defecto
    const interactions = map.getInteractions();
    const toRemove: any[] = [];
    interactions.forEach((interaction) => {
      if (interaction instanceof DragPan) {
        toRemove.push(interaction);
      }
    });
    toRemove.forEach((interaction) => interactions.remove(interaction));

    // 2. Agregar DragPan con click derecho (button 2) o click medio (button 1)
    const dragPan = new DragPan({
      condition: (event) => {
        const oe = event.originalEvent as unknown;
        if (!(oe instanceof MouseEvent)) return false;
        return oe.button === 1 || oe.button === 2;
      },
    });
    interactions.push(dragPan);

    // Prevenir menu contextual del click derecho en el mapa
    map.getViewport().addEventListener('contextmenu', (e) => e.preventDefault());

    // Cursor "manito" (grab) cuando se hace pan con click derecho o medio
    const viewport = map.getViewport();
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || e.button === 2) {
        viewport.style.cursor = 'grabbing';
      }
    };
    const onPointerUp = () => {
      viewport.style.cursor = '';
    };
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointerleave', onPointerUp);

    const postrenderPainter = new PostrenderPainter({
      map,
      drawSource: drawSrc,
      postrenderLayer,
    });
    postrenderPainterRef.current = postrenderPainter;

    // --- Live cursor coordinates & zoom ---
    const setCursorCoords = useMapStore.getState().setCursorCoords;
    // pointermove dispara cientos de veces por segundo; cada llamada a
    // setCursorCoords es un set() de Zustand que re-renderiza StatusBar.
    // Coalescemos a 1 update por frame de render (rAF).
    const throttledSetCursorCoords = rafThrottle(setCursorCoords);
    const setZoom = useMapStore.getState().setZoom;
    const view = map.getView();

     map.on('pointermove', (evt) => {
      const crs = useProjectCrsStore.getState();
      if (crs.mode === 'utm') {
        // Con UTM activo, mostramos las coordenadas REALES proyectadas
        // (metros), no lon/lat — es lo que un CAD/GIS mostraría.
        const epsg = ensureUtmZoneRegistered(crs.utmZone, crs.utmHemisphere);
        const projected = transform(evt.coordinate, 'EPSG:3857', epsg) as [number, number];
        throttledSetCursorCoords({ x: projected[0], y: projected[1], isProjected: true });
      } else {
        const lonLat = toLonLat(evt.coordinate);
        throttledSetCursorCoords({ x: lonLat[0], y: lonLat[1], isProjected: false });
      }
    });

    const onZoomChange = () => {
      const z = view.getZoom();
      if (z !== undefined) {
        setZoom(z);
      }
    };
    view.on('change:resolution', onZoomChange);
    const initialZoom = view.getZoom();
    if (initialZoom !== undefined) {
      setZoom(initialZoom);
    }

    const onMoveEnd = () => {
      // Fin del gesto de pan/zoom: PostrenderPainter vuelve a pintar
      // etiquetas de texto completas (ver H4 — modo barato durante
      // interacción).
      postrenderPainter.setInteracting(false);
      const center = view.getCenter();
      const currentZoom = view.getZoom();
      if (center && currentZoom !== undefined) {
        const lonLat = toLonLat(center) as [number, number];
        useMapStore.getState().setViewConfig({ center: lonLat, zoom: currentZoom });
      }
    };
    const moveEndKey = map.on('moveend', onMoveEnd);
    const onMoveStart = () => postrenderPainter.setInteracting(true);
    const moveStartKey = map.on('movestart', onMoveStart);

    // --- Indicador visual de snap (capa overlay, agregada al final) ---
    const snapIndicatorSrc = new VectorSource();
    const snapIndicatorLayer = new VectorLayer({
      source: snapIndicatorSrc,
      style: new Style({
        image: new CircleStyle({
          radius: 5,
          stroke: new Stroke({ color: '#00d4ff', width: 2 }),
        }),
      }),
    });
    map.addLayer(snapIndicatorLayer);

    // Pre-crear estilos de snap (uno por tipo, reutilizados en cada frame)
    const snapStyles = new globalThis.Map<string, Style>();
    const SNAP_SHAPES: Record<string, { points?: number; radius: number; radius2?: number; angle?: number }> = {
      endpoint:             { radius: 7,  points: 4,               angle: Math.PI / 4 }, // Cuadrado □
      midpoint:             { radius: 8,  points: 3,               angle: -Math.PI / 2 }, // Triángulo △
      intersection:         { radius: 8,  points: 4, radius2: 2,  angle: Math.PI / 4 },  // Cruz (X)
      apparentIntersection: { radius: 7,  points: 4,               angle: 0 },            // Diamante ◇
      extension:            { radius: 7,  points: 4, radius2: 2,  angle: 0 },             // Cruz (+)
      perpendicular:        { radius: 7,  points: 5,               angle: -Math.PI / 2 }, // Pentágono
      parallel:             { radius: 7,  points: 6,               angle: -Math.PI / 2 }, // Hexágono
      nearest:              { radius: 5 },                                                // Círculo
      center:               { radius: 7,  points: 4,               angle: Math.PI / 4 },  // Cuadrado pequeño (centro de círculo)
      tangent:              { radius: 7,  points: 3,               angle: -Math.PI / 2 }, // Triángulo (tangente)
      grid:                 { radius: 4,  points: 4,               angle: Math.PI / 4 },  // Cuadrado chico
    };
    for (const [type, color] of Object.entries(SNAP_COLORS)) {
      const cfg = SNAP_SHAPES[type]!;
      const image = cfg.points
        ? new RegularShape({
            points: cfg.points,
            radius: cfg.radius,
            radius2: cfg.radius2,
            angle: cfg.angle ?? 0,
            stroke: new Stroke({ color, width: 2 }),
          })
        : new CircleStyle({ radius: cfg.radius, stroke: new Stroke({ color, width: 2 }) });
      snapStyles.set(type, new Style({ image }));
    }

    // Spatial Index para snap O(log n)
    const spatialIndex = getOrCreateSpatialIndex();
    spatialIndex.load(drawSrc.getFeatures() as Feature<Polygon>[]);

    // Actualizar índice cuando cambian features
    const onSpatialInsert = (evt: any) => {
      if (evt.feature instanceof Feature) spatialIndex.insert(evt.feature as Feature<Polygon>);
    };
    const onSpatialRemove = (evt: any) => {
      if (evt.feature instanceof Feature) spatialIndex.remove(evt.feature as Feature<Polygon>);
    };
    // 'changefeature' dispara en cada frame de un drag/edit en vivo
    // (Modify, SafeTranslate) — sin esto el índice quedaba con el bbox
    // viejo hasta el próximo add/remove real. Se coalesce a 1 reindexado
    // por frame (por feature), igual criterio que el cursor.
    const pendingSpatialUpdates = new globalThis.Map<string | number, Feature<Polygon>>();
    const flushSpatialUpdates = rafThrottle(() => {
      pendingSpatialUpdates.forEach((f) => spatialIndex.update(f));
      pendingSpatialUpdates.clear();
    });
    const onSpatialChange = (evt: any) => {
      if (!(evt.feature instanceof Feature)) return;
      const id = evt.feature.getId();
      if (id == null) return;
      pendingSpatialUpdates.set(id, evt.feature as Feature<Polygon>);
      flushSpatialUpdates();
    };
     drawSrc.on('addfeature', onSpatialInsert);
     drawSrc.on('removefeature', onSpatialRemove);
    drawSrc.on('changefeature', onSpatialChange);

    const interactionCtrl = new InteractionModeController({
  map,
  drawSource: drawSrc,
  drawLayer: webglRenderer,
  streetLayer,
  streetSource: streetLayerSrc,
  postrenderPainter,
});
    interactionCtrlRef.current = interactionCtrl;

    const getAnchor = (): number[] | undefined => {
      const draw = interactionCtrl.activeDrawRef.current;
      if (!draw) return undefined;
      const overlaySrc = draw.getOverlay().getSource();
      const sketch = overlaySrc?.getFeatures()[0];
      const sketchGeom = sketch?.getGeometry();
      if (!sketchGeom) return undefined;
      const ring =
        sketchGeom instanceof Polygon
          ? sketchGeom.getCoordinates()[0]
          : sketchGeom instanceof LineString
            ? sketchGeom.getCoordinates()
            : [];
      return ring.length >= 2 ? (ring[ring.length - 2] as number[]) : undefined;
    };

    const getExcludeFeature = (): Feature<Geometry> | undefined => {
      const mode = useDrawStore.getState().mode;
      if (mode !== 'edit') return undefined;
      const ds = drawSrcRef.current;
      const primaryId = useSelectionStore.getState().primaryId;
      const f = ds && primaryId != null ? ds.getFeatureById(primaryId) : null;
      return (f as Feature<Geometry>) ?? undefined;
    };

    const getCloseTarget = (_coordinate: number[]): number[] | null => {
      return null;
    };

    const getEnabled = () => useDrawStore.getState().mode !== 'erase';

    const shouldSnapCoordinate = (eventType: string): boolean => {
      const mode = useDrawStore.getState().mode;
      // Modos de dibujo (Draw interaction): imantar SIEMPRE
      const drawModes = new Set([
        'polygon', 'line', 'rectangle', 'street',
      ]);
      if (drawModes.has(mode)) return true;
      // Modo edición: imantar solo durante arrastre
      if (mode === 'edit' && eventType === 'pointerdrag') return true;
      return false;
    };

    const snapEngine = new SnapEngine({
      getSource: () => drawSrcRef.current,
      spatialIndex,
      getEnabled,
      shouldSnapCoordinate,
      getAnchor,
      getExcludeFeature,
      getPriorityTarget: getCloseTarget,
      pixelTolerance: 10,
      onResultChange: (result) => {
        snapIndicatorSrc.clear();
        if (result) {
          snapIndicatorLayer.setStyle(snapStyles.get(result.type) ?? snapStyles.get('endpoint')!);
          snapIndicatorSrc.addFeature(
            new Feature({ geometry: new Point(result.point), snapType: result.type })
          );
        }
      },
      onGuideChange: (guide) => {
        snapGuideRef.current = guide;
        postrenderPainter.setSnapGuide(guide);
      },
    });
snapEngineRef.current = snapEngine;
map.addInteraction(snapEngine);

const rotateLotsInteraction = new RotateLotsInteraction(map, (id, dir) => {
  const { targetAreaM2, frontMinM, getMethod, setGeomSnapshot } = useManzanoStore.getState();
  const src = useMapStore.getState().drawSource;
  const feat = src?.getFeatureById(id) as Feature<Geometry> | null;
  const geom = feat?.getGeometry();
  if (geom instanceof Polygon) {
    const ring = ((geom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as [number, number]);
    setGeomSnapshot(id, { area: polyArea(ring), perimeter: ringPerimeter(ring), centroid: centroid(ring) });
  }
  void runCommand(
    new RecomputeManzanoLotsCommand({ manzanoId: id, targetAreaM2, frontMinM, method: getMethod(id), dirPref: dir }),
  );
});
rotateLotsInteractionRef.current = rotateLotsInteraction;
rotateLotsCleanupRef.current = rotateLotsInteraction.install();
map.addInteraction(rotateLotsInteraction);

useMapStore.getState().setMap(map);
    mapInstanceRef.current = map;

    // Cleanup unificado — BaseLayerManager.dispose() reemplaza la
    // manipulación manual de baseLayerCleanupRef que había antes.
    baseLayerMgrRef.current = baseLayerMgr;

    return () => {
      baseLayerMgrRef.current?.dispose();
      baseLayerMgrRef.current = null;
      interactionCtrlRef.current?.dispose();
      interactionCtrlRef.current = null;
detachWebglRenderer();
webglRendererRef.current = null;
map.removeInteraction(snapEngine);
snapEngineRef.current = null;
rotateLotsCleanupRef.current?.();
rotateLotsCleanupRef.current = null;
if (rotateLotsInteractionRef.current) {
  map.removeInteraction(rotateLotsInteractionRef.current);
  rotateLotsInteractionRef.current = null;
}
unByKey(moveEndKey);
unByKey(moveStartKey);
postrenderPainter.dispose();
      postrenderPainterRef.current = null;
      drawSrc.un('addfeature', onSpatialInsert);
      drawSrc.un('removefeature', onSpatialRemove);
      drawSrc.un('changefeature', onSpatialChange);
      useMapStore.getState().setMap(null);
      useMapStore.getState().setDrawSource(null);
      const m = mapInstanceRef.current;
      if (m) m.setTarget(undefined);
      mapInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Cambiar mapa base (BaseLayerManager — Fase 11.2) ---
  useEffect(() => {
    if (!baseMapEffectPrimedRef.current) {
      baseMapEffectPrimedRef.current = true;
      return;
    }
    const map = mapInstanceRef.current;
    const mgr = baseLayerMgrRef.current;
    if (!map || !mgr || !baseMapInitializedRef.current) return;
    const newLayer = mgr.install(map, baseMapId);
    baseLayerRef.current = newLayer;
  }, [baseMapId]);


useEffect(() => {
  const unsub = useLayersStore.subscribe((state) => {
    // Fase 5: cada capa WebGL administra su propia visibilidad/estilo/
    // zIndex de forma independiente — ver
    // DrawLayerRenderer.ts::LayeredWebglRenderer (se auto-suscribe al
    // registro dentro de su propio `attach()`). Acá solo queda lo que
    // sigue siendo responsabilidad de Map.tsx: la capa de sketch de
    // calles (vestigial, ver comentario en buildDrawLayers).
    const anyCalleVisible = state.layers.some((l) => l.kind === 'calle' && l.visible);
    if (streetLayerRef.current) streetLayerRef.current.setVisible(anyCalleVisible);
  });
  return unsub;
}, []);

useEffect(() => {
  const unsub = useRoundaboutStore.subscribe(() => {
    mapInstanceRef.current?.render();
  });
  return unsub;
}, []);
useEffect(() => {
  const unsub = useStreetStore.subscribe(() => {
    mapInstanceRef.current?.render();
  });
  return unsub;
}, []);
useEffect(() => {
  const unsub = useRoadCornerStore.subscribe(() => {
    void reapplyRoadCornerMode();
  });
  return unsub;
}, []);
useEffect(() => {
  const unsub = useSubdivisionPreviewStore.subscribe((state) => {
    postrenderPainterRef.current?.setSubdivisionPreview(state.rings);
  });
  return unsub;
}, []);

  // --- Interacciones según modo activo ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    interactionCtrlRef.current?.activate(drawMode);
// SnapEngine siempre al final (última interacción = procesa primero)
  if (snapEngineRef.current) {
    map.removeInteraction(snapEngineRef.current);
    map.addInteraction(snapEngineRef.current);
  }
  // El gizmo de "Rotar lotes" va todavía más al final: debe interceptar
  // el arrastre de su manipulador antes que cualquier otra interacción (Select incluido).
  if (rotateLotsInteractionRef.current) {
    map.removeInteraction(rotateLotsInteractionRef.current);
    map.addInteraction(rotateLotsInteractionRef.current);
  }
}, [drawMode]);

  // --- Re-activar interacciones cuando cambia selectMode (rect/lasso) ---
  const selectMode = useSelectionStore((s) => s.selectMode);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const mode = useDrawStore.getState().mode;
    if (mode === 'select' || mode === 'edit') {
      interactionCtrlRef.current?.activate(mode);
    }
  }, [selectMode]);

  return (
    <div
      ref={mapDivRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--cad-bg-deepest)',
      }}
    />
  );
}
