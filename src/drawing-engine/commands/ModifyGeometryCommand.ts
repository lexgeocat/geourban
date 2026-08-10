import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { Geometry as OlGeometry } from 'ol/geom';
import { Command, type CommandContext } from '../core/Command';
import { updateFeatureMetrics } from '../../geo/metrics';
import { estimateGeometryBytes } from '../core/memoryEstimate';

/** Captura el estado "antes" de un cambio de geometría para deshacer. */
function captureGeom(f: Feature<Geometry>): unknown {
  const g = f.getGeometry();
  if (!g) return null;
  return g.clone();
}

function restoreGeom(f: Feature<Geometry>, captured: unknown) {
  if (!captured) return;
  f.setGeometry(captured as OlGeometry);
}

function invalidateOrigin(f: Feature<Geometry>): void {
  if (f.get('origPts') !== undefined || f.get('origParcelId') !== undefined) {
    f.unset('origPts', true);
    f.unset('origParcelId', true);
  }
}

export class ModifyGeometryCommand extends Command {
  readonly label: string;
  readonly coalesceKey: string;
  private readonly targets: Array<Feature<Geometry>>;
  private before: Map<string | number, unknown> = new Map();
  private after: Map<string | number, unknown> = new Map();
  private captured = false;
  private applied = false;

  constructor(targets: Array<Feature<Geometry>>, label = 'Modificar geometría') {
    super();
    this.targets = targets;
    this.label = label;
    this.coalesceKey = `ModifyGeometry:${targets
      .map((t) => t.getId() ?? '')
      .filter(Boolean)
      .join(',')}`;
  }

  captureBefore(): void {
    if (this.captured) return;
    for (const t of this.targets) {
      const id = t.getId();
      if (id == null) continue;
      this.before.set(id, captureGeom(t));
    }
    this.captured = true;
  }

  execute(ctx: CommandContext): void {
    if (this.applied) return;
    for (const t of this.targets) {
      const id = t.getId();
      if (id == null) continue;
      this.after.set(id, captureGeom(t));
      updateFeatureMetrics(t);
      invalidateOrigin(t);
    }
    ctx.drawSource.changed();
    this.applied = true;
  }

  override undo(ctx: CommandContext): void {
    for (const t of this.targets) {
      const id = t.getId();
      if (id == null) continue;
      const b = this.before.get(id);
      if (b !== undefined) restoreGeom(t, b);
      updateFeatureMetrics(t);
      invalidateOrigin(t);
    }
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    for (const t of this.targets) {
      const id = t.getId();
      if (id == null) continue;
      const a = this.after.get(id);
      if (a !== undefined) restoreGeom(t, a);
      updateFeatureMetrics(t);
      invalidateOrigin(t);
    }
    ctx.drawSource.changed();
  }
  override coalesceInto(previous: Command): boolean {
    if (!(previous instanceof ModifyGeometryCommand)) return false;
    if (previous.coalesceKey !== this.coalesceKey) return false;
    for (const [id, geom] of this.after) {
      previous.after.set(id, geom);
    }
    return true;
  }
  override approxMemoryBytes(): number {
    let total = 0;
    for (const g of this.before.values()) total += estimateGeometryBytes(g as Geometry | null);
    for (const g of this.after.values()) total += estimateGeometryBytes(g as Geometry | null);
    return total || 256;
  }
}