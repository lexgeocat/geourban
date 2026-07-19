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
import { useLayersStore } from '../store/layersRegistryStore';
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
import { RotateLotsInteraction } from './scene/RotateLotsInteraction';
import { getOrCreateSpatialIndex } from './demoDataset';
import { ensureUtmZoneRegistered } from '../geo/utmZones';
import { useManzanoStore } from '../store/manzanoStore';
import { runCommand } from '../commands/CommandStack';
import { RecomputeManzanoLotsCommand } from '../commands/RecomputeManzanoLotsCommand';
import { polyArea } from '../geo/polygonEngine';

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
const rotateLotsInteractionRef = useRef<RotateLotsInteraction | null>(null);
const rotateLotsCleanupRef = useRef<(() => void) | null>(null);
const baseMapId = useLayerStore((s) => s.baseMap);
  const workVisibility = useLayerStore((s) => s.workVisibility);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const drawMode = useDrawStore().mode;

  // --- Inicializar mapa (solo una vez) ---
  useEffect(() => {
    if (!mapDivRef.current) return;

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

const rotateLotsInteraction = new RotateLotsInteraction(map, (id, dir) => {
  const { targetAreaM2, frontMinM, getMethod, setGeomSnapshot } = useManzanoStore.getState();
  const src = useMapStore.getState().drawSource;
  const feat = src?.getFeatureById(id) as Feature<Geometry> | null;
  const geom = feat?.getGeometry();
  if (geom instanceof Polygon) {
    const ring = ((geom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as [number, number]);
    let perimeter = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    setGeomSnapshot(id, { area: polyArea(ring), perimeter });
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
map.removeInteraction(snapEngine);
snapEngineRef.current = null;
rotateLotsCleanupRef.current?.();
rotateLotsCleanupRef.current = null;
if (rotateLotsInteractionRef.current) {
  map.removeInteraction(rotateLotsInteractionRef.current);
  rotateLotsInteractionRef.current = null;
}
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

  useEffect(() => {
    const unsub = useLayersStore.subscribe((state) => {
      const anyLoteVisible = state.layers.some((l) => (l.kind === 'lote' || l.kind === 'manzana') && l.visible);
      const anyCalleVisible = state.layers.some((l) => l.kind === 'calle' && l.visible);
      const anyCotaVisible = state.layers.some((l) => l.kind === 'cota' && l.visible);
      if (drawLayerRef.current) drawLayerRef.current.setVisible(anyLoteVisible);
      if (streetLayerRef.current) streetLayerRef.current.setVisible(anyCalleVisible);
      if (measurementLayerRef.current) measurementLayerRef.current.setVisible(anyCotaVisible);
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
