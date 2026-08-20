import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type Map from 'ol/Map.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { computeLiveSegmentStats } from '../styles/liveDimensions';
import { CAD_BG_DEEPEST_RGB } from '@kernel/theme/colors';

const LABEL_COLOR = '#ffe27a';
const LABEL_BG = `rgba(${CAD_BG_DEEPEST_RGB}, 0.82)`;

function extractLiveRing(geom: Geometry | undefined | null): number[][] {
  if (!geom) return [];
  if (geom instanceof Polygon) return geom.getCoordinates()[0] ?? [];
  if (geom instanceof LineString) return geom.getCoordinates();
  return [];
}

export class VertexEditOverlayPainter {
  private targets: Array<Feature<Geometry>> = [];

  constructor(private readonly map: Map) {}

  setTargets(features: Array<Feature<Geometry>> | null): void {
    this.targets = features ?? [];
  }

  paint(ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number]): void {
    if (this.targets.length === 0) return;

    for (const feature of this.targets) {
      const ring = extractLiveRing(feature.getGeometry());
      if (ring.length < 2) continue;
      const stats = computeLiveSegmentStats(this.map, ring);

      for (const seg of stats) {
        const px = toPx(seg.labelPoint);
        const text =
          seg.lengthM >= 100 ? seg.lengthM.toFixed(1) + ' m' : seg.lengthM.toFixed(2) + ' m';

        ctx.save();
        ctx.font = '600 10px Courier New';
        const metrics = ctx.measureText(text);
        const boxW = metrics.width + 10;
        const boxH = 15;
        ctx.translate(px[0], px[1]);
        ctx.rotate(seg.angleRad);
        ctx.fillStyle = LABEL_BG;
        ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
        ctx.fillStyle = LABEL_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
  }
}
