export function computeAreaCorrectionFactor(
  rawAreaM2: number,
  trueAreaM2: number | undefined,
): number {
  if (!trueAreaM2 || !(trueAreaM2 > 1e-6) || !(rawAreaM2 > 1e-6)) return 1;
  const factor = rawAreaM2 / trueAreaM2;
  if (!Number.isFinite(factor) || factor <= 0) return 1;

  const MIN_FACTOR = 0.2;
  const MAX_FACTOR = 5;
  if (factor < MIN_FACTOR || factor > MAX_FACTOR) return 1;
  return factor;
}

export function computeLinearCorrectionFactor(areaCorrectionFactor: number): number {
  return Math.sqrt(areaCorrectionFactor);
}