import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type Map from 'ol/Map.js';
import { useMapStore } from '../store/mapStore';

export interface CommandContext {
  drawSource: VectorSource;
  getMap: () => Map | null;
}

export abstract class Command {
  abstract readonly label: string;
  readonly coalesceKey?: string;
  abstract execute(ctx: CommandContext): void | Promise<void>;
  undo?(ctx: CommandContext): void | Promise<void>;
  redo?(ctx: CommandContext): void | Promise<void>;
}

/** Helper para obtener un contexto fresco en cualquier punto. */
export function getCommandContext(): CommandContext | null {
  const drawSource = useMapStore.getState().drawSource;
  if (!drawSource) return null;
  return {
    drawSource,
    getMap: () => useMapStore.getState().mapInstance,
  };
}

export function featureIds(features: Array<Feature<Geometry>>): Array<string | number> {
  return features.map((f) => f.getId()).filter((id): id is string | number => id !== undefined);
}
