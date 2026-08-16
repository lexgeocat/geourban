import type { LabelStyleConfig } from '../model/labelModel';

export interface LabelCandidate {
  id: string;
  kind: 'feature' | 'street' | 'roundabout' | 'cota';
  layerId?: string;
  layerZIndex: number;
  classPriority: number;
  anchorPx: [number, number];
  widthPx: number;
  heightPx: number;
  style: LabelStyleConfig;
  text: string;
  rotation?: number;
  placementOffsets?: Array<[number, number]>;
  allowLeaderLine?: boolean;
  category: 'polygon' | 'line' | 'point' | 'street' | 'roundabout' | 'cota';
}

export interface PlacedLabel {
  candidate: LabelCandidate;
  positionPx: [number, number];
  dropped: boolean;
  reason?: 'collision' | 'zoom' | 'noAnchor';
  leaderFromPx?: [number, number];
}

export interface CollisionBox {
  x: number;
  y: number;
  w: number;
  h: number;
  source: 'label' | 'cota';
}

export interface ResolveContext {
  zoom: number;
  resolution: number;
  extent?: [number, number, number, number];
}

export interface ResolveResult {
  placed: PlacedLabel[];
  dropped: PlacedLabel[];
  hiddenCount: number;
}

const COLLISION_GRID_CELL_PX = 48;

export class LabelCollisionGrid {
  private cells = new Map<string, CollisionBox[]>();

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private range(box: CollisionBox): {
    cx0: number;
    cy0: number;
    cx1: number;
    cy1: number;
  } {
    return {
      cx0: Math.floor(box.x / COLLISION_GRID_CELL_PX),
      cy0: Math.floor(box.y / COLLISION_GRID_CELL_PX),
      cx1: Math.floor((box.x + box.w) / COLLISION_GRID_CELL_PX),
      cy1: Math.floor((box.y + box.h) / COLLISION_GRID_CELL_PX),
    };
  }

  intersects(box: CollisionBox): boolean {
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

  insert(box: CollisionBox): void {
    const { cx0, cy0, cx1, cy1 } = this.range(box);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = this.key(cx, cy);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(box);
      }
    }
  }

  clear(): void {
    this.cells.clear();
  }
}

function zoomAllowed(zoom: number, style: LabelStyleConfig): boolean {
  const min = style.visibleMinZoom;
  const max = style.visibleMaxZoom;
  if (min != null && zoom < min) return false;
  if (max != null && zoom > max) return false;
  return true;
}

function boxForCandidate(c: LabelCandidate, posPx: [number, number]): CollisionBox {
  if (c.rotation != null) {
    const cos = Math.abs(Math.cos(c.rotation));
    const sin = Math.abs(Math.sin(c.rotation));
    const boundW = c.widthPx * cos + c.heightPx * sin;
    const boundH = c.widthPx * sin + c.heightPx * cos;
    return {
      x: posPx[0] - boundW / 2,
      y: posPx[1] - boundH / 2,
      w: boundW,
      h: boundH,
      source: c.category === 'cota' ? 'cota' : 'label',
    };
  }
  return {
    x: posPx[0] - c.widthPx / 2,
    y: posPx[1] - c.heightPx / 2,
    w: c.widthPx,
    h: c.heightPx,
    source: c.category === 'cota' ? 'cota' : 'label',
  };
}

function candidateOffsets(c: LabelCandidate): Array<[number, number]> {
  if (c.placementOffsets && c.placementOffsets.length > 0) return c.placementOffsets;
  return [[0, 0]];
}

export function resolveVisibleLabels(
  candidates: LabelCandidate[],
  ctx: ResolveContext,
  grid: LabelCollisionGrid = new LabelCollisionGrid()
): ResolveResult {
  grid.clear();
  const placed: PlacedLabel[] = [];
  const dropped: PlacedLabel[] = [];

  const ordered = [...candidates].sort((a, b) => {
    if (b.classPriority !== a.classPriority) return b.classPriority - a.classPriority;
    if (b.layerZIndex !== a.layerZIndex) return b.layerZIndex - a.layerZIndex;
    return a.id.localeCompare(b.id);
  });

  for (const c of ordered) {
    if (!zoomAllowed(ctx.zoom, c.style)) {
      dropped.push({ candidate: c, positionPx: c.anchorPx, dropped: true, reason: 'zoom' });
      continue;
    }
    if (!Number.isFinite(c.anchorPx[0]) || !Number.isFinite(c.anchorPx[1])) {
      dropped.push({ candidate: c, positionPx: c.anchorPx, dropped: true, reason: 'noAnchor' });
      continue;
    }

    const offsets = candidateOffsets(c);
    let chosen: { pos: [number, number]; offsetIdx: number } | null = null;
    for (let i = 0; i < offsets.length; i++) {
      const [ox, oy] = offsets[i];
      const pos: [number, number] = [c.anchorPx[0] + ox, c.anchorPx[1] + oy];
      const box = boxForCandidate(c, pos);
      if (!grid.intersects(box)) {
        chosen = { pos, offsetIdx: i };
        break;
      }
    }
    if (!chosen) {
      dropped.push({ candidate: c, positionPx: c.anchorPx, dropped: true, reason: 'collision' });
      continue;
    }
    const box = boxForCandidate(c, chosen.pos);
    grid.insert(box);
    const leaderFromPx = c.allowLeaderLine && chosen.offsetIdx > 0 ? c.anchorPx : undefined;
    placed.push({
      candidate: c,
      positionPx: chosen.pos,
      dropped: false,
      leaderFromPx,
    });
  }

  return { placed, dropped, hiddenCount: dropped.length };
}
