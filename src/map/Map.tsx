import React, { useEffect, useRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import { OSM, XYZ } from 'ol/source';
import { defaults } from 'ol/control';
import Attribution from 'ol/control/Attribution';
import WebGLVectorLayer from 'ol/layer/WebGLVector';
import VectorSource from 'ol/source/Vector';
import Draw from 'ol/interaction/Draw';
import Snap from 'ol/interaction/Snap';
import { toLonLat, fromLonLat } from 'ol/proj';
import { useLayerStore } from '../store/layerStore';
import { useMapStore } from '../store/mapStore';
import { useDrawStore } from '../store/drawStore';

export default function MapView() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const { visibility } = useLayerStore();
  const drawMode = useDrawStore().mode;

  // --- Inicializar mapa (solo una vez) ---
  useEffect(() => {
    if (!mapDivRef.current) return;

    // Capas base
    const osmLayer = new TileLayer({
      source: new OSM(),
      visible: visibility.osm,
    });
    const satelliteLayer = new TileLayer({
      source: new XYZ({
        url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attributions: '© OpenTopoMap contributors',
      }),
      visible: visibility.satellite,
    });

    const map = new Map({
      target: mapDivRef.current!,
      layers: [osmLayer, satelliteLayer],
      view: new View({
        center: fromLonLat([-68.30, -16.65]),
        zoom: 17,
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

  // --- Visibilidad de capas reactiva ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const osmLayer = map.getLayers().item(0) as TileLayer;
    const satelliteLayer = map.getLayers().item(1) as TileLayer;
    if (osmLayer) osmLayer.setVisible(visibility.osm);
    if (satelliteLayer) satelliteLayer.setVisible(visibility.satellite);
  }, [visibility]);

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