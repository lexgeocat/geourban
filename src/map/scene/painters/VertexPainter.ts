import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import { useDisplayLayersStore } from '../../../store/ui/displayLayersStore';
import { getFeatureKind } from '../../../core/objectModel';

export class VertexPainter {
  paint(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    toPx: (c: number[]) => [number, number],
    interacting: boolean = false,
  ): void {
    // Es puramente decorativo (no afecta geometría real) y es lo más caro
    // por-vértice de todo el pipeline (font reshaping en Skia). Se salta
    // durante pan/zoom/drag — igual que ya hace LabelPainter.
    if (interacting) return;

    const display = useDisplayLayersStore.getState();
    const verts = display.overlays.vertices;
    const dotOpacity = verts.visible ? verts.opacity : 0;
    const labelOpacity = display.labelOpacity(verts.showLabel);
    if (dotOpacity <= 0.002 && labelOpacity <= 0.002) return;

    // Recolectamos los vértices visibles UNA sola vez.
    const entries: Array<{ px: [number, number]; index: number }> = [];
    for (const feature of features) {
      const kind = getFeatureKind(feature);
      if (kind !== 'lote' && kind !== 'manzana' && kind !== 'perimetro') continue;
      const geom = feature.getGeometry();
      if (!(geom instanceof Polygon)) continue;
      const ring = geom.getCoordinates()[0];
      if (!ring || ring.length < 2) continue;
      const n = ring.length - 1;
      for (let i = 0; i < n; i++) entries.push({ px: toPx(ring[i]), index: i });
    }
    if (entries.length === 0) return;

    // Antes: ctx.save()/ctx.restore()/ctx.font por CADA vértice (O(n) font
    // resets). Ahora: un solo save/restore y un solo `ctx.font` para todo
    // el batch — el costo pasa de O(n) reshapes a O(1).
    if (dotOpacity > 0.002) {
      ctx.save();
      ctx.globalAlpha *= dotOpacity;
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = 'rgba(13,17,23,0.8)';
      ctx.lineWidth = 1;
      for (const { px } of entries) {
        ctx.beginPath();
        ctx.arc(px[0], px[1], 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    if (labelOpacity > 0.002) {
      ctx.save();
      ctx.globalAlpha *= labelOpacity;
      ctx.font = '600 9px Courier New';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (const { px, index } of entries) {
        const text = String(index + 1);
        ctx.fillStyle = 'rgba(13,17,23,0.85)';
        ctx.fillText(text, px[0] + 5, px[1] - 5);
        ctx.fillStyle = '#f59e0b';
        ctx.fillText(text, px[0] + 4, px[1] - 6);
      }
      ctx.restore();
    }
  }
}