// src/geo/roads/types.ts
//
// Tipos públicos del motor de red vial. Desde la Fase 2.7 el motor es
// exclusivamente nativo (Rust/GEOS vía Tauri); este módulo preserva las
// formas de datos compartidas entre el frontend y la crate `geourban-geo`.
//
// Antes vivían en roadNetworkNet.ts (motor JS, retirado en 2.7).

import type { Pt } from '../math/polygonEngine';

export interface RoadNetworkNet {
  road: Pt[][][];
  outer: Pt[][][];
}
