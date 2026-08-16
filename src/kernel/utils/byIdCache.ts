export function createByIdCache<T extends { id: string }>() {
  let cache: { source: T[]; map: Map<string, T> } | null = null;
  return (source: T[]): Map<string, T> => {
    if (cache && cache.source === source) return cache.map;
    const map = new Map(source.map((item) => [item.id, item] as const));
    cache = { source, map };
    return map;
  };
}
