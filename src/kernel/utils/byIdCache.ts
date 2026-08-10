/**
 * Memoiza un `Map<id, T>` construido a partir de un array `T[]`.
 *
 * La memoización es **por igualdad referencial** del array fuente:
 * si Zustand (u otro sistema) devuelve la misma referencia de array entre
 * llamadas (caso normal cuando el estado no cambió), devolvemos el Map
 * cacheado sin reconstruirlo. Cuando el array cambia (nuevo objeto),
 * reconstruimos el Map.
 *
 * Uso típico: selectores que indexan capas/features por id y se llaman
 * muchas veces por frame (pintores de OpenLayers).
 *
 * Ejemplo:
 *   const getLayerById = createByIdCache<Layer>();
 *   ...
 *   const byId = getLayerById(useLayersStore.getState().layers);
 *   const layer = byId.get('layer-xyz');
 */
export function createByIdCache<T extends { id: string }>() {
  let cache: { source: T[]; map: Map<string, T> } | null = null;
  return (source: T[]): Map<string, T> => {
    if (cache && cache.source === source) return cache.map;
    const map = new Map(source.map((item) => [item.id, item] as const));
    cache = { source, map };
    return map;
  };
}
