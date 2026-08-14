import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import type { Layer } from '@kernel/domain-model/featureModel';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useStreetStore, type Street } from '@vias-engine/store/streetStore';
import { useRoundaboutStore, type Roundabout } from '@vias-engine/store/roundaboutStore';
import { useEntityLabelStore, type EntityLabelEntry } from '../store/entityLabelStore';
import { roundaboutRoadAreaM2 } from '@vias-engine/geometry/roundaboutEngine';
import {
  composeLabelLines,
  formatAreaWithUnit,
  labelRenderCapDefault,
  labelRenderCaps,
  resolveLabelExpression,
  type LabelStyleConfig,
} from '../model/labelModel';
import { measureCached } from '../util/textMeasureCache';
import {
  formatMetricLength,
  streetLengthMetricM,
  type SegmentMetric,
} from '@georef-engine/metrics';
import {
  computeStreetCrossings,
  pickStreetLabelSlots,
  type StreetLabelSlot,
} from '../geometry/streetLabelSlots';
import { CAD_BG_DEEPEST_RGB } from '@kernel/theme/colors';
import {
  resolveEntityLayer,
  resolveRoundaboutLayer,
} from '@layers-engine/selectors/layersPainterHelpers';
import { resolveFeatureLabel, resolveEntityLabelFromClass } from '../engine/resolveFeatureLabel';
import { useLabelClassStore } from '../store/labelClassStore';
import {
  LabelCollisionGrid,
  resolveVisibleLabels,
  type LabelCandidate,
  type PlacedLabel,
} from '../engine/LabelEngineService';
import { useLabelEngineTelemetryStore } from '../store/labelEngineTelemetryStore';

const LABEL_BG_HEAVY = `rgba(${CAD_BG_DEEPEST_RGB}, 0.72)`;

interface PlacedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLLISION_GRID_CELL_PX = 48;
const STREET_LABEL_MIN_ZOOM = 12;
const STREET_LABEL_REPEAT_M = 140;

function labelFontWeight(cfg: LabelStyleConfig): number {
  return cfg.bold === false ? 400 : 700;
}

class PainterCollisionGrid {
  private cells = new Map<string, PlacedBox[]>();
  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
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
  private readonly collisionGrid = new PainterCollisionGrid();
  private readonly streetSlots = new globalThis.Map<string, StreetLabelSlot[]>();
  private streetSlotsSignature = '';
  private lastZoom = 0;

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
      ctx.font = `${labelFontWeight(entry.config)} ${entry.config.labelFontSizePx}px ${entry.config.fontFamily}`;
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

    this.collisionGrid.clear();
    this.lastZoom = zoom;
    const registry = useLayersStore.getState();

    this.paintPolygonLabelsAndCotas(ctx, features, zoom, resolution, toPx, registry);

    if (zoom > STREET_LABEL_MIN_ZOOM) this.paintStreetLabels(ctx, toPx, registry);
    this.paintRoundaboutLabels(ctx, toPx, resolution, registry);
  }

  private paintPolygonLabelsAndCotas(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
    registry: ReturnType<typeof useLayersStore.getState>
  ): void {
    const classByLayer = useLabelClassStore.getState().byLayerId;
    const engineGrid = new LabelCollisionGrid();
    const candidates: LabelCandidate[] = [];
    const featureById = new Map<string, Feature<Geometry>>();
    const resolvedStyleByFeatureId = new Map<string, { style: LabelStyleConfig; text: string }>();
    const processedByKind = new Map<string, number>();
    const cotaTargets: Array<{
      feature: Feature<Geometry>;
      labelPoint: [number, number];
      layer: Layer | undefined;
      style: LabelStyleConfig;
    }> = [];

    for (const feature of features) {
      const geometry = feature.getGeometry();
      if (!(geometry instanceof Polygon)) continue;

      const kind = (feature.get('kind') as string) ?? 'poligono';
      const cap = labelRenderCaps[kind] ?? labelRenderCapDefault;
      const seen = processedByKind.get(kind) ?? 0;
      if (seen >= cap) continue;
      processedByKind.set(kind, seen + 1);

      const layerId = feature.get('layerId') as string | undefined;
      const layer = layerId ? registry.getById(layerId) : undefined;
      if (layer && !layer.visible) continue;

      const classObj = layerId ? classByLayer[layerId] : undefined;
      const resolved = resolveFeatureLabel(feature, classObj, { zoom });
      if (resolved.source === 'none' || !resolved.style.enabled) continue;

      const labelPoint = feature.get('labelPoint') as [number, number] | undefined;
      if (!labelPoint) continue;

      const cfg = resolved.style;
      const text = resolved.text || ((feature.get('labelText') as string | undefined) ?? '');

      const fid = String(feature.getId() ?? '');
      if (fid) {
        featureById.set(fid, feature);
      }

      if (!layer || layer.showLabel !== false) {
        const isRemnant = feature.get('isRemnant') === true;
        const effectiveStyle: LabelStyleConfig =
          isRemnant && classObj?.remnantStyle
            ? { ...classObj.remnantStyle, enabled: true, titleBadge: classObj.remnantStyle.titleBadge ?? cfg.titleBadge }
            : cfg.useLayerColor && layer
              ? { ...cfg, color: layer.color }
              : cfg;
        const resolvedText = effectiveStyle.textExpression
          ? resolveLabelExpression(
              effectiveStyle.textExpression,
              text,
              {
                code: feature.get('code') as string | undefined,
                areaM2: feature.get('areaM2') as number | undefined,
                perimeterM: feature.get('perimeterM') as number | undefined,
                name: feature.get('label') as string | undefined,
                layer: layer?.name,
              },
              formatAreaWithUnit
            )
          : text;
        resolvedStyleByFeatureId.set(fid, { style: effectiveStyle, text: resolvedText });
        const lines = composeLabelLines(effectiveStyle, {
          text: resolvedText,
          primaryValue: feature.get('areaM2') as number | undefined,
          secondaryValue: feature.get('perimeterM') as number | undefined,
        });
        if (lines.length > 0) {
          const size = this.measureLabelBlockSize(ctx, lines, effectiveStyle);
          if (size) {
            const [ax, ay] = toPx(labelPoint);
            candidates.push({
              id: `feat:${fid}`,
              kind: 'feature',
              layerId,
              layerZIndex: layer?.zIndex ?? 0,
              classPriority: cfg.priority ?? classObj?.priority ?? 0,
              anchorPx: [ax, ay],
              widthPx: size.w,
              heightPx: size.h,
              style: effectiveStyle,
              text,
              category: 'polygon',
              allowLeaderLine: classObj?.placement?.allowLeaderLine ?? false,
              isRemnant,
              placementOffsets: [
                [0, 0],
                [0, -size.h * 0.6],
                [0, size.h * 0.6],
                [size.w * 0.6, 0],
                [-size.w * 0.6, 0],
              ],
            });
          }
        }
      }

      if (cfg.showEdgeCotas && (!layer || layer.showCota !== false)) {
        cotaTargets.push({ feature, labelPoint, layer, style: cfg });
      }
    }

    const result = resolveVisibleLabels(candidates, { zoom, resolution }, engineGrid);

    useLabelEngineTelemetryStore.getState().setHidden(result.hiddenCount, {
      collision: result.dropped.filter((d) => d.reason === 'collision').length,
      zoom: result.dropped.filter((d) => d.reason === 'zoom').length,
      noAnchor: result.dropped.filter((d) => d.reason === 'noAnchor').length,
    });

    const placedByFeatureId = new Map<string, PlacedLabel>();
    for (const p of result.placed) {
      const fid = p.candidate.id.startsWith('feat:') ? p.candidate.id.slice(5) : '';
      if (fid) placedByFeatureId.set(fid, p);
    }

    for (const target of cotaTargets) {
      const fid = String(target.feature.getId() ?? '');
      const placed = placedByFeatureId.get(fid);
      const labelCenterPx: [number, number] = placed
        ? placed.positionPx
        : toPx(target.labelPoint);
      this.drawEdgeCotasWithCollision(
        ctx,
        target.feature.get('segmentLengths') as SegmentMetric[] | undefined,
        labelCenterPx,
        toPx,
        target.style,
        engineGrid
      );
    }

    for (const p of result.placed) {
      const fid = p.candidate.id.startsWith('feat:') ? p.candidate.id.slice(5) : '';
      const feature = featureById.get(fid);
      if (!feature) continue;
      const resolved = resolvedStyleByFeatureId.get(fid);
      if (!resolved) continue;
      const lines = composeLabelLines(resolved.style, {
        text: resolved.text,
        primaryValue: feature.get('areaM2') as number | undefined,
        secondaryValue: feature.get('perimeterM') as number | undefined,
      });
      if (lines.length === 0) continue;
      if (p.leaderFromPx) this.drawLeaderLine(ctx, p.leaderFromPx, p.positionPx, resolved.style);
      this.drawLabelBlock(ctx, p.positionPx, lines, resolved.style);
    }
  }

  private measureLabelBlockSize(
    ctx: CanvasRenderingContext2D,
    lines: string[],
    cfg: LabelStyleConfig
  ): { w: number; h: number } | null {
    if (lines.length === 0) return null;
    const fs = cfg.labelFontSizePx;
    const lineHeight = fs * 1.25;
    ctx.save();
    ctx.font = `${labelFontWeight(cfg)} ${fs}px ${cfg.fontFamily}`;
    const useBadge = cfg.titleBadge === 'circle';
    const bodyLines = useBadge ? lines.slice(1) : lines;
    let maxW = 0;
    for (const line of bodyLines) maxW = Math.max(maxW, measureCached(ctx, line).width);
    const bodyH = bodyLines.length * lineHeight;
    const badge = useBadge ? this.measureBadge(ctx, lines[0], fs) : null;
    const gap = badge && bodyLines.length > 0 ? 4 : 0;
    const totalH = (badge?.h ?? 0) + gap + bodyH;
    const boxW = Math.max(maxW + 8, badge ? badge.w + 4 : 0);
    ctx.restore();
    return { w: boxW, h: totalH + 4 };
  }

  private drawEdgeCotasWithCollision(
    ctx: CanvasRenderingContext2D,
    segmentLengths: SegmentMetric[] | undefined,
    centroidPx: [number, number] | undefined,
    toPx: (c: number[]) => [number, number],
    cfg: LabelStyleConfig,
    grid: LabelCollisionGrid
  ): void {
    if (!segmentLengths || segmentLengths.length === 0) return;
    const MIN_SEGMENT_PX = 30;
    const offsetPx = 13;
    const fs = cfg.cotaFontSizePx;
    const cenPx: [number, number] | null = centroidPx ?? null;
    const showLines = cfg.cotaStyle !== 'text';
    const internal = cfg.cotaPosition === 'internal';

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
        const shouldPointAway = !internal;
        if (pointsAway !== shouldPointAway) {
          nx = -nx;
          ny = -ny;
        }
      }

      const dimA: [number, number] = [aPx[0] + nx * offsetPx, aPx[1] + ny * offsetPx];
      const dimB: [number, number] = [bPx[0] + nx * offsetPx, bPx[1] + ny * offsetPx];

      const text =
        meta.lengthM >= 100 ? meta.lengthM.toFixed(1) + ' m' : meta.lengthM.toFixed(2) + ' m';
      const textWidth = (() => {
        ctx.save();
        ctx.font = `500 ${fs}px ${cfg.fontFamily}`;
        const w = measureCached(ctx, text).width;
        ctx.restore();
        return w;
      })();
      const textH = fs * 1.2;
      const txC = (dimA[0] + dimB[0]) / 2;
      const tyC = (dimA[1] + dimB[1]) / 2;
      const cotaBox = {
        x: txC - textWidth / 2 - 2,
        y: tyC - textH / 2,
        w: textWidth + 4,
        h: textH,
        source: 'cota' as const,
      };
      if (grid.intersects(cotaBox)) continue;

      if (showLines) {
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
      }

      grid.insert(cotaBox);

      ctx.save();
      ctx.translate(txC, tyC);
      ctx.rotate(ang);
      ctx.font = `500 ${fs}px ${cfg.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(${CAD_BG_DEEPEST_RGB}, 0.85)`;
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = cfg.color;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawLeaderLine(
    ctx: CanvasRenderingContext2D,
    fromPx: [number, number],
    toPx: [number, number],
    cfg: LabelStyleConfig
  ): void {
    ctx.save();
    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(fromPx[0], fromPx[1]);
    ctx.lineTo(toPx[0], toPx[1]);
    ctx.stroke();
    ctx.restore();
  }

  private paintStreetLabels(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number],
    registry: ReturnType<typeof useLayersStore.getState>
  ): void {
    const entries = useEntityLabelStore.getState().byId;
    const streets = useStreetStore.getState().streets;
    const byId = new Map<string, Layer>();
    for (const layer of registry.layers) byId.set(layer.id, layer);
    const classByLayer = useLabelClassStore.getState().byLayerId;
    for (const s of streets) {
      const layer = resolveEntityLayer(s, 'calle', registry, byId);
      if (layer && (layer.showLabel === false || !layer.visible)) continue;
      const classObj = layer ? classByLayer[layer.id] : undefined;
      const override = entries[s.id];
      const resolved = override
        ? resolveEntityLabelFromClass(classObj, override.text, { zoom: this.lastZoom })
        : resolveEntityLabelFromClass(classObj, s.name, { zoom: this.lastZoom });
      const effectiveStyle = override && override.config.enabled ? override.config : resolved.style;
      if (!effectiveStyle || !effectiveStyle.enabled) continue;
      const effectiveText = override ? override.text : resolved.text;
      if (!effectiveText) continue;
      const lines = buildStreetLabelLines(s, effectiveStyle, effectiveText);
      if (lines.length === 0) continue;

      const slots = this.streetSlots.get(s.id);
      if (!slots || slots.length === 0) {
        const anchor = polylineMidpoint(streetAllCoords(s));
        this.drawLabelBlock(ctx, toPx(anchor), lines, effectiveStyle);
        continue;
      }
      for (const slot of slots) {
        const a = toPx(slot.segFrom);
        const b = toPx(slot.segTo);
        let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
        this.drawRotatedLabelBlock(ctx, toPx(slot.pos), angle, lines, effectiveStyle);
      }
    }
  }

  private paintRoundaboutLabels(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number],
    resolution: number,
    registry: ReturnType<typeof useLayersStore.getState>
  ): void {
    const entries = useEntityLabelStore.getState().byId;
    const roundabouts = useRoundaboutStore.getState().roundabouts;
    const byId = new Map<string, Layer>();
    for (const layer of registry.layers) byId.set(layer.id, layer);
    const classByLayer = useLabelClassStore.getState().byLayerId;
    for (const rb of roundabouts) {
      const layer = resolveRoundaboutLayer(rb, registry, byId);
      if (layer && (layer.showLabel === false || !layer.visible)) continue;
      const classObj = layer ? classByLayer[layer.id] : undefined;
      const override = entries[rb.id];
      const resolved = override
        ? resolveEntityLabelFromClass(classObj, override.text, { zoom: this.lastZoom })
        : resolveEntityLabelFromClass(classObj, rb.name, { zoom: this.lastZoom });
      const effectiveStyle = override && override.config.enabled ? override.config : resolved.style;
      if (!effectiveStyle || !effectiveStyle.enabled) continue;
      const effectiveText = override ? override.text : resolved.text;
      if (!effectiveText) continue;
      const lines = buildRoundaboutLabelLines(rb, effectiveStyle, effectiveText);
      if (lines.length === 0) continue;
      const px = toPx(rb.center);
      const offsetPx = rb.radiusM / resolution + 18;
      this.drawLabelBlock(ctx, [px[0], px[1] + offsetPx], lines, effectiveStyle);
    }
  }

  private measureBadge(
    ctx: CanvasRenderingContext2D,
    text: string,
    fontSizePx: number
  ): { w: number; h: number } {
    const m = measureCached(ctx, text);
    const padX = fontSizePx * 0.55;
    const padY = fontSizePx * 0.36;
    let w = m.width + padX * 2;
    let h = fontSizePx * 1.15 + padY * 2;
    if (w <= h * 1.6) {
      w = Math.max(w, h);
      h = w;
    }
    return { w, h };
  }
  private paintBadge(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    text: string,
    fontSizePx: number,
    fontWeight: number,
    cfg: LabelStyleConfig
  ): void {
    const { w, h } = this.measureBadge(ctx, text, fontSizePx);
    const isCircle = w === h;

    ctx.save();
    ctx.beginPath();
    if (isCircle) {
      ctx.arc(cx, cy, w / 2, 0, Math.PI * 2);
    } else {
      const r = h / 2;
      const halfW = w / 2;
      ctx.moveTo(cx - halfW + r, cy - r);
      ctx.lineTo(cx + halfW - r, cy - r);
      ctx.arc(cx + halfW - r, cy, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(cx - halfW + r, cy + r);
      ctx.arc(cx - halfW + r, cy, r, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.closePath();
    }
    ctx.fillStyle = `rgba(${CAD_BG_DEEPEST_RGB}, 0.92)`;
    ctx.fill();
    ctx.lineWidth = Math.max(1.25, fontSizePx * 0.1);
    ctx.strokeStyle = cfg.color;
    ctx.stroke();

    ctx.font = `${fontWeight} ${fontSizePx}px ${cfg.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cfg.color;
    ctx.fillText(text, cx, cy + fontSizePx * 0.02);
    ctx.restore();
  }

  private drawLabelBlock(
    ctx: CanvasRenderingContext2D,
    px: [number, number],
    lines: string[],
    cfg: LabelStyleConfig
  ): void {
    if (lines.length === 0) return;
    const fs = cfg.labelFontSizePx;
    const lineHeight = fs * 1.25;
    const weight = labelFontWeight(cfg);
    const useBadge = cfg.titleBadge === 'circle';

    ctx.save();
    ctx.font = `${weight} ${fs}px ${cfg.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const bodyLines = useBadge ? lines.slice(1) : lines;
    let maxW = 0;
    for (const line of bodyLines) maxW = Math.max(maxW, measureCached(ctx, line).width);
    const bodyH = bodyLines.length * lineHeight;

    const badge = useBadge ? this.measureBadge(ctx, lines[0], fs) : null;
    const gap = badge && bodyLines.length > 0 ? 4 : 0;
    const totalH = (badge?.h ?? 0) + gap + bodyH;
    const boxW = Math.max(maxW + 8, badge ? badge.w + 4 : 0);

    const box: PlacedBox = {
      x: px[0] - boxW / 2,
      y: px[1] - totalH / 2 - 2,
      w: boxW,
      h: totalH + 4,
    };
    if (this.collisionGrid.intersects(box)) {
      ctx.restore();
      return;
    }
    this.collisionGrid.insert(box);

    let cursorY = box.y + 2;
    if (badge) {
      this.paintBadge(ctx, px[0], cursorY + badge.h / 2, lines[0], fs, weight, cfg);
      cursorY += badge.h + gap;
    }

    if (bodyLines.length > 0) {
      ctx.fillStyle = LABEL_BG_HEAVY;
      ctx.fillRect(box.x, cursorY, box.w, bodyH + 2);
      ctx.fillStyle = cfg.color;
      let y = cursorY + lineHeight / 2 + 1;
      for (const line of bodyLines) {
        ctx.fillText(line, px[0], y);
        y += lineHeight;
      }
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
    ctx.font = `${labelFontWeight(cfg)} ${fs}px ${cfg.fontFamily}`;

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
    ctx.fillStyle = LABEL_BG_HEAVY;
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
