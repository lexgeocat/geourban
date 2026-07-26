import type Map from 'ol/Map.js';
import type { SnapGuideVisual } from '../../advancedSnap';

/** Guías visuales del motor de snap. Usa `map.getPixelFromCoordinate`
 *  directo (no el `toPx` con fallback [0,0]) para poder omitir el
 *  dibujo cuando el punto cae fuera de pantalla — mismo comportamiento
 *  que tenía inline en PostrenderPainter. Extraído en Fase 5. */
export class SnapGuidePainter {
  private currentGuide: SnapGuideVisual | null = null;

  constructor(private readonly map: Map) {}

  setGuide(guide: SnapGuideVisual | null): void {
    this.currentGuide = guide;
  }

  paint(ctx: CanvasRenderingContext2D, resolution: number): void {
    if (!this.currentGuide) return;
    const guide = this.currentGuide;

    if (guide.highlightSegment) {
      const [ga, gb] = guide.highlightSegment;
      const gaPx = this.map.getPixelFromCoordinate(ga);
      const gbPx = this.map.getPixelFromCoordinate(gb);
      if (gaPx && gbPx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(gaPx[0], gaPx[1]);
        ctx.lineTo(gbPx[0], gbPx[1]);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (guide.dashedLine) {
      const [da, db] = guide.dashedLine;
      const daPx = this.map.getPixelFromCoordinate(da);
      const dbPx = this.map.getPixelFromCoordinate(db);
      if (daPx && dbPx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.85)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(daPx[0], daPx[1]);
        ctx.lineTo(dbPx[0], dbPx[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
    if (guide.rightAngleSquare) {
      const { point, size } = guide.rightAngleSquare;
      const centerPx = this.map.getPixelFromCoordinate(point);
      if (centerPx) {
        const sizePx = Math.max(6, size / resolution);
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(centerPx[0] - sizePx / 2, centerPx[1] - sizePx / 2, sizePx, sizePx);
        ctx.restore();
      }
    }
    if (guide.distanceLabel) {
      const { point, text } = guide.distanceLabel;
      const px = this.map.getPixelFromCoordinate(point);
      if (px) {
        ctx.save();
        ctx.font = '10px Courier New';
        ctx.fillStyle = 'rgba(0, 212, 255, 0.9)';
        ctx.textAlign = 'center';
        ctx.fillText(text, px[0], px[1] - 6);
        ctx.restore();
      }
    }
  }
}