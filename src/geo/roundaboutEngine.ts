// src/geo/roundaboutEngine.ts
import type { Pt } from './polygonEngine';

/** Parámetros geométricos de una rotonda. `Roundabout` (roundaboutStore) extiende
 *  esto agregando solo identidad (id/name) — una sola fuente de verdad. */
export interface RoundaboutParams {
  center: Pt;
  radiusM: number;
  /** 0 = círculo; 3-8 = polígono regular (triángulo…octógono) */
  sides: number;
  rotation: number;
  roadWidthM: number;
  sidewalkWidthM: number;
}

export interface RoundaboutGeometry {
  /** Borde exterior de calzada (lo que se uniría con las calles que llegan) */
  roadOuter: Pt[];
  /** Borde exterior de vereda */
  sideOuter: Pt[];
  /** Isleta central (null si el radio no deja isleta) */
  island: Pt[] | null;
  /** Circunferencia/polígono del eje central (referencia visual punteada) */
  centerAxis: Pt[];
}

/** Polígono regular de n lados inscrito en una circunferencia de radio
 *  `circumR`, centrado en `center` y rotado `rot` radianes. */
export function ngonRing(center: Pt, circumR: number, n: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push([center[0] + Math.cos(a) * circumR, center[1] + Math.sin(a) * circumR]);
  }
  return pts;
}

/** Circunferencia tesselada; la cantidad de segmentos escala con el radio. */
export function circleRing(center: Pt, radius: number, segs?: number): Pt[] {
  const n = segs ?? Math.max(32, Math.min(160, Math.round(radius * 4)));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n;
    pts.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]);
  }
  return pts;
}

/** Geometría completa de una rotonda a partir de sus parámetros de diseño. */
export function roundaboutGeometry(rb: RoundaboutParams): RoundaboutGeometry {
  const half = rb.roadWidthM / 2;
  const sw = Math.max(0, rb.sidewalkWidthM);

  if (!rb.sides || rb.sides < 3) {
    const islandR = rb.radiusM - half;
    return {
      roadOuter: circleRing(rb.center, rb.radiusM + half),
      sideOuter: circleRing(rb.center, rb.radiusM + half + sw),
      island: islandR > 0.3 ? circleRing(rb.center, islandR) : null,
      centerAxis: circleRing(rb.center, rb.radiusM),
    };
  }

  const n = rb.sides;
  const k = 1 / Math.cos(Math.PI / n); // apotema → circunradio
  const islandR = rb.radiusM - half * k;
  return {
    roadOuter: ngonRing(rb.center, rb.radiusM + half * k, n, rb.rotation),
    sideOuter: ngonRing(rb.center, rb.radiusM + (half + sw) * k, n, rb.rotation),
    island: islandR > 0.3 ? ngonRing(rb.center, islandR, n, rb.rotation) : null,
    centerAxis: ngonRing(rb.center, rb.radiusM, n, rb.rotation),
  };
}

/** Área aproximada de calzada (anillo entre borde de calzada e isleta), en m². */
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