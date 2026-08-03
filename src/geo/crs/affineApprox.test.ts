// src/geo/crs/affineApprox.test.ts
import { describe, it, expect } from 'vitest';
import { transform } from 'ol/proj.js';
import { fromLonLat } from 'ol/proj.js';
import { register } from 'ol/proj/proj4.js';
import proj4 from 'proj4';
import {
  fitAffineForExtent,
  applyAffine,
  applyAffineBatch,
  extentOfPoints,
  fitAffineLeastSquares,
  maxResidual,
  IDENTITY_AFFINE,
} from './affineApprox';
import { DISPLAY_PROJECTION } from './projections';

const EPSG_32719 = 'EPSG:32719'; // UTM 19S — misma zona que el default del store

function ensureZoneRegistered() {
  proj4.defs(EPSG_32719, '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs +type=crs');
  register(proj4);
}

describe('fitAffineForExtent', () => {
  ensureZoneRegistered();

  it('aproxima la transformación EPSG:3857 -> UTM con error sub-centimétrico a escala urbana (~5km)', () => {
    const center = fromLonLat([-68.3, -16.5]) as [number, number];
    const half = 2500; // ~5km de lado
    const extent: [number, number, number, number] = [
      center[0] - half, center[1] - half, center[0] + half, center[1] + half,
    ];

    const fit = fitAffineForExtent(extent, EPSG_32719);
    expect(fit).not.toBeNull();
    expect(fit!.maxErrorM).toBeLessThan(0.01);

    // Validación cruzada: puntos NO usados en el fit (dentro del extent).
    const probes: [number, number][] = [
      [center[0] - half * 0.37, center[1] + half * 0.12],
      [center[0] + half * 0.61, center[1] - half * 0.44],
      [center[0], center[1]],
    ];
    for (const p of probes) {
      const exact = transform(p, DISPLAY_PROJECTION, EPSG_32719) as [number, number];
      const approx = applyAffine(p, fit!.transform);
      const err = Math.hypot(approx[0] - exact[0], approx[1] - exact[1]);
      expect(err).toBeLessThan(0.01);
    }
  });

  it('devuelve null si hay menos de 3 puntos o son colineales', () => {
    const fit = fitAffineLeastSquares([[0, 0], [1, 1]], [[0, 0], [1, 1]]);
    expect(fit).toBeNull();
  });

  it('la identidad reproduce el punto de entrada sin cambios', () => {
    const p: [number, number] = [123.45, -678.9];
    expect(applyAffine(p, IDENTITY_AFFINE)).toEqual(p);
  });
});

describe('applyAffineBatch / extentOfPoints', () => {
  it('aplica la misma transformación a un lote de puntos', () => {
    const t = { a: 2, b: 0, c: 10, d: 0, e: 3, f: -5 };
    const pts: [number, number][] = [[0, 0], [1, 1], [2, 2]];
    const out = applyAffineBatch(pts, t);
    expect(out).toEqual([[10, -5], [12, -2], [14, 1]]);
  });

  it('calcula el bounding box de una lista de puntos', () => {
    const pts: [number, number][] = [[3, -1], [-2, 5], [0, 0]];
    expect(extentOfPoints(pts)).toEqual([-2, -1, 3, 5]);
  });
});

describe('maxResidual', () => {
  it('es cero cuando el afín reproduce exactamente los puntos de muestra', () => {
    const src: [number, number][] = [[0, 0], [10, 0], [0, 10], [10, 10]];
    const dst: [number, number][] = [[5, 5], [15, 5], [5, 15], [15, 15]];
    const fit = fitAffineLeastSquares(src, dst)!;
    expect(maxResidual(fit, src, dst)).toBeLessThan(1e-9);
  });
});