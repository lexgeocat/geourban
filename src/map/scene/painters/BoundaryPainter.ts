import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import { transform } from 'ol/proj.js';
import { convexHull, polyArea, centroid, type Pt } from '../../../geo/math/polygonEngine';
import { formatMetricArea, formatMetricLength } from '../../../geo/metrics';
import { DISPLAY_PROJECTION, GEOGRAPHIC_PROJECTION } from '../../../geo/crs/projections';
import { useProjectCrsStore } from '../../../store/project/projectCrsStore';
import { ensureUtmZoneRegistered } from '../../../geo/crs/utmZones';
import { useDisplayLayersStore } from '../../../store/ui/displayLayersStore';
import { useUiShellStore } from '../../../store/ui/uiShellStore'; // ← NUEVO
import { measureCachedWidth } from '../../textMeasureCache';
import { getFeatureKind } from '../../../core/objectModel';

export class BoundaryPainter {
  private cachedHull: Pt[] = [];
  private lastFingerprint = '';

  private collectHull(features: Array<Feature<Geometry>>): Pt[] {
    const manzanas = features.filter((f) => getFeatureKind(f) === 'manzana');
    const source = manzanas.length > 0 ? manzanas : features.filter((f) => getFeatureKind(f) === 'lote');
    const pts: Pt[] = [];
    for (const f of source) {
      const g = f.getGeometry();
      if (!(g instanceof Polygon)) continue;
      const ring = g.getCoordinates()[0];
      if (!ring) continue;
      for (const c of ring) pts.push([c[0], c[1]]);
    }
    return pts.length >= 3 ? convexHull(pts) : [];
  }

  update(features: Array<Feature<Geometry>>, forceDirty: boolean): void {
    const fp = `${features.length}:${features.reduce((acc, f) => acc + (f.getGeometry()?.getExtent().join(',') ?? ''), '')}`;
    if (!forceDirty && fp === this.lastFingerprint) return;
    this.lastFingerprint = fp;
    this.cachedHull = this.collectHull(features);
  }

  paint(ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number]): void {
    if (this.cachedHull.length < 3) return;
    const ring = this.cachedHull;
    const display = useDisplayLayersStore.getState();
    const urb = display.overlays.urbanizacion;
    const geo = display.overlays.georreferenciado;
    // Fase 1 (fix H-CAPAS-2): interruptor maestro "Cotas" (ribbon Vista).
    const cotaMaster = useUiShellStore.getState().measurementsVisible ? 1 : 0;

    const perimUrbOpacity = urb.visible ? urb.opacity : 0;
    const perimGeoOpacity = geo.visible ? geo.opacity : 0;
    const cotasUrbOpacity = display.cotaOpacity(urb.showCota) * cotaMaster;
    const cotasGeoOpacity = display.cotaOpacity(geo.showCota) * cotaMaster;
    const lblUrbNombre = display.labelOpacity(urb.showLabel);
    const lblUrbSup = lblUrbNombre * display.cotaOpacity(urb.showCota) * cotaMaster;

    if (perimUrbOpacity > 0.002) {
      this.paintRing(ctx, ring, toPx, 'rgba(0, 212, 255, 0.9)', 2.5, [], perimUrbOpacity);
    }
    if (perimGeoOpacity > 0.002) {
      this.paintRing(ctx, ring, toPx, 'rgba(16, 185, 129, 0.9)', 1.5, [8, 5], perimGeoOpacity);
    }
    if (cotasUrbOpacity > 0.002) {
      this.paintSegmentCotas(ctx, ring, toPx, cotasUrbOpacity);
    }
    if (cotasGeoOpacity > 0.002) {
      this.paintVertexCoords(ctx, ring, toPx, cotasGeoOpacity);
    }

    const cen = centroid(ring);
    if (lblUrbNombre > 0.002) {
      this.paintCenterLabel(ctx, cen, toPx, 'Urbanización', '#00d4ff', 0, lblUrbNombre);
    }
    if (lblUrbSup > 0.002) {
      this.paintCenterLabel(ctx, cen, toPx, formatMetricArea(polyArea(ring)), '#94a3b8', 16, lblUrbSup);
    }
  }

  private paintRing(
    ctx: CanvasRenderingContext2D, ring: Pt[], toPx: (c: number[]) => [number, number],
    color: string, width: number, dash: number[], opacity: number,
  ): void {
    if (opacity <= 0.002) return;
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    const first = toPx(ring[0]);
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < ring.length; i++) {
      const p = toPx(ring[i]);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private paintSegmentCotas(ctx: CanvasRenderingContext2D, ring: Pt[], toPx: (c: number[]) => [number, number], opacity: number): void {
    if (opacity <= 0.002) return;
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.font = '600 10px Courier New';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const lenM = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (lenM < 1) continue;
      const aPx = toPx(a), bPx = toPx(b);
      const mx = (aPx[0] + bPx[0]) / 2, my = (aPx[1] + bPx[1]) / 2;
      const label = formatMetricLength(lenM);
      const tw = measureCachedWidth(ctx, label);
      ctx.fillStyle = 'rgba(13, 17, 23, 0.75)';
      ctx.fillRect(mx - tw / 2 - 3, my - 8, tw + 6, 16);
      ctx.fillStyle = '#00d4ff';
      ctx.fillText(label, mx, my);
    }
    ctx.restore();
  }

  private paintVertexCoords(ctx: CanvasRenderingContext2D, ring: Pt[], toPx: (c: number[]) => [number, number], opacity: number): void {
    if (opacity <= 0.002) return;
    const crs = useProjectCrsStore.getState();
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.font = '500 9px Courier New';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#3fb950';
    for (const p of ring) {
      let coordText: string;
      if (crs.mode === 'utm') {
        const epsg = ensureUtmZoneRegistered(crs.utmZone, crs.utmHemisphere);
        const [x, y] = transform(p as unknown as number[], DISPLAY_PROJECTION, epsg);
        coordText = `${x.toFixed(2)}, ${y.toFixed(2)}`;
      } else {
        const [lon, lat] = transform(p as unknown as number[], DISPLAY_PROJECTION, GEOGRAPHIC_PROJECTION);
        coordText = `${lon.toFixed(6)}, ${lat.toFixed(6)}`;
      }
      const px = toPx(p);
      ctx.fillText(coordText, px[0] + 8, px[1]);
    }
    ctx.restore();
  }

  private paintCenterLabel(
    ctx: CanvasRenderingContext2D, centerWorld: Pt, toPx: (c: number[]) => [number, number],
    text: string, color: string, dy: number, opacity: number,
  ): void {
    if (opacity <= 0.002) return;
    const px = toPx(centerWorld);
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.font = '700 13px Courier New';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = measureCachedWidth(ctx, text);
    ctx.fillStyle = 'rgba(13, 17, 23, 0.72)';
    ctx.fillRect(px[0] - tw / 2 - 4, px[1] + dy - 8, tw + 8, 16);
    ctx.fillStyle = color;
    ctx.fillText(text, px[0], px[1] + dy);
    ctx.restore();
  }
}
