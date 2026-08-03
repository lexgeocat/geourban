// src/geo/crs/affineCacheTiled.test.ts
//
// Valida el fix de Fase 5 robustecida contra el caso real de producción
// que rompía el caché de extent único: extent alargado (~11.2x0.9km) con
// err=300.20mm medido. Con el mosaico, el tamaño/forma del extent total
// del proyecto deja de importar — cada punto se resuelve contra un tile
// fijo de ~1km.
import { describe, it, expect, beforeEach } from 'vitest';
import { register } from 'ol/proj/proj4.js';
import proj4 from 'proj4';
import { fromLonLat, transform } from 'ol/proj.js';
import { TiledAffineCache, MAX_ACCEPTABLE_ERROR_M } from './affineCache';
import { DISPLAY_PROJECTION } from './projections';

const EPSG_32719 = 'EPSG:32719';

function registerZone() {
  proj4.defs(EPSG_32719, '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs +type=crs');
  register(proj4);
}

describe('TiledAffineCache — Fase 5 robustecida (mosaico UTM)', () => {
  const center = fromLonLat([-68.3, -16.65]) as [number, number];

  beforeEach(() => {
    registerZone();
  });

  it('mantiene el error bajo MAX_ACCEPTABLE_ERROR_M sobre un extent muy alargado (caso real: ~11km x ~1km, antes daba err=300.20mm)', () => {
    const cache = new TiledAffineCache({ telemetry: false });
    const n = 60;
    let maxErr = 0;
    for (let i = 0; i <= n; i++) {
      const x = center[0] - 5600 + (i / n) * 11200;
      const y = center[1] + (i % 2 === 0 ? -450 : 450);
      const pt: [number, number] = [x, y];
      const approx = cache.applyPoint(EPSG_32719, pt);
      const exact = transform(pt, DISPLAY_PROJECTION, EPSG_32719) as [number, number];
      const err = Math.hypot(approx[0] - exact[0], approx[1] - exact[1]);
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThan(MAX_ACCEPTABLE_ERROR_M);
  });

  it('es continua en los bordes de tile: no hay salto mayor al margen de error combinado de los dos tiles vecinos', () => {
    const cache = new TiledAffineCache({ telemetry: false });
    const tileSizeM = 1000;
    const boundaryX = Math.round(center[0] / tileSizeM) * tileSizeM;
    const y = center[1];
    const left: [number, number] = [boundaryX - 0.01, y];
    const right: [number, number] = [boundaryX + 0.01, y];

    const approxLeft = cache.applyPoint(EPSG_32719, left);
    const approxRight = cache.applyPoint(EPSG_32719, right);
    const exactLeft = transform(left, DISPLAY_PROJECTION, EPSG_32719) as [number, number];
    const exactRight = transform(right, DISPLAY_PROJECTION, EPSG_32719) as [number, number];

    const approxJump = Math.hypot(approxLeft[0] - approxRight[0], approxLeft[1] - approxRight[1]);
    const exactJump = Math.hypot(exactLeft[0] - exactRight[0], exactLeft[1] - exactRight[1]);
    expect(Math.abs(approxJump - exactJump)).toBeLessThan(MAX_ACCEPTABLE_ERROR_M * 2);
  });

  it('cachea por tile: puntos repetidos en la misma zona no generan tiles nuevos', () => {
    const cache = new TiledAffineCache({ telemetry: false });
    for (let i = 0; i < 200; i++) {
      cache.applyPoint(EPSG_32719, [center[0] + (i % 5), center[1] + (i % 3)]);
    }
    expect(cache.sizeForKey(EPSG_32719)).toBeLessThanOrEqual(4);
  });

  it('el tamaño del caché crece con la cantidad de tiles distintos tocados, no con la cantidad de puntos', () => {
    const cache = new TiledAffineCache({ telemetry: false, tileSizeM: 1000 });
    for (let i = 0; i < 5; i++) {
      cache.applyPoint(EPSG_32719, [center[0] + i * 1500, center[1]]);
    }
    expect(cache.sizeForKey(EPSG_32719)).toBeGreaterThanOrEqual(5);
    expect(cache.sizeForKey(EPSG_32719)).toBeLessThan(15);
  });
});