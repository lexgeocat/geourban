// src/geo/roundaboutEngine.ts
import type { Pt } from './polygonEngine';
import { resolutionAwareSegments } from './lod';

export interface RoundaboutParams {
  center: Pt;
  radiusM: number;
  sides: number;
  rotation: number;
  roadWidthM: number;
  sidewalkWidthM: number;
}

export interface RoundaboutGeometry {
  roadOuter: Pt[];
  sideOuter: Pt[];
  island: Pt[] | null;
  centerAxis: Pt[];
}

export function ngonRing(center: Pt, circumR: number, n: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push([center[0] + Math.cos(a) * circumR, center[1] + Math.sin(a) * circumR]);
  }
  return pts;
}

/**
 * Circunferencia tesselada. Si se pasa `resolution` (unidades de mapa
 * por píxel, la vigente al momento de pintar), la cantidad de segmentos
 * se calcula para que el error de tesselación no supere ~1.5px en
 * pantalla — a diferencia del criterio viejo (fijo por radio), esto
 * baja los segmentos automáticamente cuando el usuario aleja el zoom.
 * Sin `resolution` (o con `segs` explícito) se mantiene el
 * comportamiento anterior, para no romper otros call-sites.
 */
export function circleRing(center: Pt, radius: number, segs?: number, resolution?: number): Pt[] {
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

/** Geometría completa de una rotonda. `resolution` es opcional — pasarla
 *  desde el postrender habilita el LOD de `circleRing`; los polígonos
 *  regulares (`sides >= 3`) no la necesitan, su vértice count depende
 *  solo de `sides`, no de tesselación. */
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
  return Math.max(0, ringArea(geom.roadOuter) - (geom.island ? ringArea(geom.island) : 0));
}

function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}