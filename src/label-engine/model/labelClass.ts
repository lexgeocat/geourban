import type { LabelStyleConfig } from './labelModel';
import type { LabelNumberingMode } from './labelNumbering';

export type LabelPlacementStrategy = 'poleOfInaccessibility' | 'centroid' | 'alongLine';

export interface LabelPlacement {
  strategy: LabelPlacementStrategy;
  allowLeaderLine?: boolean;
}

export interface LabelClassNumbering {
  mode: LabelNumberingMode;
  restartPerParent: boolean;
}

export interface LabelClass {
  id: string;
  layerId: string;
  name: string;
  enabled: boolean;
  priority: number;
  style: LabelStyleConfig;
  placement: LabelPlacement;
  numbering?: LabelClassNumbering;
  visibleMinZoom?: number;
  visibleMaxZoom?: number;
  updatedAt: string;
}

export type LabelClassMap = Record<string, LabelClass>;

export function defaultLabelPlacement(): LabelPlacement {
  return { strategy: 'poleOfInaccessibility', allowLeaderLine: false };
}

export function newLabelClassId(): string {
  return `lblc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultLabelClass(layerId: string, style: LabelStyleConfig): LabelClass {
  return {
    id: newLabelClassId(),
    layerId,
    name: 'Por defecto',
    enabled: true,
    priority: 0,
    style,
    placement: defaultLabelPlacement(),
    numbering: { mode: 'numeric', restartPerParent: false },
    updatedAt: new Date().toISOString(),
  };
}
