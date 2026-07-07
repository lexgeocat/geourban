import React, { useEffect, useRef } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import { OSM, XYZ } from 'ol/source';
import WebGLVectorLayer from 'ol/layer/WebGLVector';
import VectorSource from 'ol/source/Vector';
import { Feature } from 'ol';
import { Polygon } from 'ol/geom';
import { useLayerStore } from '../store/layerStore';

// Helper to generate 10k square polygons in a grid (100x100)
function generateGridFeatures(countPerSide: number = 100): Feature<Polygon>[] {
  const size = 1; // each cell size
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

  // Initialize map once
  useEffect(() => {
    if (!mapDivRef.current) return;

    // Base layers
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

    // Vector layer with 10k polygons (WebGL for performance)
    const vectorSource = new VectorSource({
      features: generateGridFeatures(100), // 100x100 = 10,000
    });
    const polygonsLayer = new WebGLVectorLayer({
      source: vectorSource,
      style: {
        fillColor: '#4f46e5',
        strokeColor: '#1e40af',
        strokeWidth: 1,
        opacity: 0.6,
      },
      visible: visibility.polygons,
    });

    const map = new Map({
      target: mapDivRef.current,
      layers: [osmLayer, satelliteLayer, polygonsLayer],
      view: new View({
        center: [0, 0],
        zoom: 2,
      }),
    });

    // Fit view to all polygons on first render
    map.once('rendercomplete', () => {
      const extent = vectorSource.getExtent();
      map.getView().fit(extent, { size: map.getSize(), maxZoom: 10, padding: [20, 20, 20, 20] });
    });

    mapInstanceRef.current = map;

    // Cleanup on unmount
    return () => {
      map.setTarget(null);
      mapInstanceRef.current = null;
    };
  }, []);

  // Update layer visibility when store changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    // Layers order: 0=osm,1=satellite,2=polygons
    const osmLayer = map.getLayers().item(0) as TileLayer;
    const satelliteLayer = map.getLayers().item(1) as TileLayer;
    const polygonsLayer = map.getLayers().item(2) as WebGLVectorLayer;
    if (osmLayer) osmLayer.setVisible(visibility.osm);
    if (satelliteLayer) satelliteLayer.setVisible(visibility.satellite);
    if (polygonsLayer) polygonsLayer.setVisible(visibility.polygons);
  }, [visibility]);

  return <div ref={mapDivRef} className="h-full w-full" />;
}
