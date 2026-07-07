import React, { useEffect, useRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { defaults } from 'ol/control';
import Attribution from 'ol/control/Attribution';
import WebGLVectorLayer from 'ol/layer/WebGLVector';
import VectorSource from 'ol/source/Vector';
import Draw from 'ol/interaction/Draw';
import Snap from 'ol/interaction/Snap';
import { toLonLat, fromLonLat } from 'ol/proj';
import { Fill, Stroke, Style } from 'ol/style';
import { useLayerStore } from '../store/layerStore';
import { useMapStore } from '../store/mapStore';
import { useDrawStore } from '../store/drawStore';
import { BASE_MAP_DEFS } from './baseMaps';
import type { BaseMapId } from './baseMaps';
import { generateDemoGrid } from './demoDataset';

export default function MapView() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const baseLayerRef = useRef<TileLayer | null>(null);
  const demoLayerRef = useRef<WebGLVectorLayer | null>(null);
  const demoSrcRef = useRef<VectorSource | null>(null);
  const highlightSrcRef = useRef<VectorSource | null>(null);
  const baseMapId = useLayerStore((s) => s.baseMap);
  const demoVisible = useLayerStore((s) => s.visibility.demo);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const drawMode = useDrawStore().mode;

  // --- Inicializar mapa (solo una vez) ---
  useEffect(() => {
    if (!mapDivRef.current) return;

    // Capa base única (se intercambia la fuente vía efecto baseMap)
    const def = BASE_MAP_DEFS.find((d) => d.id === baseMapId) ?? BASE_MAP_DEFS[0];
    const baseLayer = def.create();
    baseLayerRef.current = baseLayer;

    // Capa de demostración: 10 000 polígonos sintéticos con WebGL optimizado
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
        'fill-color': [
          'case',
          ['>=', ['zoom'], 14],
          'rgba(0, 212, 255, 0.15)',
          'transparent',
        ],
        'stroke-color': [
          'case',
          ['>=', ['zoom'], 14],
          'rgba(0, 212, 255, 0.5)',
          'transparent',
        ],
        'stroke-width': ['case', ['>=', ['zoom'], 14], 1, 0],
      },
    });
    demoLayerRef.current = demoLayer;

    const map = new Map({
      target: mapDivRef.current!,
      layers: [baseLayer, demoLayer],
      view: new View({
        center: fromLonLat(viewConfig.center),
        zoom: viewConfig.zoom,
      }),
      controls: defaults({ attribution: false }).extend([
        new Attribution({
          collapsible: false,
          className: 'custom-attribution',
        })
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
      if (!demoSrcRef.current) return;

      const found = demoSrcRef.current.getFeaturesAtCoordinate(evt.coordinate);
      hlSrc.clear();
      if (found.length > 0) {
        hlSrc.addFeature(found[0]);
      }
    });

    // Guardar instancia en store global
    useMapStore.getState().setMap(map);
    mapInstanceRef.current = map;

    // Cleanup al desmontar
    return () => {
      useMapStore.getState().setMap(null);
      map.setTarget(undefined);
      mapInstanceRef.current = null;
    };
  }, []);

  // --- Cambiar mapa base (intercambia el TileLayer completo) ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    const oldLayer = baseLayerRef.current;
    if (!map) return;

    const def = BASE_MAP_DEFS.find((d) => d.id === baseMapId) ?? BASE_MAP_DEFS[0];
    const newLayer = def.create();
    baseLayerRef.current = newLayer;

    // Reemplazar la capa base en el map (siempre en índice 0)
    if (oldLayer) {
      map.removeLayer(oldLayer);
    }
    map.getLayers().insertAt(0, newLayer);
  }, [baseMapId]);

  // --- Visibilidad de la capa de demo (10K lotes) ---
  useEffect(() => {
    if (demoLayerRef.current) {
      demoLayerRef.current.setVisible(demoVisible);
    }
  }, [demoVisible]);

  // --- Lógica de dibujo y snapping ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // No draw interaction for select/pan/none modes
    if (drawMode !== 'polygon' && drawMode !== 'line') return;

    const drawSource = new VectorSource();
    const drawLayer = new WebGLVectorLayer({
      source: drawSource,
      style: {
        'fill-color': 'rgba(16, 185, 129, 0.5)',
        'stroke-color': '#059669',
        'stroke-width': 2,
      },
    });
    map.addLayer(drawLayer);

    // Interacción de snapping (vértice y arista)
    const snap = new Snap({
      source: drawSource,
      pixelTolerance: 10,
      edge: true,
      vertex: true,
    });
    map.addInteraction(snap);

    // Interacción de dibujo según el modo seleccionado
    const drawType = drawMode === 'polygon' ? 'Polygon' : 'LineString';
    const drawInteraction = new Draw({ source: drawSource, type: drawType });
    map.addInteraction(drawInteraction);

    // Cleanup cuando cambie el modo o al desmontar
    return () => {
      map.removeInteraction(drawInteraction);
      map.removeInteraction(snap);
      map.removeLayer(drawLayer);
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