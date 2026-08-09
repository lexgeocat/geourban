import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import { useLayersStore } from '../../../store/entities/layersRegistryStore';
import { useStreetStore, type Street } from '../../../store/entities/streetStore';
import { useRoundaboutStore, type Roundabout } from '../../../store/entities/roundaboutStore';
import {
  useEntityLabelStore,
  type EntityLabelEntry,
} from '../../../store/entities/entityLabelStore';
import { roundaboutRoadAreaM2 } from '../../../geo/roundabout/roundaboutEngine';
import {
  formatAreaWithUnit,
  composeLabelLines,
  type LabelStyleConfig,
} from '../../../core/labelModel';
import { measureCached } from '../../textMeasureCache';
import { formatMetricLength, streetLengthMetricM, type SegmentMetric } from '../../../geo/metrics';
import {
  computeStreetCrossings,
  pickStreetLabelSlots,
  type StreetLabelSlot,
} from '../../labels/streetLabelSlots';

interface PlacedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLLISION_GRID_CELL_PX = 48;
const HARD_VISIBLE_CAP = 20_000;
const STREET_LABEL_MIN_ZOOM = 12;
const STREET_LABEL_REPEAT_M = 140;

class LabelCollisionGrid {
  private cells = new Map<string, PlacedBox[]>();
  private key(cx: number, cy: number): string {
    return cx + ',' + cy;
  }
  private range(box: PlacedBox) {
    return {
      cx0: Math.floor(box.x / COLLISION_GRID_CELL_PX),
      cy0: Math.floor(box.y / COLLISION_GRID_CELL_PX),
      cx1: Math.floor((box.x + box.w) / COLLISION_GRID_CELL_PX),
      cy1: Math.floor((box.y + box.h) / COLLISION_GRID_CELL_PX),
    };
  }
  intersects(box: PlacedBox): boolean {
    const { cx0, cy0, cx1, cy1 } = this.range(box);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const b of bucket) {
          if (
            box.x < b.x + b.w &&
            box.x + box.w > b.x &&
            box.y < b.y + b.h &&
            box.y + box.h > b.y
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }
  insert(box: PlacedBox): void {
    const { cx0, cy0, cx1, cy1 } = this.range(box);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = this.key(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(box);
      }
    }
  }
  clear(): void {
    this.cells.clear();
  }
}

function buildLabelLines(feature: Feature<Geometry>, cfg: LabelStyleConfig): string[] {
  return composeLabelLines(cfg, {
    text: (feature.get('labelText') as string | undefined) ?? '',
    primaryValue: feature.get('areaM2') as number | undefined,
    secondaryValue: feature.get('perimeterM') as number | undefined,
  });
}
function streetAllCoords(s: Street): [number, number][] {
  return [s.start, ...(s.waypoints ?? []), s.end];
}

function polylineMidpoint(coords: [number, number][]): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = Math.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1]);
    segLens.push(d);
    total += d;
  }
  const half = total / 2;
  let walked = 0;
  for (let i = 0; i < segLens.length; i++) {
    const isLast = i === segLens.length - 1;
    if (walked + segLens[i] >= half || isLast) {
      const t = segLens[i] > 1e-9 ? Math.max(0, Math.min(1, (half - walked) / segLens[i])) : 0;
      const a = coords[i],
        b = coords[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += segLens[i];
  }
  return coords[coords.length - 1];
}

function buildStreetLabelLines(street: Street, cfg: LabelStyleConfig, text: string): string[] {
  return composeLabelLines(cfg, {
    text,
    primaryValue: streetLengthMetricM(street),
    primaryFormatter: (v) => formatMetricLength(v),
    secondaryLabel: 'Calzada',
    secondaryValue: street.widthM,
  });
}

function buildRoundaboutLabelLines(rb: Roundabout, cfg: LabelStyleConfig, text: string): string[] {
  return composeLabelLines(cfg, {
    text,
    primaryValue: roundaboutRoadAreaM2(rb),
    secondaryLabel: 'Radio',
    secondaryValue: rb.radiusM,
  });
}

function drawEdgeCotas(
  ctx: CanvasRenderingContext2D,
  segmentLengths: SegmentMetric[] | undefined,
  centroidWorld: [number, number] | undefined,
  toPx: (c: number[]) => [number, number],
  cfg: LabelStyleConfig
): void {
  if (!segmentLengths || segmentLengths.length === 0) return;
  const MIN_SEGMENT_PX = 30;
  const offsetPx = 13;
  const fs = cfg.cotaFontSizePx;
  const cenPx = centroidWorld ? toPx(centroidWorld) : null;

  ctx.save();
  for (const meta of segmentLengths) {
    if (!meta || !Number.isFinite(meta.lengthM) || meta.lengthM <= 0) continue;
    if (!meta.p0 || !meta.p1) continue;
    const aPx = toPx(meta.p0);
    const bPx = toPx(meta.p1);
    const dxPx = bPx[0] - aPx[0];
    const dyPx = bPx[1] - aPx[1];
    const lenPx = Math.hypot(dxPx, dyPx);
    if (lenPx < MIN_SEGMENT_PX) continue;

    let ang = Math.atan2(dyPx, dxPx);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;

    let nx = -dyPx / lenPx;
    let ny = dxPx / lenPx;
    if (cenPx) {
      const midPx: [number, number] = [(aPx[0] + bPx[0]) / 2, (aPx[1] + bPx[1]) / 2];
      const pointsAway = (midPx[0] - cenPx[0]) * nx + (midPx[1] - cenPx[1]) * ny >= 0;
      if (!pointsAway) {
        nx = -nx;
        ny = -ny;
      }
    }

    const dimA: [number, number] = [aPx[0] + nx * offsetPx, aPx[1] + ny * offsetPx];
    const dimB: [number, number] = [bPx[0] + nx * offsetPx, bPx[1] + ny * offsetPx];

    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(aPx[0] + nx * 3, aPx[1] + ny * 3);
    ctx.lineTo(dimA[0], dimA[1]);
    ctx.moveTo(bPx[0] + nx * 3, bPx[1] + ny * 3);
    ctx.lineTo(dimB[0], dimB[1]);
    ctx.moveTo(dimA[0], dimA[1]);
    ctx.lineTo(dimB[0], dimB[1]);
    ctx.stroke();

    const txC = (dimA[0] + dimB[0]) / 2;
    const tyC = (dimA[1] + dimB[1]) / 2;
    const text =
      meta.lengthM >= 100 ? meta.lengthM.toFixed(1) + ' m' : meta.lengthM.toFixed(2) + ' m';
    ctx.save();
    ctx.translate(txC, tyC);
    ctx.rotate(ang);
    ctx.font = `500 ${fs}px ${cfg.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(13, 17, 23, 0.85)';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = cfg.color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function streetLabelSignature(
  streets: Street[],
  entries: Record<string, EntityLabelEntry>,
  zoomBucket: number
): string {
  let sig = `z${zoomBucket}`;
  for (const s of streets) {
    const e = entries[s.id];
    if (!e || !e.config.enabled) continue;
    sig +=
      `|${s.id}:${s.start[0]},${s.start[1]}-${s.end[0]},${s.end[1]}:${s.widthM}:${s.sideWidthM}` +
      `:${(s.waypoints ?? []).length}:${e.text}:${e.config.prefix}:${e.config.showPrefix}` +
      `:${e.config.showArea}:${e.config.showPerimeter}:${e.config.labelFontSizePx}:${e.config.fontFamily}`;
  }
  return sig;
}

export class LabelPainter {
  private readonly collisionGrid = new LabelCollisionGrid();
  private readonly streetSlots = new globalThis.Map<string, StreetLabelSlot[]>();
  private streetSlotsSignature = '';

  /** Recalcula los slots de etiqueta de calle (posición + evita cruces/extremos) cuando cambia algo relevante. */
  update(ctx: CanvasRenderingContext2D, zoom: number, resolution: number): void {
    const streets = useStreetStore.getState().streets;
    const entries = useEntityLabelStore.getState().byId;
    const zoomBucket = Math.round(zoom * 4);
    const sig = streetLabelSignature(streets, entries, zoomBucket);
    if (sig === this.streetSlotsSignature) return;
    this.streetSlotsSignature = sig;
    this.streetSlots.clear();

    const relevant = streets.filter((s) => entries[s.id]?.config.enabled);
    if (relevant.length === 0) return;

    const crossings = computeStreetCrossings(streets);
    for (const s of relevant) {
      const entry = entries[s.id];
      const lines = buildStreetLabelLines(s, entry.config, entry.text);
      if (lines.length === 0) continue;

      ctx.save();
      ctx.font = `bold ${entry.config.labelFontSizePx}px ${entry.config.fontFamily}`;
      let maxW = 0;
      for (const line of lines) maxW = Math.max(maxW, measureCached(ctx, line).width);
      ctx.restore();

      const textHalfWidthMapUnits = (maxW / 2 + 4) * resolution;
      this.streetSlots.set(
        s.id,
        pickStreetLabelSlots(
          s,
          crossings.get(s.id) ?? [],
          textHalfWidthMapUnits,
          STREET_LABEL_REPEAT_M
        )
      );
    }
  }

  paint(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
    interacting: boolean
  ): void {
    if (interacting) return;
    if (features.length > HARD_VISIBLE_CAP) return;

    this.collisionGrid.clear();
    const registry = useLayersStore.getState();

    for (const feature of features) {
      const cfg = feature.get('labelConfig') as LabelStyleConfig | undefined;
      if (!cfg || !cfg.enabled) continue;

      const geometry = feature.getGeometry();
      if (!(geometry instanceof Polygon)) continue;

      const layerId = feature.get('layerId') as string | undefined;
      const layer = layerId ? registry.getById(layerId) : undefined;
      if (layer && !layer.visible) continue;

      const labelPoint = feature.get('labelPoint') as [number, number] | undefined;
      if (!labelPoint) continue;

      if (!layer || layer.showLabel !== false) {
        const lines = buildLabelLines(feature, cfg);
        if (lines.length > 0) this.drawLabelBlock(ctx, toPx(labelPoint), lines, cfg);
      }

      if (cfg.showEdgeCotas && (!layer || layer.showCota !== false)) {
        drawEdgeCotas(
          ctx,
          feature.get('segmentLengths') as SegmentMetric[] | undefined,
          labelPoint,
          toPx,
          cfg
        );
      }
    }

    if (zoom > STREET_LABEL_MIN_ZOOM) this.paintStreetLabels(ctx, toPx);
    this.paintRoundaboutLabels(ctx, toPx, resolution);
  }

  private paintStreetLabels(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number]
  ): void {
    const entries = useEntityLabelStore.getState().byId;
    const streets = useStreetStore.getState().streets;
    for (const s of streets) {
      const entry = entries[s.id];
      if (!entry || !entry.config.enabled) continue;
      const lines = buildStreetLabelLines(s, entry.config, entry.text);
      if (lines.length === 0) continue;

      const slots = this.streetSlots.get(s.id);
      if (!slots || slots.length === 0) {
        const anchor = polylineMidpoint(streetAllCoords(s));
        this.drawLabelBlock(ctx, toPx(anchor), lines, entry.config);
        continue;
      }
      for (const slot of slots) {
        const a = toPx(slot.segFrom);
        const b = toPx(slot.segTo);
        let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
        this.drawRotatedLabelBlock(ctx, toPx(slot.pos), angle, lines, entry.config);
      }
    }
  }

  private paintRoundaboutLabels(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number],
    resolution: number
  ): void {
    const entries = useEntityLabelStore.getState().byId;
    const roundabouts = useRoundaboutStore.getState().roundabouts;
    for (const rb of roundabouts) {
      const entry = entries[rb.id];
      if (!entry || !entry.config.enabled) continue;
      const lines = buildRoundaboutLabelLines(rb, entry.config, entry.text);
      if (lines.length === 0) continue;
      const px = toPx(rb.center);
      const offsetPx = rb.radiusM / resolution + 18;
      this.drawLabelBlock(ctx, [px[0], px[1] + offsetPx], lines, entry.config);
    }
  }

  private drawLabelBlock(
    ctx: CanvasRenderingContext2D,
    px: [number, number],
    lines: string[],
    cfg: LabelStyleConfig
  ): void {
    const fs = cfg.labelFontSizePx;
    const lineHeight = fs * 1.25;
    ctx.save();
    ctx.font = `700 ${fs}px ${cfg.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let maxW = 0;
    for (const line of lines) maxW = Math.max(maxW, measureCached(ctx, line).width);
    const totalH = lines.length * lineHeight;
    const box: PlacedBox = {
      x: px[0] - maxW / 2 - 4,
      y: px[1] - totalH / 2 - 2,
      w: maxW + 8,
      h: totalH + 4,
    };
    if (this.collisionGrid.intersects(box)) {
      ctx.restore();
      return;
    }
    this.collisionGrid.insert(box);

    ctx.fillStyle = 'rgba(13, 17, 23, 0.72)';
    ctx.fillRect(box.x, box.y, box.w, box.h);

    ctx.fillStyle = cfg.color;
    let y = px[1] - totalH / 2 + lineHeight / 2;
    for (const line of lines) {
      ctx.fillText(line, px[0], y);
      y += lineHeight;
    }
    ctx.restore();
  }

  private drawRotatedLabelBlock(
    ctx: CanvasRenderingContext2D,
    px: [number, number],
    angle: number,
    lines: string[],
    cfg: LabelStyleConfig
  ): void {
    const fs = cfg.labelFontSizePx;
    const lineHeight = fs * 1.25;
    ctx.save();
    ctx.font = `700 ${fs}px ${cfg.fontFamily}`;

    let maxW = 0;
    for (const line of lines) maxW = Math.max(maxW, measureCached(ctx, line).width);
    const totalH = lines.length * lineHeight;
    const w = maxW + 8;
    const h = totalH + 4;

    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const boundW = w * cos + h * sin;
    const boundH = w * sin + h * cos;
    const box: PlacedBox = { x: px[0] - boundW / 2, y: px[1] - boundH / 2, w: boundW, h: boundH };
    if (this.collisionGrid.intersects(box)) {
      ctx.restore();
      return;
    }
    this.collisionGrid.insert(box);

    ctx.translate(px[0], px[1]);
    ctx.rotate(angle);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(13, 17, 23, 0.72)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = cfg.color;
    let y = -totalH / 2 + lineHeight / 2;
    for (const line of lines) {
      ctx.fillText(line, 0, y);
      y += lineHeight;
    }
    ctx.restore();
  }
}
