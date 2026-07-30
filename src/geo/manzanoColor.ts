export const MZN_COLORS = [
  '#58a6ff', '#3fb950', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
] as const;

export const MZN_COLOR_COUNT = MZN_COLORS.length;

export function manzanoDisplayColor(colorIdx: number): string {
  return MZN_COLORS[((colorIdx % MZN_COLOR_COUNT) + MZN_COLOR_COUNT) % MZN_COLOR_COUNT];
}
