import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import type { LabelStyleConfig } from '../../core/labelModel';

export class ApplyLabelConfigCommand extends Command {
  readonly label = 'Configurar etiqueta';
  private readonly featureId: string | number;
  private readonly next: LabelStyleConfig;
  private readonly nextLabelText: string;
  private prevConfig: LabelStyleConfig | undefined;
  private prevLabelText: string | undefined;

  constructor(featureId: string | number, next: LabelStyleConfig, nextLabelText: string) {
    super();
    this.featureId = featureId;
    this.next = next;
    this.nextLabelText = nextLabelText;
  }

  execute(ctx: CommandContext): void {
    const f = ctx.drawSource.getFeatureById(this.featureId) as Feature<Geometry> | null;
    if (!f) return;
    this.prevConfig = f.get('labelConfig') as LabelStyleConfig | undefined;
    this.prevLabelText = f.get('labelText') as string | undefined;
    f.set('labelConfig', this.next, true);
    f.set('labelText', this.nextLabelText, true);
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    const f = ctx.drawSource.getFeatureById(this.featureId) as Feature<Geometry> | null;
    if (!f) return;
    if (this.prevConfig) f.set('labelConfig', this.prevConfig, true);
    else f.unset('labelConfig', true);
    if (this.prevLabelText !== undefined) f.set('labelText', this.prevLabelText, true);
    else f.unset('labelText', true);
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    this.execute(ctx);
  }
}
