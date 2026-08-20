const counters = new Map<string, number>();

export function nextLayerFid(layerId: string): number {
  const next = (counters.get(layerId) ?? 0) + 1;
  counters.set(layerId, next);
  return next;
}

export function bumpLayerFidCounter(layerId: string, fid: number | undefined): void {
  if (fid == null || !Number.isFinite(fid)) return;
  const current = counters.get(layerId) ?? 0;
  if (fid > current) counters.set(layerId, fid);
}

export function resetLayerFidRegistry(): void {
  counters.clear();
}
