import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';

let _idCounter = 0;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now()}-${_idCounter.toString(36)}`;
}

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

export function translateFeature(feature: Feature<Geometry>, dx: number, dy: number): void {
  const g = feature.getGeometry();
  if (!g) return;
  g.translate(dx, dy);
}

export function rotateFeature(feature: Feature<Geometry>, angle: number, anchor: number[]): void {
  const g = feature.getGeometry();
  if (!g) return;
  g.rotate(angle, anchor);
}

export function scaleFeature(feature: Feature<Geometry>, factor: number, anchor: number[]): void {
  const g = feature.getGeometry();
  if (!g) return;
  g.scale(factor, factor, anchor);
}

export function mirrorFeature(feature: Feature<Geometry>, a: number[], b: number[]): void {
  const g = feature.getGeometry();
  if (!g) return;
  // Vector del eje
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return;

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
