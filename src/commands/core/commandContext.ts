import type VectorSource from 'ol/source/Vector.js';
import type Map from 'ol/Map.js';
import { useMapStore } from '../../store/map/mapStore';

export interface CommandContext {
  drawSource: VectorSource;
  getMap: () => Map | null;
}

export function getCommandContext(): CommandContext | null {
  const drawSource = useMapStore.getState().drawSource;
  if (!drawSource) return null;
  return {
    drawSource,
    getMap: () => useMapStore.getState().mapInstance,
  };
}
