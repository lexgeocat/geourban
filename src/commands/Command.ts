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
  /**
   * Soporte de coalescing dentro del Command Stack (Fase 2). Si el comando
   * anterior de la pila comparte `coalesceKey` con este y ambos ocurrieron
   * dentro de la ventana de coalescing, el CommandStack llama
   * `nuevo.coalesceInto(anterior)`. Si devuelve `true`, el nuevo comando se
   * descarta (su efecto ya se aplicó a drawSource) y el anterior absorbe el
   * resultado — así el primer undo revierte TODA la secuencia coalescida,
   * no solo el último paso. Sin esta implementación, cada comando con
   * `coalesceKey` se apila igual como un paso de undo independiente.
   */
  coalesceInto?(previous: Command): boolean;
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