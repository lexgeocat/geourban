import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import React, { useEffect, useRef } from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import type BaseLayer from 'ol/layer/Base.js';
import VectorLayer from 'ol/layer/Vector.js';
import { defaults } from 'ol/control.js';
import Attribution from 'ol/control/Attribution.js';
import VectorSource from 'ol/source/Vector.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Snap from 'ol/interaction/Snap.js';
import Select from 'ol/interaction/Select.js';
import Translate from 'ol/interaction/Translate.js';
import { unByKey } from 'ol/Observable.js';
import { toLonLat, fromLonLat } from 'ol/proj.js';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import type Geometry from 'ol/geom/Geometry.js';
import { click as clickCondition, pointerMove } from 'ol/events/condition.js';
import { useLayerStore } from '../store/layerStore';
import { useMapStore } from '../store/mapStore';
import { useDrawStore } from '../store/drawStore';
import { useHistoryStore } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { updateFeatureMetrics } from '../geo/metrics';
import { findSnap, createSnapPoints, SNAP_COLORS } from './advancedSnap';
import { createDemoLayers } from './demoLayers';
import { BASE_MAP_DEFS } from './baseMaps';
import { createMeasurementStyle } from './styleFactory';

export default function MapView() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const baseLayerRef = useRef<BaseLayer | null>(null);
  const baseLayerCleanupRef = useRef<(() => void) | null>(null);
  const baseMapInitializedRef = useRef(false);
  const baseMapEffectPrimedRef = useRef(false);
  const demoLayersRef = useRef<ReturnType<typeof createDemoLayers> | null>(null);
  const measurementLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawSrcRef = useRef<VectorSource | null>(null);
  const selectInteractionRef = useRef<Select | null>(null);
  const baseMapId = useLayerStore((s) => s.baseMap);
  const demoVisible = useLayerStore((s) => s.visibility.demo);
  const measurementsVisible = useLayerStore((s) => s.visibility.measurements);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const drawMode = useDrawStore().mode;

  // --- Inicializar mapa (solo una vez) ---
  useEffect(() => {
    if (!mapDivRef.current) return;

    const def = BASE_MAP_DEFS.find((d) => d.id === baseMapId) ?? BASE_MAP_DEFS[0];
    const baseLayer = def.create() as BaseLayer;
    baseLayerRef.current = baseLayer;

    // --- Capa de demo: 3 sub-capas WebGL (LOD 0/1/2) ---
    const demoLayers = createDemoLayers(100);
    demoLayersRef.current = demoLayers;
    const demoLayerList = [demoLayers.lod2, demoLayers.lod1, demoLayers.lod0];

    // --- Capa de dibujo persistente (features del usuario) ---
    const drawSrc = new VectorSource();
    drawSrcRef.current = drawSrc;
    useMapStore.getState().setDrawSource(drawSrc);
    const drawLayer = new WebGLVectorLayer({
      source: drawSrc,
      disableHitDetection: true,
      style: {
        'fill-color': 'rgba(16, 185, 129, 0.30)',
        'stroke-color': '#10b981',
        'stroke-width': 2,
      },
    });
    const measurementLayer = new VectorLayer({
      source: drawSrc,
      visible: measurementsVisible,
      declutter: true,
      style: createMeasurementStyle(),
    });
    measurementLayerRef.current = measurementLayer;

    const map = new Map({
      target: mapDivRef.current!,
      layers: [baseLayer, ...demoLayerList, drawLayer, measurementLayer],
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

    // --- Live cursor coordinates & zoom ---
    const setCursorCoords = useMapStore.getState().setCursorCoords;
    const setZoom = useMapStore.getState().setZoom;
    const view = map.getView();

    map.on('pointermove', (evt) => {
      const lonLat = toLonLat(evt.coordinate);
      setCursorCoords({ x: lonLat[0], y: lonLat[1] });
    });

    const onZoomChange = () => {
      const z = view.getZoom();
      if (z !== undefined) {
        setZoom(z);
        demoLayers.updateVisibility(z);
      }
    };
    view.on('change:resolution', onZoomChange);
    const initialZoom = view.getZoom();
    if (initialZoom !== undefined) {
      setZoom(initialZoom);
      demoLayers.updateVisibility(initialZoom);
    }

    // --- Indicador visual de snap (capa overlay, agregada al final) ---
    const snapIndicatorSrc = new VectorSource();
    const snapIndicatorLayer = new VectorLayer({
      source: snapIndicatorSrc,
      style: new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: '#f59e0b' }),
          stroke: new Stroke({ color: '#fff', width: 1.5 }),
        }),
      }),
    });
    map.addLayer(snapIndicatorLayer);

    const pmKey = map.on('pointermove', (evt) => {
      const mode = useDrawStore.getState().mode;
      // Indicador solo activo en modos donde se usa snap (dibujo)
      if (mode !== 'polygon' && mode !== 'line') {
        snapIndicatorSrc.clear();
        return;
      }
      const ds = drawSrcRef.current;
      if (!ds) return;
      const result = findSnap(evt.coordinate, ds);
      snapIndicatorSrc.clear();
      if (result) {
        const color = SNAP_COLORS[result.type];
        snapIndicatorLayer.setStyle(
          new Style({
            image: new CircleStyle({
              radius: 6,
              fill: new Fill({ color }),
              stroke: new Stroke({ color: '#fff', width: 1.5 }),
            }),
          })
        );
        snapIndicatorSrc.addFeature(
          new Feature({
            geometry: new Point(result.point),
            snapType: result.type,
          })
        );
      }
    });

    useMapStore.getState().setMap(map);
    mapInstanceRef.current = map;

    if (def.attach) {
      baseLayerCleanupRef.current = def.attach(map, baseLayer);
    }
    baseMapInitializedRef.current = true;

    return () => {
      baseLayerCleanupRef.current?.();
      baseLayerCleanupRef.current = null;
      unByKey(pmKey);
      useMapStore.getState().setMap(null);
      useMapStore.getState().setDrawSource(null);
      const m = mapInstanceRef.current;
      if (m) m.setTarget(undefined);
      mapInstanceRef.current = null;
    };
  }, []);

  // --- Cambiar mapa base ---
  useEffect(() => {
    if (!baseMapEffectPrimedRef.current) {
      baseMapEffectPrimedRef.current = true;
      return;
    }

    const map = mapInstanceRef.current;
    const oldLayer = baseLayerRef.current;
    if (!map || !baseMapInitializedRef.current) return;

    baseLayerCleanupRef.current?.();
    baseLayerCleanupRef.current = null;

    const def = BASE_MAP_DEFS.find((d) => d.id === baseMapId) ?? BASE_MAP_DEFS[0];
    const newLayer = def.create() as BaseLayer;
    baseLayerRef.current = newLayer;

    if (oldLayer) {
      map.removeLayer(oldLayer);
    }
    map.getLayers().insertAt(0, newLayer);

    if (def.attach) {
      baseLayerCleanupRef.current = def.attach(map, newLayer);
    }
  }, [baseMapId]);

  // --- Visibilidad de la capa de demo (10K lotes) ---
  useEffect(() => {
    const layers = demoLayersRef.current;
    const map = mapInstanceRef.current;
    if (!layers || !map) return;
    if (demoVisible) {
      const z = map.getView().getZoom() ?? 17;
      layers.updateVisibility(z);
    } else {
      layers.lod0.setVisible(false);
      layers.lod1.setVisible(false);
      layers.lod2.setVisible(false);
    }
  }, [demoVisible]);

  // --- Visibilidad de cotas automáticas ---
  useEffect(() => {
    if (measurementLayerRef.current) {
      measurementLayerRef.current.setVisible(measurementsVisible);
    }
  }, [measurementsVisible]);

  // --- Interacciones según modo activo ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    const src = drawSrcRef.current;
    if (!map || !src) return;

    const toClean: (() => void)[] = [];

 // Limpia interaccion Select previa antes de crear una nueva
    if (selectInteractionRef.current) {
      map.removeInteraction(selectInteractionRef.current);
      selectInteractionRef.current = null;
    }

    // Las capas WebGL (drawLayer, demoLayers) tienen disableHitDetection:true
    // y NO soportan forEachFeatureAtCoordinate. Select/Translate deben
    // restringirse SOLO a measurementLayer (capa Canvas normal), o crashean
    // al mover el mouse. Se usa un array explicito (no funcion) para maxima
    // compatibilidad con el hit-detection interno de OL.
    const hitDetectionLayers = measurementLayerRef.current
      ? [measurementLayerRef.current]
      : [];

    // Modo SELECT: Select (multi con Shift) + Modify + Translate
    if (drawMode === 'select') {
      const select = new Select({
        layers: hitDetectionLayers,
        style: new Style({
          fill: new Fill({ color: 'rgba(0, 212, 255, 0.15)' }),
          stroke: new Stroke({ color: '#00d4ff', width: 2.5 }),
        }),
        multi: true,
        condition: (event) => clickCondition(event) && !pointerMove(event),
      });

      // Re-sincroniza selectionStore <-> Select cada vez que cambia
      select.on('select', () => {
        const selected = select.getFeatures();
        const ids: Array<string | number> = [];
        let primary: string | number | null = null;
        selected.forEach((f) => {
          const id = f.getId();
          if (id !== undefined) {
            ids.push(id as string | number);
            if (primary === null) primary = id as string | number;
          }
        });
        const prev = useSelectionStore.getState().selectedIds;
        prev.forEach((id) => {
          if (!ids.includes(id)) useSelectionStore.getState().remove(id);
        });
        ids.forEach((id) => {
          if (!prev.has(id)) useSelectionStore.getState().add(id);
        });
        useSelectionStore.setState({ primaryId: primary });
        measurementLayerRef.current?.changed();
      });
      map.addInteraction(select);
      selectInteractionRef.current = select;
      toClean.push(() => map.removeInteraction(select));

      // Modify (edicion de vertices)
      const modify = new Modify({
        source: src,
        style: new Style({
          fill: new Fill({ color: 'rgba(245, 158, 11, 0.2)' }),
          stroke: new Stroke({ color: '#f59e0b', width: 2 }),
        }),
      });
      modify.on('modifyend', (event) => {
        event.features.forEach((feature) => {
          updateFeatureMetrics(feature as Feature<Geometry>);
        });
        measurementLayerRef.current?.changed();
        useHistoryStore.getState().pushState(src.getFeatures());
      });
      map.addInteraction(modify);
      toClean.push(() => map.removeInteraction(modify));

      // Translate (mover features completos)
      const translate = new Translate({
        features: select.getFeatures(),
        layers: hitDetectionLayers,
      });
      translate.on('translateend', () => {
        select.getFeatures().forEach((f) => updateFeatureMetrics(f as Feature<Geometry>));
        measurementLayerRef.current?.changed();
        useHistoryStore.getState().pushState(src.getFeatures());
      });
      map.addInteraction(translate);
      toClean.push(() => map.removeInteraction(translate));
    }

    // Modo POLYGON / LINE: snap nativo + snap en puntos medios + Draw
    if (drawMode === 'polygon' || drawMode === 'line') {
      // Snap nativo (vertex/edge)
      const snap = new Snap({ source: src, pixelTolerance: 10, edge: true, vertex: true });
      map.addInteraction(snap);
      toClean.push(() => map.removeInteraction(snap));

      // Snap en puntos medios como vertices virtuales
      const snapPointsSrc = createSnapPoints(src);
      if (snapPointsSrc.getFeatures().length > 0) {
        const midSnap = new Snap({
          source: snapPointsSrc,
          pixelTolerance: 10,
          vertex: true,
          edge: false,
        });
        map.addInteraction(midSnap);
        toClean.push(() => map.removeInteraction(midSnap));
      }

       // Dibujo
      const drawType = drawMode === 'polygon' ? 'Polygon' : 'LineString';
      const draw = new Draw({ source: src, type: drawType });
      draw.on('drawend', (event) => {
        const feature = event.feature as Feature<Geometry>;
        if (drawType === 'LineString') {
          // Draw no asigna id solo; se lo damos para que la subdivision
          // "manual" pueda referenciar esta linea como corte.
          const lineId =
            feature.getId() ?? `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          feature.setId(lineId);
          useDrawStore.getState().setLastDrawnLineId(lineId);
        }
        updateFeatureMetrics(feature);
        measurementLayerRef.current?.changed();
        useHistoryStore.getState().pushState(src.getFeatures());
      });
      map.addInteraction(draw);
      toClean.push(() => map.removeInteraction(draw));
    }

    // Modo ERASE: cada click sobre una feature la borra
    if (drawMode === 'erase') {
      const select = new Select({
        layers: hitDetectionLayers,
        style: new Style({
          fill: new Fill({ color: 'rgba(239, 68, 68, 0.25)' }),
          stroke: new Stroke({ color: '#ef4444', width: 2 }),
        }),
        multi: true,
        condition: (event) => clickCondition(event) && !pointerMove(event),
      });
      select.on('select', (event) => {
        const selected = (event as any).selected ?? [];
        if (selected.length === 0) return;
        const ids: Array<string | number> = [];
        selected.forEach((f: Feature<Geometry>) => {
          const id = f.getId();
          if (id !== undefined) ids.push(id as string | number);
        });
        ids.forEach((id) => useMapStore.getState().deleteFeatureById(id));
        // Limpia la seleccion interna de Select para evitar "fantasmas"
        select.getFeatures().clear();
      });
      map.addInteraction(select);
      selectInteractionRef.current = select;
      toClean.push(() => map.removeInteraction(select));
    }

    return () => {
      toClean.forEach((fn) => fn());
    };
  }, [drawMode]);

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
