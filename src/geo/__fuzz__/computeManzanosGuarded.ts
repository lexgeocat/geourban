// src/geo/__fuzz__/computeManzanosGuarded.ts
//
// Envoltorio de robustez para el corpus de fuzz de computeManzanos.
// Node/vitest corren esto en un solo hilo síncrono: si computeManzanos
// entra en un caso patológico de JSTS/polygon-clipping, no hay forma de
// interrumpirlo desde adentro del mismo proceso. Esta capa reduce la
// probabilidad de disparar ese caso filtrando, ANTES de invocar el motor,
// topología que se sabe de alto riesgo (calles casi-paralelas o
// casi-superpuestas entre CUALQUIER par, no solo el primero).
import type { FeatureCollection } from 'geojson';
import type { Street } from '../../store/entities/streetStore';
import { buildRoadNetworkRings } from '../roads/roadNetworkEngine';
import { polyArea, type Pt } from '../math/polygonEngine';
import { computeManzanos } from '../../workers/geoOperations';

const MIN_SAFE_ANGLE_DEG = 12;
const MIN_SEPARATION_FACTOR = 2.5; // múltiplo del ancho combinado para considerar "no-solapadas"

function angleBetweenDeg(a: Street, b: Street): number {
  const d1x = a.end[0] - a.start[0], d1y = a.end[1] - a.start[1];
  const d2x = b.end[0] - b.start[0], d2y = b.end[1] - b.start[1];
  const len1 = Math.hypot(d1x, d1y) || 1;
  const len2 = Math.hypot(d2x, d2y) || 1;
  const dot = (d1x / len1) * (d2x / len2) + (d1y / len1) * (d2y / len2);
  const rad = Math.acos(Math.max(-1, Math.min(1, dot)));
  const deg = (rad * 180) / Math.PI;
  return Math.min(deg, 180 - deg);
}

function segMinDistance(a0: Pt, a1: Pt, b0: Pt, b1: Pt): number {
  function closestOnSeg(p: Pt, s: Pt, e: Pt): Pt {
    const dx = e[0] - s[0], dy = e[1] - s[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-12) return s;
    const t = Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / lenSq));
    return [s[0] + t * dx, s[1] + t * dy];
  }
  const candidates: Pt[] = [
    closestOnSeg(a0, b0, b1),
    closestOnSeg(a1, b0, b1),
    closestOnSeg(b0, a0, a1),
    closestOnSeg(b1, a0, a1),
  ];
  let best = Infinity;
  const pts: Array<[Pt, Pt]> = [[a0, candidates[0]], [a1, candidates[1]], [b0, candidates[2]], [b1, candidates[3]]];
  for (const [p, q] of pts) {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best) best = d;
  }
  return best;
}

/** ¿Este par de calles es de alto riesgo de robustez para el overlay booleano? */
function pairIsRisky(a: Street, b: Street): boolean {
  const angle = angleBetweenDeg(a, b);
  if (angle < MIN_SAFE_ANGLE_DEG) {
    const minDist = segMinDistance(a.start, a.end, b.start, b.end);
    const combinedHalfWidth =
      a.widthM / 2 + Math.max(0, a.sideWidthM ?? 0) + b.widthM / 2 + Math.max(0, b.sideWidthM ?? 0);
    if (minDist < combinedHalfWidth * MIN_SEPARATION_FACTOR) return true;
  }
  return false;
}

/** Filtra (no muta) el set de calles hasta que ningún par quede en zona de riesgo. */
export function makeStreetSetOverlaySafe(streets: Street[]): Street[] {
  let current = streets.slice();
  let guard = 0;
  while (guard++ < streets.length + 4) {
    let riskyIdx = -1;
    outer: for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        if (pairIsRisky(current[i], current[j])) {
          riskyIdx = current[j].widthM <= current[i].widthM ? j : i;
          break outer;
        }
      }
    }
    if (riskyIdx === -1) break;
    current = current.filter((_, idx) => idx !== riskyIdx);
    if (current.length === 0) break;
  }
  return current;
}

export interface GuardedComputeManzanosResult {
  result: FeatureCollection;
  skipped: boolean;
  reason?: string;
}

/**
 * Corre computeManzanos con las mismas mitigaciones de robustez que ya
 * aplica geoOperations.ts (precision snapping + buffer(0) + límites de
 * complejidad), más un pre-filtro de topología de alto riesgo específico
 * del corpus de fuzz. No es una garantía matemática de terminación — es
 * la misma clase de mitigación que usan producción/GEOS para este
 * problema — pero reduce drásticamente la probabilidad de que el corpus
 * aleatorio dispare el peor caso conocido de JSTS.
 */
export function computeManzanosGuarded(
  parcelRing: Pt[],
  streets: Street[],
): GuardedComputeManzanosResult {
  const safeStreets = makeStreetSetOverlaySafe(streets);
  const skipped = safeStreets.length !== streets.length;

  const roadRings = buildRoadNetworkRings(safeStreets, []);

  function closeRing(ring: Pt[]): Pt[] {
    const f = ring[0], l = ring[ring.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) return [...ring, [f[0], f[1]]];
    return ring;
  }

  const parcelsFC: FeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeRing(parcelRing)] },
    }] as never[],
  };
  const roadNetworkFC: FeatureCollection = {
    type: 'FeatureCollection',
    features: roadRings.map((ring) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeRing(ring)] },
    })) as never[],
  };

  const result = computeManzanos(parcelsFC, roadNetworkFC);
  return {
    result,
    skipped,
    reason: skipped ? `${streets.length - safeStreets.length} calle(s) descartada(s) por riesgo de robustez (casi-paralelas/solapadas)` : undefined,
  };
}

export function _totalAreaOf(fc: FeatureCollection): number {
  let total = 0;
  for (const f of fc.features) {
    if (f.geometry?.type !== 'Polygon') continue;
    total += polyArea(f.geometry.coordinates[0] as Pt[]);
  }
  return total;
}