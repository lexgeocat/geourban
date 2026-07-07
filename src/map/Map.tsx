import React, { useEffect, useRef } from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import type BaseLayer from 'ol/layer/Base.js';
import VectorLayer from 'ol/layer/Vector.js';
import { defaults } from 'ol/control.js';
import Attribution from 'ol/control/Attribution.js';
import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import VectorSource from 'ol/source/Vector.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Snap from 'ol/interaction/Snap.js';
import { unByKey } from 'ol/Observable.js';
import { toLonLat, fromLonLat } from 'ol/proj.js';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useLayerStore } from '../store/layerStore';
import { useMapStore } from '../store/mapStore';
import { useDrawStore } from '../store/drawStore';
import { useHistoryStore } from '../store/historyStore';
import { updateFeatureMetrics } from '../geo/metrics';
import { BASE_MAP_DEFS } from './baseMaps';
import type { BaseMapId } from './baseMaps';
import { generateDemoGrid } from './demoDataset';
import { findSnap, createSnapPoints, SNAP_COLORS } from './advancedSnap';
import { emitMetricsInvalidated, emitMetricsUpdated } from './metricsEvents';
import { createMeasurementStyle } from './styleFactory';

export default function MapView() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const baseLayerRef = useRef<BaseLayer | null>(null);
  const baseLayerCleanupRef = useRef<(() => void) | null>(null);
  const baseMapInitializedRef = useRef(false);
  const baseMapEffectPrimedRef = useRef(false);
  const demoLayerRef = useRef<WebGLVectorLayer | null>(null);
  const measurementLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const demoSrcRef = useRef<VectorSource | null>(null);
  const drawSrcRef = useRef<VectorSource | null>(null);
  const highlightSrcRef = useRef<VectorSource | null>(null);
  const selectedFeatureRef = useRef<Feature<Geometry> | null>(null);
  const baseMapId = useLayerStore((s) => s.baseMap);
  const demoVisible = useLayerStore((s) => s.visibility.demo);
  const measurementsVisible = useLayerStore((s) => s.visibility.measurements);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const drawMode = useDrawStore().mode;

  // --- Inicializar mapa (solo una vez) ---
  useEffect(() => {
    if (!mapDivRef.current) return;

    // Capa base única (se intercambia la fuente vía efecto baseMap)
    const def = BASE_MAP_DEFS.find((d) => d.id === baseMapId) ?? BASE_MAP_DEFS[0];
    const baseLayer = def.create();
    baseLayerRef.current = baseLayer;

    // Capa de demostración: 10 000 polígonos sintéticos con WebGL optimizado
    const demoSrc = new VectorSource({
      features: generateDemoGrid(100),
    });
    demoSrcRef.current = demoSrc;
    const demoLayer = new WebGLVectorLayer({
      source: demoSrc,
      visible: false, // apagada por defecto
      disableHitDetection: true, // solo visual → evita latencia en hover/click
      style: {
        // LOD: invisible por debajo de zoom 14 para no saturar la GPU
        'fill-color': ['case', ['>=', ['zoom'], 14], 'rgba(0, 212, 255, 0.15)', 'transparent'],
        'stroke-color': ['case', ['>=', ['zoom'], 14], 'rgba(0, 212, 255, 0.5)', 'transparent'],
        'stroke-width': ['case', ['>=', ['zoom'], 14], 1, 0],
      },
    });
    demoLayerRef.current = demoLayer;

    // Capa de dibujo persistente (features dibujadas por el usuario)
    const drawSrc = new VectorSource();
    drawSrcRef.current = drawSrc;
    useMapStore.getState().setDrawSource(drawSrc);
    const drawLayer = new WebGLVectorLayer({
      source: drawSrc,
      style: {
        'fill-color': 'rgba(16, 185, 129, 0.4)',
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
      layers: [baseLayer, demoLayer, drawLayer, measurementLayer],
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

    map.on('pointermove', (evt) => {
      const lonLat = toLonLat(evt.coordinate);
      setCursorCoords({ x: lonLat[0], y: lonLat[1] });
    });

    map.getView().on('change:resolution', () => {
      const z = map.getView().getZoom();
      if (z !== undefined) setZoom(z);
    });

    // Set initial zoom
    const initialZoom = map.getView().getZoom();
    if (initialZoom !== undefined) setZoom(initialZoom);

    // --- Capa de highlight para selección espacial ---
    const hlSrc = new VectorSource();
    highlightSrcRef.current = hlSrc;
    const hlLayer = new VectorLayer({
      source: hlSrc,
      style: new Style({
        fill: new Fill({ color: 'rgba(255, 200, 0, 0.25)' }),
        stroke: new Stroke({ color: '#f59e0b', width: 2 }),
      }),
    });
    map.addLayer(hlLayer);

    // --- Selección de lotes con clic (modo 'select') ---
    map.on('click', (evt) => {
      const currentMode = useDrawStore.getState().mode;
      if (currentMode !== 'select') return;

      // Buscar en: 1) features dibujadas, 2) demo layer
      const sources = [drawSrcRef.current, demoSrcRef.current].filter(Boolean);
      if (selectedFeatureRef.current) {
        selectedFeatureRef.current.set('selected', false);
        selectedFeatureRef.current.changed();
        selectedFeatureRef.current = null;
      }
      hlSrc.clear();
      for (const s of sources) {
        const found = s!.getFeaturesAtCoordinate(evt.coordinate);
        if (found.length > 0) {
          const feature = found[0] as Feature<Geometry>;
          feature.set('selected', true);
          feature.changed();
          selectedFeatureRef.current = feature;
          hlSrc.addFeature(feature);
          measurementLayerRef.current?.changed();
          return;
        }
      }
      measurementLayerRef.current?.changed();
    });

    useMapStore.getState().setMap(map);
    mapInstanceRef.current = map;

    if (def.attach) {
      baseLayerCleanupRef.current = def.attach(map, baseLayer);
    }
    baseMapInitializedRef.current = true;

    // Cleanup al desmontar
    return () => {
      baseLayerCleanupRef.current?.();
      baseLayerCleanupRef.current = null;
      useMapStore.getState().setMap(null);
      useMapStore.getState().setDrawSource(null);
      map.setTarget(undefined);
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
    const newLayer = def.create();
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
    if (demoLayerRef.current) {
      demoLayerRef.current.setVisible(demoVisible);
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

    if (drawMode === 'polygon' || drawMode === 'line') {
      // Snap nativo sobre features dibujadas
      const snap = new Snap({ source: src, pixelTolerance: 10, edge: true, vertex: true });
      map.addInteraction(snap);
      toClean.push(() => map.removeInteraction(snap));

      // Puntos medios como vértices virtuales para snap
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
        emitMetricsInvalidated(feature);
        const metrics = updateFeatureMetrics(feature);
        emitMetricsUpdated(feature, metrics);
        measurementLayerRef.current?.changed();
        useHistoryStore.getState().pushState(src.getFeatures());
      });
      map.addInteraction(draw);
      toClean.push(() => map.removeInteraction(draw));

      // Indicador visual de snap perpendicular
      const perpIndicator = new VectorSource();
      const perpLayer = new VectorLayer({
        source: perpIndicator,
        style: new Style({
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({ color: '#f59e0b' }),
            stroke: new Stroke({ color: '#fff', width: 1 }),
          }),
        }),
      });
      map.addLayer(perpLayer);
      toClean.push(() => map.removeLayer(perpLayer));

      const pmKey = map.on('pointermove', (evt) => {
        const ds = drawSrcRef.current;
        if (!ds) return;
        const result = findSnap(evt.coordinate, ds);
        perpIndicator.clear();
        if (result) {
          const color = SNAP_COLORS[result.type] ?? '#f59e0b';
          perpIndicator.addFeature(
            new Feature({
              geometry: new Point(result.point),
              snapType: result.type,
            })
          );
          perpLayer.setStyle(
            new Style({
              image: new CircleStyle({
                radius: 5,
                fill: new Fill({ color }),
                stroke: new Stroke({ color: '#fff', width: 1 }),
              }),
            })
          );
        }
      });
      toClean.push(() => unByKey(pmKey));
    }

    if (drawMode === 'select') {
      const modify = new Modify({
        source: src,
        style: new Style({
          fill: new Fill({ color: 'rgba(245, 158, 11, 0.2)' }),
          stroke: new Stroke({ color: '#f59e0b', width: 2 }),
        }),
      });
      modify.on('modifyend', (event) => {
        event.features.forEach((feature) => {
          const typedFeature = feature as Feature<Geometry>;
          emitMetricsInvalidated(typedFeature);
          const metrics = updateFeatureMetrics(typedFeature);
          emitMetricsUpdated(typedFeature, metrics);
        });
        measurementLayerRef.current?.changed();
        useHistoryStore.getState().pushState(src.getFeatures());
      });
      map.addInteraction(modify);
      toClean.push(() => map.removeInteraction(modify));
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
