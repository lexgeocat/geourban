import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
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
import { useLayerStore } from '../store/layerStore';
import { useMapStore } from '../store/mapStore';
import { useDrawStore } from '../store/drawStore';
import { useSelectionStore } from '../store/selectionStore';
import { useProjectCrsStore } from '../store/projectCrsStore';
import { BaseLayerManager } from './scene/BaseLayerManager';
import { buildDrawLayers } from './scene/DrawLayerRenderer';
import { PostrenderPainter } from './scene/PostrenderPainter';
import { InteractionModeController } from './scene/InteractionModeController';
import { SNAP_COLORS, type SnapGuideVisual } from './advancedSnap';
import SnapEngine from './snapInteraction';
import { getOrCreateSpatialIndex } from './demoDataset';
import { ensureUtmZoneRegistered } from '../geo/utmZones';

// ─── willReadFrequently: parche global único ─────────────────────────────
// OpenLayers usa getImageData internamente para hit-testing en capas Canvas2D.
// Sin willReadFrequently=true el browser emite una advertencia de performance
// cada vez que se leen píxeles (múltiples readback operations).
if (!(HTMLCanvasElement.prototype as any).__willReadFreqPatched) {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).__willReadFreqPatched = true;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: any[]) {
    if (type === '2d' || type === 'bitmaprenderer') {
      const attrs = (args[0] || {}) as CanvasRenderingContext2DSettings;
      if (!attrs.willReadFrequently) {
        args[0] = { ...attrs, willReadFrequently: true };
      }
    }
    return origGetContext.call(this, type, ...args);
  } as typeof HTMLCanvasElement.prototype.getContext;
}

export default function MapView() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const baseLayerRef = useRef<BaseLayer | null>(null);
  const baseLayerMgrRef = useRef<BaseLayerManager | null>(null);
  const baseMapInitializedRef = useRef(false);
  const baseMapEffectPrimedRef = useRef(false);
  const measurementLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawLayerRef = useRef<WebGLVectorLayer | null>(null);
  const streetLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawSrcRef = useRef<VectorSource | null>(null);
  const streetLayerSrcRef = useRef<VectorSource | null>(null);
  const snapGuideRef = useRef<SnapGuideVisual | null>(null);
  const snapEngineRef = useRef<SnapEngine | null>(null);
  const interactionCtrlRef = useRef<InteractionModeController | null>(null);
  const baseMapId = useLayerStore((s) => s.baseMap);
  const workVisibility = useLayerStore((s) => s.workVisibility);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const drawMode = useDrawStore().mode;

  // --- Inicializar mapa (solo una vez) ---
  useEffect(() => {
    if (!mapDivRef.current) return;

    // --- Capa de dibujo persistente (features del usuario) ---
    // Construcción centralizada en DrawLayerRenderer (Fase 11.3) — antes
    // este bloque tenía ~80 líneas con match expressions de WebGL y
    // creación de 4 layers, ahora es 1 llamada.
    const drawLayers = buildDrawLayers(workVisibility);
    const drawSrc = drawLayers.source;
    drawSrcRef.current = drawSrc;
    useMapStore.getState().setDrawSource(drawSrc);

    const drawLayer = drawLayers.webglLayer;
    drawLayerRef.current = drawLayer;
    const measurementLayer = drawLayers.measurementLayer;
    measurementLayerRef.current = measurementLayer;
    const streetLayerSrc = drawLayers.streetSource;
    streetLayerSrcRef.current = streetLayerSrc;
    const streetLayer = drawLayers.streetLayer;
    streetLayerRef.current = streetLayer;
    const postrenderLayer = drawLayers.postrenderLayer;

    // --- Mapa base (BaseLayerManager — Fase 11.2) ---
    const baseLayerMgr = new BaseLayerManager();

    const map = new Map({
      target: mapDivRef.current!,
      layers: [drawLayer, measurementLayer, streetLayer, postrenderLayer],
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

    // ─── Post-render (PostrenderPainter — Fase 11.4) ──────────────────
    // Encapsula todo el Canvas2D overlay: labels de features, dibujo
    // de calles y fillets, guías visuales de snap. Mantiene su propio
    // cache (fillets + lotGroupCounts) invalidado por eventos de la
    // fuente.
    const postrenderPainter = new PostrenderPainter({
      map,
      drawSource: drawSrc,
      postrenderLayer,
    });


    // --- Live cursor coordinates & zoom ---
    const setCursorCoords = useMapStore.getState().setCursorCoords;
    const setZoom = useMapStore.getState().setZoom;
    const view = map.getView();

     map.on('pointermove', (evt) => {
      const crs = useProjectCrsStore.getState();
      if (crs.mode === 'utm') {
        // Con UTM activo, mostramos las coordenadas REALES proyectadas
        // (metros), no lon/lat — es lo que un CAD/GIS mostraría.
        const epsg = ensureUtmZoneRegistered(crs.utmZone, crs.utmHemisphere);
        const projected = transform(evt.coordinate, 'EPSG:3857', epsg) as [number, number];
        setCursorCoords({ x: projected[0], y: projected[1], isProjected: true });
      } else {
        const lonLat = toLonLat(evt.coordinate);
        setCursorCoords({ x: lonLat[0], y: lonLat[1], isProjected: false });
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

    // Mantiene viewConfig (mapStore) sincronizado con la posición REAL del
    // mapa. Antes viewConfig.center quedaba congelado en su valor default
    // — nunca se actualizaba al hacer pan/zoom — lo que rompía "Detectar
    // zona UTM desde la vista actual" (siempre detectaba la ubicación
    // default) y también el autosave/guardado (siempre guardaba la vista
    // inicial, no la última vista real del usuario).
    const onMoveEnd = () => {
      const center = view.getCenter();
      const currentZoom = view.getZoom();
      if (center && currentZoom !== undefined) {
        const lonLat = toLonLat(center) as [number, number];
        useMapStore.getState().setViewConfig({ center: lonLat, zoom: currentZoom });
      }
    };
    const moveEndKey = map.on('moveend', onMoveEnd);

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
    // Cada tipo tiene forma geométrica distinta (estilo CAD) sin relleno
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
    drawSrc.on('addfeature', onSpatialInsert);
    drawSrc.on('removefeature', onSpatialRemove);

    // ────────────────────────────────────────────────────────────────
    // InteractionModeController — gestiona todo el ciclo de vida de
    // interacciones según el modo activo (select/edit/draw/erase).
    // Creado ANTES de SnapEngine para que sus callbacks puedan leer
    // activeDrawRef del controller.
    // ────────────────────────────────────────────────────────────────
    const interactionCtrl = new InteractionModeController({
      map,
      drawSource: drawSrc,
      measurementLayer,
      drawLayer,
      streetLayer,
      streetSource: streetLayerSrc,
      postrenderPainter,
    });
    interactionCtrlRef.current = interactionCtrl;

    // ────────────────────────────────────────────────────────────────
    // Motor de snap unificado — SnapEngine (interaction de OL) corrige
    // evt.coordinate/evt.pixel ANTES que Draw/Modify/Translate/Select
    // procesen el evento. Esto es lo que hace que el click real quede
    // pegado EXACTO al punto de snap mostrado (antes solo se movía el
    // sketch de preview, y el click final usaba la coordenada cruda del
    // mouse). Ver src/map/snapInteraction.ts.
    // ────────────────────────────────────────────────────────────────
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

    // Snap de cierre de polígono: iman al primer vértice del sketch
    // activo cuando el cursor entra en el radio de cierre. Prioridad
    // absoluta sobre cualquier otro snap.
    const getCloseTarget = (_coordinate: number[]): number[] | null => {
      return null;
    };

    const getEnabled = () => useDrawStore.getState().mode !== 'erase';

    // Qué tipos de evento "imantan" (sobreescriben) la coordenada real:
    //  - polyline/street: TODOS — el vértice que Draw termina agregando
    //    es EXACTO al punto de snap mostrado, no una aproximación del
    //    click del mouse.
    //  - edit: solo 'pointerdrag' — arrastrar un vértice (Modify) o una
    //    feature completa (Translate) se pega a otros puntos, sin tocar
    //    los clicks de selección (Select sigue usando el click real).
    const shouldSnapCoordinate = (eventType: string): boolean => {
      const mode = useDrawStore.getState().mode;
      // Modos de dibujo (Draw interaction): imantar SIEMPRE
      const drawModes = new Set([
        'polygon', 'line', 'rectangle',
        'circle', 'arc', 'street', 'text',
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
      map.removeInteraction(snapEngine);
      snapEngineRef.current = null;
      unByKey(moveEndKey);
      postrenderPainter.dispose();
      drawSrc.un('addfeature', onSpatialInsert);
      drawSrc.un('removefeature', onSpatialRemove);
      useMapStore.getState().setMap(null);
      useMapStore.getState().setDrawSource(null);
      const m = mapInstanceRef.current;
      if (m) m.setTarget(undefined);
      mapInstanceRef.current = null;
    };
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

  // --- Visibilidad de cotas automáticas ---
  useEffect(() => {
    if (measurementLayerRef.current) {
      measurementLayerRef.current.setVisible(workVisibility.measurements);
    }
  }, [workVisibility.measurements]);

  // --- Visibilidad de calles/viales ---
  useEffect(() => {
    if (streetLayerRef.current) {
      streetLayerRef.current.setVisible(workVisibility.streets);
    }
  }, [workVisibility.streets]);

  // --- Visibilidad de lotes/manzanos (WebGL layer) ---
  useEffect(() => {
    if (drawLayerRef.current) {
      drawLayerRef.current.setVisible(workVisibility.lots);
    }
  }, [workVisibility.lots]);

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
