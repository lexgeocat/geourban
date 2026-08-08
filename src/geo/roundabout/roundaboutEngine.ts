import type { Pt } from '../math/polygonEngine';
import { polyArea } from '../math/polygonEngine';
import { resolutionAwareSegments } from '../math/lod';

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
  if (rb.sides !== 0 && rb.sides < 3) return 'Un polígono necesita al menos 3 lados (o 0 para círculo).';

  const half = rb.roadWidthM / 2 + Math.max(0, rb.sidewalkWidthM);
  if (rb.sides && rb.sides >= 3) {
    const k = 1 / Math.cos(Math.PI / rb.sides);
    if (half * k > rb.radiusM * 3) {
      return `La calzada (+ vereda) es demasiado ancha para un radio de ${rb.radiusM.toFixed(1)}m con ${rb.sides} lados — el ochave puede autointersectarse. Reducí el ancho o aumentá el radio.`;
    }
  }
  return null;
}