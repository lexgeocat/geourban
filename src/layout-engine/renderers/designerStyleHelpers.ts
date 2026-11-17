import type {
  MetricRoadNetworkGroup,
  MetricRoundaboutEntity,
  MetricStreetEntity,
} from '../extractors/cartographyExtractor';

function parseHexRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
  }
  return null;
}

/**
 * Resuelve colores del Diseñador asegurando contraste sólido cuando el papel es blanco.
 */
export function resolveDesignerColor(
  color: string,
  opacity: number,
  sheetIsLight: boolean
): string {
  const op = Math.max(0.15, Math.min(1, opacity));
  const rgb = parseHexRgb(color);
  if (!rgb) return color;
  let [r, g, b] = rgb;
  if (sheetIsLight) {
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (luminance > 0.85) {
      return `rgba(15, 23, 42, ${op})`;
    }
    if (luminance > 0.62) {
      // Oscurece tonos pastel claros (ej. amarillo o celeste claro) para que no se vean lavados en papel blanco
      const factor = 0.58;
      r = Math.round(r * factor);
      g = Math.round(g * factor);
      b = Math.round(b * factor);
    }
  }
  return `rgba(${r}, ${g}, ${b}, ${op})`;
}

function buildOffsetPolyline(
  pts: [number, number][],
  offsetPx: number
): [number, number][] {
  if (pts.length < 2) return [];
  const out: [number, number][] = [];
  const maxMiter = Math.abs(offsetPx) * 2.4;

  const segNormal = (a: [number, number], b: [number, number]): [number, number] | null => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    return [-dy / len, dx / len];
  };

  for (let i = 0; i < pts.length; i++) {
    const nPrev = i > 0 ? segNormal(pts[i - 1], pts[i]) : null;
    const nNext = i < pts.length - 1 ? segNormal(pts[i], pts[i + 1]) : null;

    if (nPrev && nNext) {
      const bx = nPrev[0] + nNext[0];
      const by = nPrev[1] + nNext[1];
      const bLen = Math.hypot(bx, by);
      if (bLen < 1e-4) {
        out.push([pts[i][0] + nNext[0] * offsetPx, pts[i][1] + nNext[1] * offsetPx]);
      } else {
        const ux = bx / bLen;
        const uy = by / bLen;
        const dot = ux * nNext[0] + uy * nNext[1];
        const scale =
          Math.min(maxMiter, Math.abs(offsetPx) / Math.max(0.35, Math.abs(dot))) *
          Math.sign(offsetPx || 1);
        out.push([pts[i][0] + ux * scale, pts[i][1] + uy * scale]);
      }
    } else {
      const n = nNext ?? nPrev ?? [0, 0];
      out.push([pts[i][0] + n[0] * offsetPx, pts[i][1] + n[1] * offsetPx]);
    }
  }
  return out;
}

function strokeScreenPolyline(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();
}

function clipSegmentOutsideCircle(
  a: [number, number],
  b: [number, number],
  center: [number, number],
  radius: number
): Array<[[number, number], [number, number]]> {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - center[0];
  const fy = a[1] - center[1];
  const A = dx * dx + dy * dy;
  if (A < 1e-9) {
    return fx * fx + fy * fy > radius * radius ? [[a, b]] : [];
  }
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  const pointAt = (t: number): [number, number] => [a[0] + dx * t, a[1] + dy * t];

  if (disc <= 0) return C > 0 ? [[a, b]] : [];

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-B - sqrtDisc) / (2 * A);
  const t2 = (-B + sqrtDisc) / (2 * A);

  if (t1 >= 1 || t2 <= 0) return [[a, b]];
  if (t1 <= 0 && t2 >= 1) return [];

  const segs: Array<[[number, number], [number, number]]> = [];
  if (t1 > 0) segs.push([a, pointAt(t1)]);
  if (t2 < 1) segs.push([pointAt(t2), b]);
  return segs;
}

export function renderStreetAxes(params: {
  ctx: CanvasRenderingContext2D;
  streets: MetricStreetEntity[];
  roundabouts: MetricRoundaboutEntity[];
  toScreen: (pt: [number, number]) => [number, number];
  axisStroke: string;
  lineWidth: number;
  cadScale: number;
}): void {
  const { ctx, streets, roundabouts, toScreen, axisStroke, lineWidth, cadScale } = params;
  if (streets.length === 0) return;

  ctx.save();
  ctx.strokeStyle = axisStroke;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.setLineDash([7 * cadScale * 0.75, 5 * cadScale * 0.75]);

  for (const st of streets) {
    if (st.path.length < 2) continue;
    let segs: Array<[[number, number], [number, number]]> = [];
    for (let i = 0; i < st.path.length - 1; i++) {
      segs.push([st.path[i], st.path[i + 1]]);
    }
    for (const rb of roundabouts) {
      const r = rb.radiusM + rb.roadWidthM / 2 + 1;
      const next: Array<[[number, number], [number, number]]> = [];
      for (const [a, b] of segs) {
        next.push(...clipSegmentOutsideCircle(a, b, rb.center, r));
      }
      segs = next;
    }

    for (const [a, b] of segs) {
      const [x0, y0] = toScreen(a);
      const [x1, y1] = toScreen(b);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function renderUnionedRoadNetworks(params: {
  ctx: CanvasRenderingContext2D;
  roadNets: MetricRoadNetworkGroup[];
  toScreen: (pt: [number, number]) => [number, number];
  resolveColors: (group: MetricRoadNetworkGroup) => { roadStroke: string; curbStroke: string };
  roadLineWidth: number;
  curbLineWidth: number;
}): void {
  const { ctx, roadNets, toScreen, resolveColors, roadLineWidth, curbLineWidth } = params;

  const strokePolygons = (polygons: [number, number][][][], stroke: string, lw: number) => {
    if (polygons.length === 0) return;
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const rings of polygons) {
      for (const ring of rings) {
        if (ring.length < 3) continue;
        ctx.beginPath();
        ring.forEach((pt, idx) => {
          const [sx, sy] = toScreen(pt);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  for (const group of roadNets) {
    const { roadStroke, curbStroke } = resolveColors(group);
    strokePolygons(group.outerPolygons, curbStroke, curbLineWidth);
    strokePolygons(group.roadPolygons, roadStroke, roadLineWidth);
  }
}

/**
 * Fallback vectorial por calle cuando no está disponible la unión topológica de intersecciones.
 */
export function renderStreetFallback(params: {
  ctx: CanvasRenderingContext2D;
  street: MetricStreetEntity;
  toScreen: (pt: [number, number]) => [number, number];
  pxPerMeter: number;
  roadStroke: string;
  curbStroke: string;
  roadLineWidth: number;
  curbLineWidth: number;
}): void {
  const { ctx, street, toScreen, pxPerMeter, roadStroke, curbStroke, roadLineWidth, curbLineWidth } =
    params;
  if (street.path.length < 2) return;

  const screenPts = street.path.map(toScreen);
  const roadHalfPx = Math.max(2.4, (street.widthM * pxPerMeter) / 2);
  const totalHalfPx = roadHalfPx + Math.max(0, street.sideWidthM * pxPerMeter);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (street.sideWidthM > 0) {
    ctx.strokeStyle = curbStroke;
    ctx.lineWidth = curbLineWidth;
    strokeScreenPolyline(ctx, buildOffsetPolyline(screenPts, totalHalfPx));
    strokeScreenPolyline(ctx, buildOffsetPolyline(screenPts, -totalHalfPx));
  }

  ctx.strokeStyle = roadStroke;
  ctx.lineWidth = roadLineWidth;
  strokeScreenPolyline(ctx, buildOffsetPolyline(screenPts, roadHalfPx));
  strokeScreenPolyline(ctx, buildOffsetPolyline(screenPts, -roadHalfPx));

  ctx.restore();
}
