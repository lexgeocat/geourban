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
  road: Pt[][];
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
    const p = ring[i], q = ring[(i + 1) % ring.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area >= 0 ? ring : ring.slice().reverse();
}

/**
 * Redondea a una grilla fija ANTES de la unión booleana — mismo criterio
 * que `roundStripForUnion` en index_modelo.html. El overlay clásico de
 * JTS/JSTS (`OverlayOp`, no el `OverlayNG` moderno) es sensible a bordes
 * casi paralelos / casi colineales muy cercanos AUNQUE no se toquen: dos
 * vías paralelas offseteadas (típicamente varias trazadas en la misma
 * dirección, p.ej. dos verticales) generan justo ese patrón de bordes, y
 * sin este redondeo el ruido de punto flotante puede hacer que el motor
 * las trate como si se tocaran, fusionando en un solo polígono dos vías
 * que en realidad están separadas — el bug de "se une el trazado" al
 * trazar la segunda vía paralela.
 */
const UNION_PRECISION = 1e6; // grilla de ~1e-6 unidades de mapa
function roundRingForUnion(ring: Pt[]): Pt[] {
  return ring.map(
    ([x, y]) =>
      [Math.round(x * UNION_PRECISION) / UNION_PRECISION, Math.round(y * UNION_PRECISION) / UNION_PRECISION] as Pt,
  );
}

function ringToJstsGeom(ring: Pt[]) {
  const gj: GeoJsonPolygon = { type: 'Polygon', coordinates: [closeRing(roundRingForUnion(ring))] };
  return reader.read(gj);
}

/** buffer(0) es el truco estándar en JTS/Shapely para normalizar
 *  auto-intersecciones y vértices duplicados antes de operar — reduce
 *  todavía más el riesgo de una unión con topología ambigua. */
function cleanGeom(geom: any): any {
  try {
    if (geom && geom.isValid && !geom.isValid()) return geom.buffer(0);
  } catch {
    /* si buffer(0) falla, se sigue con el geom original */
  }
  return geom;
}

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
 * Une una lista de anillos (calzada u outer). Cada anillo se redondea a
 * una grilla fija ANTES de entrar a JTS (ver roundRingForUnion) para
 * evitar fusiones espurias entre vías paralelas cercanas. Un anillo que
 * falle al unirse (excepción de JTS) ya NO se pierde en silencio como
 * antes: se conserva como polígono aparte, igual que el fallback de
 * index_modelo.html — así una vía con geometría problemática no
 * desaparece del dibujo, solo queda sin fusionar con el resto.
 */
function unionRings(rings: Pt[][]): Pt[][] {
  if (rings.length === 0) return [];

  const geoms: any[] = [];
  for (const ring of rings) {
    try {
      geoms.push(cleanGeom(ringToJstsGeom(ring)));
    } catch {
      // Anillo degenerado/autointersectante: no hay geometría válida que conservar.
    }
  }
  if (geoms.length === 0) return [];

  let merged: any = geoms[0];
  const leftover: any[] = [];
  for (let i = 1; i < geoms.length; i++) {
    try {
      merged = cleanGeom(OverlayOp.union(merged, geoms[i]));
    } catch {
      leftover.push(geoms[i]);
    }
  }

  const out = extractExteriorRings(merged);
  for (const g of leftover) out.push(...extractExteriorRings(g));
  return out;
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