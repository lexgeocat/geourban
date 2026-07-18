import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { Geometry as OlGeometry } from 'ol/geom';
import { Command, type CommandContext } from './Command';
import { updateFeatureMetrics, refreshSourceMetrics } from '../geo/metrics';

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

  /** Llamar ANTES de aplicar el cambio. */
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
    }
    refreshSourceMetrics(ctx.drawSource);
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
    }
    refreshSourceMetrics(ctx.drawSource);
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    for (const t of this.targets) {
      const id = t.getId();
      if (id == null) continue;
      const a = this.after.get(id);
      if (a !== undefined) restoreGeom(t, a);
      updateFeatureMetrics(t);
    }
    refreshSourceMetrics(ctx.drawSource);
    ctx.drawSource.changed();
  }
}
