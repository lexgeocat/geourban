import type { Pt } from '../math/polygonEngine';
import type { Street } from '../../store/entities/streetStore';
import type { RoundaboutParams } from '../roundabout/roundaboutEngine';
import { buildRoadNetworkRings, buildRoadOnlyRings } from './roadNetworkEngine';
import { roundRingReflex } from './ringFillet';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import type { Polygon as GeoJsonPolygon } from 'geojson';

const geometryFactory = new GeometryFactory();
const reader = new GeoJSONReader(geometryFactory);
const writer = new GeoJSONWriter();

export interface RoadNetworkNet {
  /** Anillos (posiblemente disjuntos) del borde de CALZADA, ya unidos y
   *  con ochave real en cada esquina cóncava. Reemplaza el fillet
   *  calle-por-calle de `streetEngine.ts::computeStreetPairFillets`
   *  (ambiguo en cruces no perpendiculares o de 3+ vías — la causa de los
   *  "ochaves al revés"). */
  road: Pt[][];
  /** Igual, borde de VEREDA (calzada + ancho de vereda). */
  outer: Pt[][];
}

function closeRing(ring: Pt[]): Pt[] {
  const f = ring[0], l = ring[ring.length - 1];
  if (Math.abs(f[0] - l[0]) > 1e-9 || Math.abs(f[1] - l[1]) > 1e-9) return [...ring, [f[0], f[1]]];
  return ring;
}

function orientRingCcw(ring: Pt[]): Pt[] {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area >= 0 ? ring : ring.slice().reverse();
}

function ringToJstsGeom(ring: Pt[]) {
  const gj: GeoJsonPolygon = { type: 'Polygon', coordinates: [closeRing(ring)] };
  return reader.read(gj);
}

/** Extrae los anillos EXTERIORES (ignora huecos) de un Polygon/MultiPolygon JTS. */
function extractExteriorRings(geom: any): Pt[][] {
  if (!geom || geom.isEmpty?.()) return [];
  const gj: any = writer.write(geom);
  const rings: Pt[][] = [];
  const collect = (poly: { coordinates: number[][][] }) => {
    const outer = poly.coordinates?.[0];
    if (outer && outer.length >= 4) rings.push(outer.map((c) => [c[0], c[1]] as Pt));
  };
  if (gj.type === 'Polygon') collect(gj);
  else if (gj.type === 'MultiPolygon') {
    for (const poly of gj.coordinates) collect({ coordinates: poly });
  }
  return rings;
}

/**
 * Une una lista de anillos (calzada u outer) en una sola geometría —
 * puede resultar en 1+ polígonos disjuntos si la red vial tiene tramos
 * separados. Corre síncrono en el hilo principal (sin worker) porque el
 * resultado hace falta disponible ANTES de pintar el frame; se cachea en
 * StreetPainter y solo se recalcula cuando cambia el fingerprint de calles.
 */
function unionRings(rings: Pt[][]): Pt[][] {
  if (rings.length === 0) return [];
  let merged: any = null;
  for (const ring of rings) {
    try {
      const geom = ringToJstsGeom(ring);
      merged = merged ? OverlayOp.union(merged, geom) : geom;
    } catch {
      // Anillo degenerado/autointersectante (p.ej. un tramo de calle con
      // ángulo extremo): se descarta en vez de tirar abajo toda la unión.
    }
  }
  return merged ? extractExteriorRings(merged) : [];
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ancho de vereda (para engrosar el ochave de la calzada — ver comentario
 *  en ringFillet.ts) del segmento de calle más cercano a un punto —
 *  aproximación de "makeSideExtraProbe" de index_modelo.html. */
function makeSideExtraProbe(streets: Street[], roundabouts: RoundaboutParams[]) {
  return (pt: Pt): number => {
    let best = 0;
    for (const s of streets) {
      const sw = Math.max(0, s.sideWidthM ?? 0);
      if (sw <= best) continue;
      const pts: Pt[] = [s.start, ...(s.waypoints ?? []), s.end];
      for (let i = 0; i < pts.length - 1; i++) {
        const reach = s.widthM / 2 + sw + 3;
        if (distToSegment(pt, pts[i], pts[i + 1]) < reach) { best = Math.max(best, sw); break; }
      }
    }
    for (const rb of roundabouts) {
      const sw = Math.max(0, rb.sidewalkWidthM ?? 0);
      if (sw <= best) continue;
      const d = Math.hypot(pt[0] - rb.center[0], pt[1] - rb.center[1]);
      if (Math.abs(d - (rb.radiusM + rb.roadWidthM / 2)) < rb.roadWidthM + sw + 3) best = Math.max(best, sw);
    }
    return best;
  };
}

/**
 * Red vial "de verdad": une TODOS los anillos de calzada/vereda en una
 * sola geometría — en vez de calcular fillets calle por calle (frágil:
 * ambiguo en cruces de 3+ vías, ángulos agudos o anchos asimétricos, y
 * es la causa de los ochaves invertidos reportados) — y luego redondea
 * EXACTAMENTE los vértices cóncavos (reflex) del resultado ya unido, que
 * son ni más ni menos que las esquinas reales de cada intersección.
 * Mismo algoritmo que usa index_modelo.html (rebuildNet + roundRingReflex).
 *
 * Nota: los cruces calle×rotonda no entran acá (la rotonda se sigue
 * dibujando aparte, en RoundaboutPainter) — este fix cubre calle×calle,
 * que es lo reportado.
 */
export function computeRoadNetworkNet(
  streets: Street[],
  roundabouts: RoundaboutParams[] = [],
): RoadNetworkNet {
  const roadRingsRaw = buildRoadOnlyRings(streets, roundabouts);
  const outerRingsRaw = buildRoadNetworkRings(streets, roundabouts);
  const sideExtraAt = makeSideExtraProbe(streets, roundabouts);

  const roadUnion = unionRings(roadRingsRaw);
  const outerUnion = unionRings(outerRingsRaw);

  return {
    road: roadUnion.map((ring) => roundRingReflex(orientRingCcw(ring), sideExtraAt)),
    outer: outerUnion.map((ring) => roundRingReflex(orientRingCcw(ring), 0)),
  };
}