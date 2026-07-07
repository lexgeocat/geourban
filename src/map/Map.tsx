import React, { useEffect, useRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import { OSM, XYZ } from 'ol/source';
import WebGLVectorLayer from 'ol/layer/WebGLVector';
import VectorSource from 'ol/source/Vector';
import Draw from 'ol/interaction/Draw';
import Snap from 'ol/interaction/Snap';
import { Feature } from 'ol';
import { Polygon } from 'ol/geom';
import { useLayerStore } from '../store/layerStore';
import { useMapStore } from '../store/mapStore';
import { useDrawStore } from '../store/drawStore';

// Helper: generar 10 000 polígonos en una cuadrícula 100×100
function generateGridFeatures(countPerSide: number = 100): Feature<Polygon>[] {
  const size = 1; // tamaño de celda
  const features: Feature<Polygon>[] = [];
  for (let i = 0; i < countPerSide; i++) {
    for (let j = 0; j < countPerSide; j++) {
      const x = i * size;
      const y = j * size;
      const polygon = new Polygon([
        [
          [x, y],
          [x + size, y],
          [x + size, y + size],
          [x, y + size],
          [x, y],
        ],
      ]);
      const feat = new Feature({ geometry: polygon, id: i * countPerSide + j });
      features.push(feat);
    }
  }
  return features;
}

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

    // Capa con 10 k polígonos (WebGL)
    const vectorSource = new VectorSource({
      features: generateGridFeatures(100),
    });
    const polygonsLayer = new WebGLVectorLayer({
      source: vectorSource,
      style: {
        fill: '#4f46e5',
        stroke: '#1e40af',
        strokeWidth: 1,
        opacity: 0.6,
      },
      visible: visibility.polygons,
    });

    const map = new Map({
      target: mapDivRef.current!,
      layers: [osmLayer, satelliteLayer, polygonsLayer],
      view: new View({
        center: [0, 0],
        zoom: 2,
      }),
      controls: defaultControls({ attribution: false }).extend([
        new Attribution({
          collapsible: false,
          className: 'custom-attribution',
        })
      ]),
    });

    // Ajustar vista al cargar los polígonos
    map.once('rendercomplete', () => {
      const extent = vectorSource.getExtent();
      map.getView().fit(extent, { size: map.getSize(), maxZoom: 10, padding: [20, 20, 20, 20] });
    });

    // Guardar instancia en store global
    useMapStore.getState().setMap(map);
    mapInstanceRef.current = map;

    // Cleanup al desmontar
    return () => {
      useMapStore.getState().setMap(null);
      map.setTarget(null);
      mapInstanceRef.current = null;
    };
  }, []);

  // --- Visibilidad de capas reactiva ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const osmLayer = map.getLayers().item(0) as TileLayer;
    const satelliteLayer = map.getLayers().item(1) as TileLayer;
    const polygonsLayer = map.getLayers().item(2) as WebGLVectorLayer;
    if (osmLayer) osmLayer.setVisible(visibility.osm);
    if (satelliteLayer) satelliteLayer.setVisible(visibility.satellite);
    if (polygonsLayer) polygonsLayer.setVisible(visibility.polygons);
  }, [visibility]);

  // --- Lógica de dibujo y snapping ---
  // Creamos la capa donde se guardarán los dibujos del usuario
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const drawSource = new VectorSource();
    const drawLayer = new WebGLVectorLayer({
      source: drawSource,
      style: {
        fill: '#10b981', // verde suave
        stroke: '#059669',
        strokeWidth: 2,
        opacity: 0.5,
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
    let drawInteraction: any = null;
    if (drawMode === 'polygon') {
      drawInteraction = new Draw({ source: drawSource, type: 'Polygon' });
    } else if (drawMode === 'line') {
      drawInteraction = new Draw({ source: drawSource, type: 'LineString' });
    }
    if (drawInteraction) {
      map.addInteraction(drawInteraction);
    }

    // Cleanup cuando cambie el modo o al desmontar
    return () => {
      if (drawInteraction) map.removeInteraction(drawInteraction);
      map.removeInteraction(snap);
      map.removeLayer(drawLayer);
    };
    // Dependence: drawMode (reactiva al cambiar el modo)
  }, [drawMode]);

  return <div ref={mapDivRef} className="h-full w-full" />;
}