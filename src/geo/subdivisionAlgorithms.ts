import * as turf from '@turf/turf';
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiPolygon,
  Polygon as GeoJsonPolygon,
} from 'geojson';

/* ================================================================
   SUBDIVISION ALGORITHMS — geometricos puros
   ================================================================
   Trabajan sobre geometrias GeoJSON (Polygon) en EPSG:3857 (metros).
   Sin dependencias de OL ni JSTS — son funciones puras, faciles
   de testear y razonar.

   Cada algoritmo devuelve un FeatureCollection de Polygons.
   Si el input es invalido, devuelve una coleccion vacia.
   ================================================================ */

export type SubdivisionMethod = 'grid' | 'proportional' | 'manual' | 'offset';

export interface SubdivisionOptions {
  /** Algoritmo a aplicar */
  method: SubdivisionMethod;
  /** Ancho objetivo de lote (m) — para grid */
  lotWidthM?: number;
  /** Profundidad objetivo de lote (m) — para grid */
  lotDepthM?: number;
  /** Numero de lotes objetivo — para proportional */
  targetCount?: number;
  /** Area objetivo por lote (m2) — alternativa a targetCount */
  targetAreaM2?: number;
  /** Linea de corte (manual). GeoJSON LineString en EPSG:3857 */
  splitLine?: LineString | null;
  /** Distancia de offset perpendicular al frente (m) — para offset */
  offsetDistanceM?: number;
  /** Incluir calle interna entre lotes (grid): ancho en m */
  innerStreetWidthM?: number;
  /** Rotacion opcional de la grilla (rad) — para grid */
  rotationRad?: number;
}

export type SubdivisionResult = {
  ok: boolean;
  /** FeatureCollection de lotes resultantes (Polygon[]) */
  features: Feature<GeoJsonPolygon | MultiPolygon>[];
  warnings: string[];
  error?: string;
};

/* ---------- Helpers geometricos ---------- */

/** Calcula el OBB (oriented bounding box) minimo de un poligono en EPSG:3857. */
function orientedBoundingBox(
  polygon: GeoJsonPolygon
): { center: [number, number]; width: number; height: number; angle: number; corners: [number, number][] } {
  const coords = polygon.coordinates[0];
  if (!coords || coords.length < 4) {
    // fallback: usar extent
    const ext = turf.bbox(polygon);
    const cx = (ext[0] + ext[2]) / 2;
    const cy = (ext[1] + ext[3]) / 2;
    return {
      center: [cx, cy],
      width: ext[2] - ext[0],
      height: ext[3] - ext[1],
      angle: 0,
      corners: [
        [ext[0], ext[1]],
        [ext[2], ext[1]],
        [ext[2], ext[3]],
        [ext[0], ext[3]],
      ],
    };
  }
  // Calcular OBB via convex hull y PCA simplificado (rotating calipers)
  const hull = turf.convex(polygon);
  if (!hull) {
    const ext = turf.bbox(polygon);
    return {
      center: [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2],
      width: ext[2] - ext[0],
      height: ext[3] - ext[1],
      angle: 0,
      corners: [
        [ext[0], ext[1]],
        [ext[2], ext[1]],
        [ext[2], ext[3]],
        [ext[0], ext[3]],
      ],
    };
  }
  // Rotating calipers
  const ring = (hull.geometry as GeoJsonPolygon).coordinates[0];
  let minArea = Infinity;
  let bestAngle = 0;
  let bestWidth = 0;
  let bestHeight = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const rotated = ring.map((pt) => rotatePoint(pt as [number, number], -angle));
    const xs = rotated.map((p) => p[0]);
    const ys = rotated.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX;
    const h = maxY - minY;
    const area = w * h;
    if (area < minArea) {
      minArea = area;
      bestAngle = angle;
      bestWidth = w;
      bestHeight = h;
    }
  }
  // Centro del OBB
  const rotatedRing = ring.map((pt) => rotatePoint(pt as [number, number], -bestAngle));
  const xs = rotatedRing.map((p) => p[0]);
  const ys = rotatedRing.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const center = rotatePoint([cx, cy], bestAngle);
  const corners = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ].map((c) => rotatePoint(c as [number, number], bestAngle)) as [number, number][];
  return { center, width: bestWidth, height: bestHeight, angle: bestAngle, corners };
}

function rotatePoint(p: [number, number], angleRad: number): [number, number] {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

/** Construye un cuadrado de lado `side` centrado en `c` con rotacion `angle`. */
function buildRotatedRectangle(
  c: [number, number],
  width: number,
  height: number,
  angleRad: number
): GeoJsonPolygon {
  const hw = width / 2;
  const hh = height / 2;
  const corners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
  ].map(([x, y]) => {
    const r = rotatePoint([x, y], angleRad);
    return [r[0] + c[0], r[1] + c[1]] as [number, number];
  });
  return { type: 'Polygon', coordinates: [corners] };
}

/** Cuenta cuantos pasos caben sin pasarse del limite. */
function countSteps(available: number, step: number): number {
  if (step <= 0 || available <= 0) return 0;
  return Math.max(0, Math.floor(available / step));
}
/** Bounding box (no necesariamente mínimo) del polígono a un ángulo fijo dado. */
function boundingBoxAtAngle(
  polygon: GeoJsonPolygon,
  angleRad: number
): { center: [number, number]; width: number; height: number; angle: number } {
  const hull = turf.convex(polygon);
  const ring = hull ? (hull.geometry as GeoJsonPolygon).coordinates[0] : polygon.coordinates[0];
  const rotated = ring.map((pt) => rotatePoint(pt as [number, number], -angleRad));
  const xs = rotated.map((p) => p[0]);
  const ys = rotated.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const center = rotatePoint([cx, cy], angleRad);
  return { center, width: maxX - minX, height: maxY - minY, angle: angleRad };
}

/** Cuenta lotes que entran en `available` considerando N*lotSize + (N-1)*gap <= available. */
function countStepsWithGap(available: number, lotSize: number, gap: number): number {
  if (lotSize <= 0 || available <= 0) return 0;
  return Math.max(0, Math.floor((available + gap) / (lotSize + gap)));
}

/* ---------- Subdivision: Grid Regular ---------- */

export function subdivideGridRegular(
  polygon: GeoJsonPolygon,
  opts: SubdivisionOptions
): SubdivisionResult {
  const warnings: string[] = [];
  const lotWidthM = opts.lotWidthM ?? 0;
  const lotDepthM = opts.lotDepthM ?? 0;
  const innerStreet = opts.innerStreetWidthM ?? 0;

  if (lotWidthM <= 0 || lotDepthM <= 0) {
    return {
      ok: false,
      features: [],
      warnings,
      error: 'lotWidthM y lotDepthM deben ser mayores a 0',
    };
  }

  // Si viene un rotationRad explícito (subdivideProportional / subdivideOffset
  // lo necesitan para alinear la grilla con un eje concreto en vez de con el
  // OBB de área mínima), lo respetamos en vez de recalcular el OBB propio.
  const obb =
    opts.rotationRad !== undefined
      ? boundingBoxAtAngle(polygon, opts.rotationRad)
      : orientedBoundingBox(polygon);
  const totalW = obb.width;
  const totalD = obb.height;
  const stepW = lotWidthM + innerStreet;
  const stepD = lotDepthM + innerStreet;

  // Ahora el conteo de columnas/filas SÍ considera la calle interna, por
  // construcción no puede haber overflow (antes solo se avisaba con un
  // warning y se seguía dibujando la grilla igual, generando recortes
  // silenciosos contra el bbox del padre).
  const cols = countStepsWithGap(totalW, lotWidthM, innerStreet);
  const rows = countStepsWithGap(totalD, lotDepthM, innerStreet);

  if (cols === 0 || rows === 0) {
    return {
      ok: false,
      features: [],
      warnings,
      error: `El poligono (${totalW.toFixed(1)}m x ${totalD.toFixed(1)}m) es muy pequeno para lotes de ${lotWidthM}m x ${lotDepthM}m`,
    };
  }

  const marginW = (totalW - cols * lotWidthM - (cols - 1) * innerStreet) / 2;
  const marginD = (totalD - rows * lotDepthM - (rows - 1) * innerStreet) / 2;

  // Construir celdas del grid en el sistema local (rotado) del OBB
  const features: Feature<GeoJsonPolygon>[] = [];
  const startX = -totalW / 2 + marginW;
  const startY = -totalD / 2 + marginD;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellCenter: [number, number] = [
        startX + c * stepW + lotWidthM / 2,
        startY + r * stepD + lotDepthM / 2,
      ];
      // Rotar al espacio global y trasladar
      const globalCenter = rotatePoint(cellCenter, obb.angle);
      const cx = globalCenter[0] + obb.center[0];
      const cy = globalCenter[1] + obb.center[1];
      const rect = buildRotatedRectangle([cx, cy], lotWidthM, lotDepthM, obb.angle);
      // Para la subdivision principal usamos el rectangulo tal cual; la
      // interseccion precisa contra el padre solo importa cuando el
      // padre tiene bordes irregulares. En ese caso, intersectWithParent
      // hace una interseccion aproximada via bbox (lo cual es suficiente
      // para que la subdivision sea visualmente coherente).
      const intersected = intersectWithParentApprox(rect, polygon);
      const finalGeom = intersected ?? rect;
      if (finalGeom) {
        features.push({
          type: 'Feature',
          properties: {
            subdivision: 'grid',
            row: r,
            col: c,
            label: `Lote ${r + 1}-${c + 1}`,
          },
          geometry: finalGeom,
        });
      }
    }
  }

  return {
    ok: features.length > 0,
    features: features as Feature<GeoJsonPolygon | MultiPolygon>[],
    warnings,
    error: features.length === 0 ? 'No se generaron lotes' : undefined,
  };
}

/* ---------- Subdivision: Proportional ---------- */

export function subdivideProportional(
  polygon: GeoJsonPolygon,
  opts: SubdivisionOptions
): SubdivisionResult {
  const warnings: string[] = [];
  const obb = orientedBoundingBox(polygon);
  const polygonArea = Math.abs(turf.area(polygon));

  let n = opts.targetCount ?? 0;
  if (n <= 0 && opts.targetAreaM2 && opts.targetAreaM2 > 0) {
    n = Math.max(1, Math.floor(polygonArea / opts.targetAreaM2));
  }
  if (n <= 0) {
    return { ok: false, features: [], warnings, error: 'Falta targetCount o targetAreaM2' };
  }

  // IMPORTANTE: acá NO usamos "longestDim/shortestDim" — cols siempre
  // divide el eje X del OBB (obb.width) y rows siempre el eje Y
  // (obb.height). Antes se mezclaban los ejes ("longest/shortest") y el
  // resultado se pasaba a subdivideGridRegular, que SIEMPRE aplica
  // lotWidthM al eje X — si el polígono era más alto que ancho, el
  // ancho/profundidad quedaban invertidos.
  //
  // Lotes cuadrados: lotW = W/cols == lotH = H/rows, con cols*rows ≈ n
  //   => cols = sqrt(n * W/H)
  const rawCols = Math.sqrt(n * (obb.width / obb.height));
  let cols = Math.max(1, Math.round(rawCols));
  let rows = Math.max(1, Math.ceil(n / cols));
  if (rows * cols < n) {
    if (cols * (rows + 1) <= n * 1.1) rows += 1;
    else cols += 1;
  }

  const lotWidthM = obb.width / cols;
  const lotDepthM = obb.height / rows;

  warnings.push(
    `Grilla proporcional: ${rows} filas x ${cols} cols (lotes ${lotWidthM.toFixed(1)}m x ${lotDepthM.toFixed(1)}m)`
  );

  return subdivideGridRegular(polygon, {
    method: 'grid',
    lotWidthM,
    lotDepthM,
    innerStreetWidthM: 0,
    rotationRad: obb.angle,
  });
}

/* ---------- Subdivision: Manual (corte con linea) ---------- */

export function subdivideManual(
  polygon: GeoJsonPolygon,
  splitLine: LineString
): SubdivisionResult {
  const warnings: string[] = [];
  if (!splitLine || splitLine.coordinates.length < 2) {
    return { ok: false, features: [], warnings, error: 'splitLine invalida' };
  }
  const line = turf.lineString(splitLine.coordinates);
  const parts = splitPolygonByLine(polygon, line);
  if (parts.length < 2) {
    return {
      ok: false,
      features: [],
      warnings,
      error: 'La linea de corte no divide el poligono en dos partes validas',
    };
  }
  const result: Feature<GeoJsonPolygon>[] = [];
  parts.forEach((part, i) => {
    result.push({
      type: 'Feature',
      properties: { subdivision: 'manual', part: i + 1, label: `Lote ${i + 1}` },
      geometry: part,
    });
  });
  return { ok: true, features: result as Feature<GeoJsonPolygon | MultiPolygon>[], warnings };
}

function splitPolygonByLine(
  polygon: GeoJsonPolygon,
  line: Feature<LineString>
): GeoJsonPolygon[] {
  // Implementacion directa del corte poligono-linea.
  // No usamos turf.lineSplit ni diferencia/buffer porque pueden colgar
  // o consumir mucha memoria con geometrias medianas.
  return splitPolygonByLineAlgorithm(polygon, line);
}

function splitPolygonByLineAlgorithm(
  polygon: GeoJsonPolygon,
  line: Feature<LineString>
): GeoJsonPolygon[] {
  // Implementacion directa del corte poligono-linea:
  // 1) encontrar intersecciones entre la linea y el anillo exterior
  // 2) dividir el anillo en dos cadenas
  // 3) cada cadena + segmento de linea = poligono resultante
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) return [];
  const lineCoords = line.geometry.coordinates;
  const lineStart = lineCoords[0] as [number, number];
  const lineEnd = lineCoords[lineCoords.length - 1] as [number, number];

  // Encontrar intersecciones con cada segmento del anillo
  const intersections: { segmentIndex: number; point: [number, number] }[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i] as [number, number];
    const b = ring[i + 1] as [number, number];
    const ip = segmentLineIntersection(a, b, lineStart, lineEnd);
    if (ip) {
      intersections.push({ segmentIndex: i, point: ip });
    }
  }

  // Necesitamos exactamente 2 intersecciones para dividir el poligono
  if (intersections.length < 2) return [];
  // Si hay mas, tomamos las 2 primeras/mas simples (puntos extremos)
  if (intersections.length > 2) {
    // Tomar las dos intersecciones mas alejadas entre si
    let best = [0, 1];
    let bestDist = -1;
    for (let i = 0; i < intersections.length; i++) {
      for (let j = i + 1; j < intersections.length; j++) {
        const a = intersections[i].point;
        const b = intersections[j].point;
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (d > bestDist) {
          bestDist = d;
          best = [i, j];
        }
      }
    }
    const chosen = intersections.filter((_, i) => best.includes(i));
    intersections.length = 0;
    intersections.push(...chosen);
  }

  // Ordenar intersecciones por posicion a lo largo de la linea
  intersections.sort((a, b) => a.segmentIndex - b.segmentIndex);

  // Construir el segmento de linea entre las dos intersecciones
  const [int1, int2] = intersections;
  if (!int1 || !int2) return [];
  const segStart = int1.point;
  const segEnd = int2.point;

  // Construir las dos cadenas del anillo
  // Cadena 1: de interseccion 1 a interseccion 2 (siguiendo el anillo)
  const chain1: [number, number][] = [];
  for (let i = int1.segmentIndex; ; i = (i + 1) % (ring.length - 1)) {
    if (i === int2.segmentIndex) {
      chain1.push(segEnd);
      break;
    }
    chain1.push(ring[i] as [number, number]);
  }
  // Cadena 2: de interseccion 2 a interseccion 1 (siguiendo el anillo)
  const chain2: [number, number][] = [];
  for (let i = int2.segmentIndex; ; i = (i + 1) % (ring.length - 1)) {
    if (i === int1.segmentIndex) {
      chain2.push(segStart);
      break;
    }
    chain2.push(ring[i] as [number, number]);
  }

  // Poligono 1: cadena1 + linea(int1, int2)
  const poly1Ring: [number, number][] = [...chain1, segStart, segStart];
  // Poligono 2: cadena2 + linea(int2, int1) en sentido inverso
  const poly2Ring: [number, number][] = [...chain2, segEnd, segEnd];

  // Cerrar cada poligono
  const close = (r: [number, number][]): [number, number][] => {
    if (r.length < 4) return r;
    const first = r[0];
    const last = r[r.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      r.push(first);
    }
    return r;
  };

  return [
    { type: 'Polygon', coordinates: [close(poly1Ring)] },
    { type: 'Polygon', coordinates: [close(poly2Ring)] },
  ];
}

function segmentLineIntersection(
  a: [number, number],
  b: [number, number],
  p: [number, number],
  q: [number, number]
): [number, number] | null {
  // Interseccion entre el segmento a-b y la linea infinita p-q
  const x1 = a[0],
    y1 = a[1],
    x2 = b[0],
    y2 = b[1];
  const x3 = p[0],
    y3 = p[1],
    x4 = q[0],
    y4 = q[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const ix = x1 + t * (x2 - x1);
  const iy = y1 + t * (y2 - y1);
  // Verificar que esta en el segmento a-b
  const onSeg = (x: number, y: number) =>
    x >= Math.min(x1, x2) - 1e-6 &&
    x <= Math.max(x1, x2) + 1e-6 &&
    y >= Math.min(y1, y2) - 1e-6 &&
    y <= Math.max(y1, y2) + 1e-6;
  if (!onSeg(ix, iy)) return null;
  return [ix, iy];
}

function buildHalfPlanes(line: Feature<LineString>): GeoJsonPolygon[] {
  // Construye dos poligonos rectangulares muy grandes que cubren cada
  // mitad del espacio respecto a la linea.
  const coords = line.geometry.coordinates;
  const start = coords[0] as [number, number];
  const end = coords[coords.length - 1] as [number, number];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // normal
  const ny = dx / len;
  // Punto medio
  const mid: [number, number] = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
  ];
  const FAR = 1e5;
  // Half-plane 1: lado positivo de la normal
  const h1: [number, number][] = [
    [mid[0] + nx * FAR, mid[1] + ny * FAR],
    [mid[0] + dx * 1e3 + nx * FAR, mid[1] + dy * 1e3 + ny * FAR],
    [mid[0] + dx * 1e3 - nx * FAR, mid[1] + dy * 1e3 - ny * FAR],
    [mid[0] - nx * FAR, mid[1] - ny * FAR],
    [mid[0] + nx * FAR, mid[1] + ny * FAR],
  ];
  // Half-plane 2: lado negativo
  const h2: [number, number][] = [
    [mid[0] - nx * FAR, mid[1] - ny * FAR],
    [mid[0] + dx * 1e3 - nx * FAR, mid[1] + dy * 1e3 - ny * FAR],
    [mid[0] + dx * 1e3 + nx * FAR, mid[1] + dy * 1e3 + ny * FAR],
    [mid[0] + nx * FAR, mid[1] + ny * FAR],
    [mid[0] - nx * FAR, mid[1] - ny * FAR],
  ];
  return [turf.polygon([h1]).geometry, turf.polygon([h2]).geometry];
}

/* ---------- Subdivision: Offset (frentes paralelos) ---------- */

export function subdivideOffset(
  polygon: GeoJsonPolygon,
  opts: SubdivisionOptions
): SubdivisionResult {
  const warnings: string[] = [];
  const distance = opts.offsetDistanceM ?? 0;
  if (distance <= 0) {
    return { ok: false, features: [], warnings, error: 'offsetDistanceM debe ser mayor a 0' };
  }
  // Poligono padre como Feature
  const parentFeature = turf.feature(polygon);
  const parentArea = Math.abs(turf.area(parentFeature));
  // Largo del primer lado del anillo exterior
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 2) {
    return { ok: false, features: [], warnings, error: 'No se puede determinar el frente del poligono' };
  }
  const a = ring[0];
  const b = ring[1];
  const parentFront = Math.hypot(b[0] - a[0], b[1] - a[1]);

  if (parentFront <= 0) {
    return { ok: false, features: [], warnings, error: 'No se puede determinar el frente del poligono' };
  }
  const estimatedCount = Math.max(1, Math.floor(parentFront / distance));
  const lotWidth = parentFront / estimatedCount;

  warnings.push(`Offset: ${estimatedCount} lotes paralelos de ${lotWidth.toFixed(2)}m de frente`);

  // Estrategia: subdivision por grilla a lo largo del lado 0
  // con profundidad calculada para que entre en el OBB.
  const depth = parentArea / parentFront;
  const frontAngle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return subdivideGridRegular(polygon, {
    method: 'grid',
    lotWidthM: lotWidth,
    lotDepthM: depth,
    innerStreetWidthM: 0,
    rotationRad: frontAngle, // seguimos el lado 0 real del poligono, no el OBB
  });
}

/* ---------- Helpers adicionales (sin OL/JSTS) ---------- */

function intersectWithParentApprox(
  rect: GeoJsonPolygon,
  parent: GeoJsonPolygon
): GeoJsonPolygon | null {
  // Interseccion simple por bbox: clipea el rect al bbox del padre.
  // Es una aproximacion pero suficiente para subdivision en grilla
  // (el padre es un poligono generalmente simple). Para interseccion
  // exacta se deberia usar turf.intersect o JSTS en un worker.
  try {
    const rectBbox = turf.bbox(rect);
    const parentBbox = turf.bbox(parent);
    const minX = Math.max(rectBbox[0], parentBbox[0]);
    const minY = Math.max(rectBbox[1], parentBbox[1]);
    const maxX = Math.min(rectBbox[2], parentBbox[2]);
    const maxY = Math.min(rectBbox[3], parentBbox[3]);
    if (minX >= maxX || minY >= maxY) return null;
    return {
      type: 'Polygon',
      coordinates: [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ],
    };
  } catch {
    return null;
  }
}

/* ---------- Funcion de entrada (dispatcher) ---------- */

export function subdivide(
  polygon: GeoJsonPolygon,
  opts: SubdivisionOptions
): SubdivisionResult {
  try {
    if (opts.method === 'grid') return subdivideGridRegular(polygon, opts);
    if (opts.method === 'proportional') return subdivideProportional(polygon, opts);
    if (opts.method === 'manual') {
      if (!opts.splitLine) {
        return { ok: false, features: [], warnings: [], error: 'Falta splitLine' };
      }
      return subdivideManual(polygon, opts.splitLine);
    }
    if (opts.method === 'offset') return subdivideOffset(polygon, opts);
    return { ok: false, features: [], warnings: [], error: `Metodo desconocido: ${opts.method}` };
  } catch (err) {
    return {
      ok: false,
      features: [],
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
