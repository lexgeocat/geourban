import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import { useDisplayLayersStore } from '../../../store/ui/displayLayersStore';
import { getFeatureKind } from '../../../core/objectModel';

/** Vértices de lotes/manzanos. Gateo via displayLayersStore:
 *   - dots   → overlay 'vertices' (visible + opacity)
 *   - labels → vertices.showLabel
 */
export class VertexPainter {
  paint(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    toPx: (c: number[]) => [number, number],
  ): void {
    const display = useDisplayLayersStore.getState();
    const verts = display.overlays.vertices;
    const dotOpacity = verts.visible ? verts.opacity : 0;
    const labelOpacity = display.labelOpacity(verts.showLabel);
    if (dotOpacity <= 0.002 && labelOpacity <= 0.002) return;

    for (const feature of features) {
      const kind = getFeatureKind(feature);
      if (kind !== 'lote' && kind !== 'manzana') continue;
      const geom = feature.getGeometry();
      if (!(geom instanceof Polygon)) continue;
      const ring = geom.getCoordinates()[0];
      if (!ring || ring.length < 2) continue;
      const n = ring.length - 1; // el último punto repite al primero

      for (let i = 0; i < n; i++) {
        const px = toPx(ring[i]);

        if (dotOpacity > 0.002) {
          ctx.save();
          ctx.globalAlpha *= dotOpacity;
          ctx.beginPath();
          ctx.arc(px[0], px[1], 3, 0, Math.PI * 2);
          ctx.fillStyle = '#f59e0b';
          ctx.fill();
          ctx.strokeStyle = 'rgba(13,17,23,0.8)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        }

        if (labelOpacity > 0.002) {
          ctx.save();
          ctx.globalAlpha *= labelOpacity;
          ctx.font = '600 9px Courier New';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = 'rgba(13,17,23,0.85)';
          ctx.fillText(String(i + 1), px[0] + 5, px[1] - 5);
          ctx.fillStyle = '#f59e0b';
          ctx.fillText(String(i + 1), px[0] + 4, px[1] - 6);
          ctx.restore();
        }
      }
    }
  }
}
