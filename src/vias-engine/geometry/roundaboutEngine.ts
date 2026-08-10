// ─────────────────────────────────────────────────────────────────────────
// NOTA ARQUITECTÓNICA — PARIDAD TS↔RUST (Fase 6.2 del plan)
//
// Esta implementación TypeScript de la geometría de rotonda coexiste
// con la implementación autoritativa en Rust en:
//
//   src-tauri/crates/geourban-geo/src/domains/roads/roundabout.rs
//
// NO es código duplicado para "verificar con TS antes de mandar a
// Rust" — son dos implementaciones deliberadamente distintas:
//
//   1. **TS (este archivo)** — implementación aproximada, sincrónica,
//      rápida. Se usa para:
//        - Pintar la rotonda en el render (preview durante el trazado,
//          feedback inmediato mientras el usuario mueve el mouse).
//        - Hit-test de cursor en `roadSnapSource.ts` para snapping.
//      Si la implementación fuera async (vía `invoke` a Rust),
//      introduciría lag perceptible al arrastrar.
//
//   2. **Rust (`roundabout.rs`)** — implementación autoritativa con GEOS.
//      Se usa para:
//        - Cómputo final cuando el usuario confirma el trazado
//          (`AddRoundaboutCommand.execute`).
//        - Export a archivos (KML/SHP/DXF/GPKG).
//        - Operaciones booleanas con geometría existente.
//
// Si solo cambian las reglas geométricas (ej. fórmula de ochave),
// hay que actualizar **AMBOS** lados. El par de tests de paridad que
// se sugiere en la Fase 6 del plan original (snapshot tests con un
// set fijo de parámetros) detectaría drift automáticamente. Mientras
// esos tests no existan, la verificación es manual:
//   - Dibujar una rotonda en la app.
//   - Exportar a GPKG.
//   - Reimportar y comparar geometría.
// ─────────────────────────────────────────────────────────────────────────

import type { Pt } from '@kernel/geometry/polygonEngine';
import { polyArea } from '@kernel/geometry/polygonEngine';
import { resolutionAwareSegments } from '@kernel/geometry/lod';

export interface RoundaboutParams {
  center: Pt;
  radiusM: number;
  sides: number;
  rotation: number;
  roadWidthM: number;
  sidewalkWidthM: number;
  layerId?: string;
}

export interface RoundaboutGeometry {
  roadOuter: Pt[];
  sideOuter: Pt[];
  island: Pt[] | null;
  centerAxis: Pt[];
}

function ngonRing(center: Pt, circumR: number, n: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push([center[0] + Math.cos(a) * circumR, center[1] + Math.sin(a) * circumR]);
  }
  return pts;
}

function circleRing(center: Pt, radius: number, segs?: number, resolution?: number): Pt[] {
  const n =
    segs ??
    (resolution != null
      ? resolutionAwareSegments(radius, resolution)
      : Math.max(32, Math.min(160, Math.round(radius * 4))));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n;
    pts.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]);
  }
  return pts;
}

export function roundaboutGeometry(rb: RoundaboutParams, resolution?: number): RoundaboutGeometry {
  const half = rb.roadWidthM / 2;
  const sw = Math.max(0, rb.sidewalkWidthM);

  if (!rb.sides || rb.sides < 3) {
    const islandR = rb.radiusM - half;
    return {
      roadOuter: circleRing(rb.center, rb.radiusM + half, undefined, resolution),
      sideOuter: circleRing(rb.center, rb.radiusM + half + sw, undefined, resolution),
      island: islandR > 0.3 ? circleRing(rb.center, islandR, undefined, resolution) : null,
      centerAxis: circleRing(rb.center, rb.radiusM, undefined, resolution),
    };
  }

  const n = rb.sides;
  const k = 1 / Math.cos(Math.PI / n);
  const islandR = rb.radiusM - half * k;
  return {
    roadOuter: ngonRing(rb.center, rb.radiusM + half * k, n, rb.rotation),
    sideOuter: ngonRing(rb.center, rb.radiusM + (half + sw) * k, n, rb.rotation),
    island: islandR > 0.3 ? ngonRing(rb.center, islandR, n, rb.rotation) : null,
    centerAxis: ngonRing(rb.center, rb.radiusM, n, rb.rotation),
  };
}

export function roundaboutRoadAreaM2(rb: RoundaboutParams): number {
  const geom = roundaboutGeometry(rb);
  return Math.max(0, polyArea(geom.roadOuter) - (geom.island ? polyArea(geom.island) : 0));
}

export function validateRoundaboutParams(rb: RoundaboutParams): string | null {
  if (!(rb.radiusM > 0)) return 'El radio debe ser mayor a 0.';
  if (rb.sides !== 0 && rb.sides < 3)
    return 'Un polígono necesita al menos 3 lados (o 0 para círculo).';

  const half = rb.roadWidthM / 2 + Math.max(0, rb.sidewalkWidthM);
  if (rb.sides && rb.sides >= 3) {
    const k = 1 / Math.cos(Math.PI / rb.sides);
    if (half * k > rb.radiusM * 3) {
      return `La calzada (+ vereda) es demasiado ancha para un radio de ${rb.radiusM.toFixed(1)}m con ${rb.sides} lados — el ochave puede autointersectarse. Reducí el ancho o aumentá el radio.`;
    }
  }
  return null;
}
