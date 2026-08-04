// src/commands/core/commandContext.ts
//
// Extraído de Command.ts para romper el ciclo de imports
// (Command ↔ mapStore ↔ CommandStack ↔ Command). El ciclo era
// inocuo en runtime pero rompía la carga de tests que importan
// `AddLayerCommand` (y por lo tanto `Command`) desde un test file
// antes de que `mapStore` se hubiera inicializado.
//
// `getCommandContext` solo necesita leer del store de mapa,
// no del stack de comandos. Se importa desde CommandStack.ts
// sin volver a entrar en Command.ts.

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
