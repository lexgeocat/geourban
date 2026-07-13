import { snapSpacing } from './cadGridLayer';
import type { SnapResult } from './advancedSnap';

/* ================================================================
   GRID SNAP — snap analítico a la grilla CAD
   ================================================================
   Antes, el snap a grilla se resolvía reusando findSnap() contra un
   VectorSource con TODAS las líneas de grilla visibles. Eso combinaba
   mal con la detección de intersecciones: cada pointermove disparaba
   un chequeo pairwise O(n²) entre decenas/cientos de líneas — el
   cuello de botella más caro del sistema, corriendo en cada evento
   sin throttle. Además, la fuente (`bundle.snapSource`) nunca existió
   en `CadBaseMapBundle`, así que en producción esto estaba MUERTO.

   La grilla es regular: el punto más cercano se calcula en O(1) con
   una fórmula cerrada, usando el MISMO espaciado ("nice number") que
   dibuja cadGridLayer.ts, así el punto de snap siempre coincide con
   una línea realmente visible en pantalla.
   ================================================================ */

export interface GridSnapOptions {
  resolution: number;
  pixelTolerance?: number;
  /** Origen/offset de la grilla, en EPSG:3857. Default [0, 0]. */
  origin?: [number, number];
}

export function findGridSnap(cursor: number[], options: GridSnapOptions): SnapResult | null {
  const { resolution, pixelTolerance = 12, origin = [0, 0] } = options;
  const spacing = snapSpacing(resolution * 52);
  if (!Number.isFinite(spacing) || spacing <= 0) return null;

  const relX = cursor[0] - origin[0];
  const relY = cursor[1] - origin[1];
  const gx = Math.round(relX / spacing) * spacing + origin[0];
  const gy = Math.round(relY / spacing) * spacing + origin[1];

  const d = Math.hypot(cursor[0] - gx, cursor[1] - gy);
  const tolerance = pixelTolerance * resolution;
  if (d > tolerance) return null;

  return { point: [gx, gy], type: 'grid', dist: d };
}