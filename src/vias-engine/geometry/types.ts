import type { Pt } from '@kernel/geometry/polygonEngine';

export interface RoadNetworkNet {
  road: Pt[][][];
  outer: Pt[][][];
}
