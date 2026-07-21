import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { Geometry as OlGeometry } from 'ol/geom';
import { Command, type CommandContext } from './Command';
import { updateFeatureMetrics } from '../geo/metrics';

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

/**
 * Se eliminó el `refreshSourceMetrics` global tras cada execute/undo/redo
 * — este comando ya conoce exactamente qué features tocó (`this.targets`)
 * y ya recalcula su métrica una por una; barrer TODO `drawSource` en cada
 * arrastre de vértice/traslado era trabajo puro desperdiciado sobre
 * features que ni se movieron — ver diagnóstico H9.
 */
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
    ctx.drawSource.changed();
  }

  /** Fusiona el "after" de un paso de edición posterior dentro de este
   *  comando — el "before" original de la secuencia completa se mantiene,
   *  así el primer undo revierte TODOS los pasos coalescidos de una vez
   *  (p.ej. varios drags consecutivos del mismo vértice/feature dentro de
   *  la ventana de coalescing). */
  override coalesceInto(previous: Command): boolean {
    if (!(previous instanceof ModifyGeometryCommand)) return false;
    if (previous.coalesceKey !== this.coalesceKey) return false;
    for (const [id, geom] of this.after) {
      previous.after.set(id, geom);
    }
    return true;
  }
}