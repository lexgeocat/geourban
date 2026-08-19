import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';

export class UpdateFeaturePropertyCommand extends Command {
  readonly label = 'Editar atributo';
  readonly coalesceKey: string;
  private readonly featureId: string | number;
  private readonly key: string;
  private nextValue: unknown;
  private prevValue: unknown;
  private captured = false;

  constructor(featureId: string | number, key: string, nextValue: unknown) {
    super();
    this.featureId = featureId;
    this.key = key;
    this.nextValue = nextValue;
    this.coalesceKey = `UpdateFeatureProperty:${featureId}:${key}`;
  }

  execute(ctx: CommandContext): void {
    const f = ctx.drawSource.getFeatureById(this.featureId) as Feature<Geometry> | null;
    if (!f) return;
    if (!this.captured) {
      this.prevValue = f.get(this.key);
      this.captured = true;
    }
    f.set(this.key, this.nextValue);
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    const f = ctx.drawSource.getFeatureById(this.featureId) as Feature<Geometry> | null;
    if (!f) return;
    if (this.prevValue === undefined) f.unset(this.key);
    else f.set(this.key, this.prevValue);
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    const f = ctx.drawSource.getFeatureById(this.featureId) as Feature<Geometry> | null;
    if (!f) return;
    f.set(this.key, this.nextValue);
    ctx.drawSource.changed();
  }
  override coalesceInto(previous: Command): boolean {
    if (!(previous instanceof UpdateFeaturePropertyCommand)) return false;
    if (previous.coalesceKey !== this.coalesceKey) return false;
    previous.nextValue = this.nextValue;
    return true;
  }
}
