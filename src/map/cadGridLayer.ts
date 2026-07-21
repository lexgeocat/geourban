import ImageLayer from 'ol/layer/Image.js';
import ImageCanvasSource from 'ol/source/ImageCanvas.js';
import type Map from 'ol/Map.js';
import type { Extent } from 'ol/extent.js';
import type { Size } from 'ol/size.js';

const NICE_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

const CAD_BG = '#0a0e14';
const CAD_MINOR = 'rgba(36, 48, 68, 0.85)';
const CAD_MAJOR = 'rgba(0, 212, 255, 0.22)';
const CAD_AXIS = 'rgba(0, 212, 255, 0.45)';

export function snapSpacing(meters: number) {
  for (const step of NICE_STEPS) {
    if (step >= meters) return step;
  }
  return NICE_STEPS[NICE_STEPS.length - 1];
}

function isMultipleOf(value: number, step: number) {
  if (step <= 0) return false;
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-4;
}

/**
 * Dibuja la grilla CAD directamente en canvas — reemplaza el enfoque
 * anterior de VectorLayer+Feature por línea (ver diagnóstico H3): un solo
 * beginPath/stroke por color en vez de un Feature + función de estilo por
 * cada línea de la grilla.
 */
function drawCadGrid(
  ctx: CanvasRenderingContext2D,
  extent: Extent,
  resolution: number,
  pixelRatio: number,
  size: Size,
): void {
  const [minX, minY, maxX, maxY] = extent;
  const width = size[0];
  const height = size[1];

  // Fondo
  ctx.fillStyle = CAD_BG;
  ctx.fillRect(0, 0, width, height);

  const minorSpacing = snapSpacing(resolution * 52);
  const majorSpacing = minorSpacing * 5;

  const pad = minorSpacing * 3;
  const x0 = Math.floor((minX - pad) / minorSpacing) * minorSpacing;
  const x1 = Math.ceil((maxX + pad) / minorSpacing) * minorSpacing;
  const y0 = Math.floor((minY - pad) / minorSpacing) * minorSpacing;
  const y1 = Math.ceil((maxY + pad) / minorSpacing) * minorSpacing;

  // Mundo -> pixel de canvas (Y invertida; el canvas crece hacia abajo)
  const toPxX = (x: number) => ((x - minX) / resolution) * pixelRatio;
  const toPxY = (y: number) => ((maxY - y) / resolution) * pixelRatio;

  const vMinor: number[] = [];
  const vMajor: number[] = [];
  const vAxis: number[] = [];
  for (let x = x0; x <= x1; x += minorSpacing) {
    const onAxis = Math.abs(x) < minorSpacing * 0.01;
    const isMajor = onAxis || isMultipleOf(x, majorSpacing);
    const px = toPxX(x);
    (onAxis ? vAxis : isMajor ? vMajor : vMinor).push(px);
  }

  const hMinor: number[] = [];
  const hMajor: number[] = [];
  const hAxis: number[] = [];
  for (let y = y0; y <= y1; y += minorSpacing) {
    const onAxis = Math.abs(y) < minorSpacing * 0.01;
    const isMajor = onAxis || isMultipleOf(y, majorSpacing);
    const py = toPxY(y);
    (onAxis ? hAxis : isMajor ? hMajor : hMinor).push(py);
  }

  const strokeV = (xs: number[], color: string, lineWidth: number) => {
    if (xs.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (const px of xs) {
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
    }
    ctx.stroke();
  };
  const strokeH = (ys: number[], color: string, lineWidth: number) => {
    if (ys.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (const py of ys) {
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
    }
    ctx.stroke();
  };

  strokeV(vMinor, CAD_MINOR, pixelRatio);
  strokeH(hMinor, CAD_MINOR, pixelRatio);
  strokeV(vMajor, CAD_MAJOR, 1.25 * pixelRatio);
  strokeH(hMajor, CAD_MAJOR, 1.25 * pixelRatio);
  strokeV(vAxis, CAD_AXIS, 1.5 * pixelRatio);
  strokeH(hAxis, CAD_AXIS, 1.5 * pixelRatio);
}

export type CadBaseMapBundle = {
  layer: ImageLayer<ImageCanvasSource>;
  attach: (map: Map) => () => void;
};

export function createCadBaseMap(): CadBaseMapBundle {
  // Reusar un único canvas/contexto entre invocaciones de canvasFunction
  // (mismo patrón que PostrenderPainter).
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo obtener contexto 2D para la grilla CAD');

  const source = new ImageCanvasSource({
    canvasFunction: (extent, resolution, pixelRatio, size) => {
      canvas.width = size[0];
      canvas.height = size[1];
      drawCadGrid(ctx, extent, resolution, pixelRatio, size);
      return canvas;
    },
    projection: 'EPSG:3857',
    // ratio > 1: renderiza un área algo más grande que el viewport, así
    // paneos cortos no disparan un nuevo canvasFunction en cada frame.
    ratio: 1.15,
  });

  const layer = new ImageLayer({ source });

  const attach = (_map: Map) => {
    // ImageCanvasSource ya se invalida sola cuando la vista sale del área
    // cacheada o cambia la resolución — no hace falta escuchar
    // 'moveend'/'change:resolution' a mano como con el VectorLayer viejo.
    return () => {};
  };

  return { layer, attach };
}

export const CAD_BASE_MAP_ATTRIBUTION = 'Fondo CAD — grilla métrica GeoUrban';

export const cadBaseMapBundles = new WeakMap<ImageLayer<ImageCanvasSource>, CadBaseMapBundle>();