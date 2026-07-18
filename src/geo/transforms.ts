import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';

let _idCounter = 0;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now()}-${_idCounter.toString(36)}`;
}

/** Devuelve un clon del feature con un id nuevo, geometría clonada y
 *  todas las props copiadas (shallow). El clon no está en ningún source;
 *  lo agrega el llamador. */
export function cloneFeature(
  source: Feature<Geometry>,
  options: { prefix?: string } = {},
): Feature<Geometry> {
  const { prefix = 'feat' } = options;
  const g = source.getGeometry();
  if (!g) throw new Error('cloneFeature: feature sin geometría');
  const clone = new Feature({ geometry: g.clone() });
  // Clonar props (shallow) — kind, label, areaM2, text, etc.
  const props = source.getProperties();
  for (const k of Object.keys(props)) {
    if (k === 'geometry') continue;
    const v = props[k];
    if (v === undefined) continue;
    clone.set(k, v);
  }
  clone.setId(nextId(prefix));
  return clone;
}

/** Traslada la geometría del feature en (dx, dy) en el sistema de
 *  coordenadas del feature. Muta in-place. */
export function translateFeature(feature: Feature<Geometry>, dx: number, dy: number): void {
  const g = feature.getGeometry();
  if (!g) return;
  g.translate(dx, dy);
}

/** Rota la geometría `angle` (radianes) alrededor de `anchor` (en el
 *  sistema de coordenadas del feature). Muta in-place. */
export function rotateFeature(feature: Feature<Geometry>, angle: number, anchor: number[]): void {
  const g = feature.getGeometry();
  if (!g) return;
  g.rotate(angle, anchor);
}

/** Escala la geometría por `factor` respecto a `anchor`. factor>1 agranda,
 *  0<factor<1 achica. Muta in-place. */
export function scaleFeature(feature: Feature<Geometry>, factor: number, anchor: number[]): void {
  const g = feature.getGeometry();
  if (!g) return;
  g.scale(factor, factor, anchor);
}

/** Refleja la geometría sobre el eje definido por `a` y `b` (2 puntos).
 *  Muta in-place. */
export function mirrorFeature(feature: Feature<Geometry>, a: number[], b: number[]): void {
  const g = feature.getGeometry();
  if (!g) return;
  // Vector del eje
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return;
  // Transformación afín: reflejo sobre la recta que pasa por `a` con
  // dirección (dx, dy). Proyecta el punto sobre el eje y devuelve el
  // punto simétrico (2*proy - punto).
  const mirror2D: import('ol/proj.js').TransformFunction = (input, output, dimension = 2, stride = dimension) => {
    const out = output ?? input;
    for (let i = 0; i < input.length; i += stride) {
      const ex = input[i] - a[0];
      const ey = input[i + 1] - a[1];
      const t = (ex * dx + ey * dy) / len2;
      const px = a[0] + t * dx;
      const py = a[1] + t * dy;
      out[i] = 2 * px - input[i];
      out[i + 1] = 2 * py - input[i + 1];
    }
    return out;
  };
  g.applyTransform(mirror2D);
}
