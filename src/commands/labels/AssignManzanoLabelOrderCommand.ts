import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import type { LabelStyleConfig } from '../../core/labelModel';
import { autoLetterCode } from '../../lib/autoName';
import type { LabelNumberingMode } from '../../store/ui/labelConfigModalStore';

export class AssignManzanoLabelOrderCommand extends Command {
  readonly label = 'Etiquetar manzanos en orden';
  private readonly orderedIds: Array<string | number>;
  private readonly config: LabelStyleConfig;
  private readonly numbering: LabelNumberingMode;
  private before = new Map<string | number, { config?: LabelStyleConfig; text?: string }>();

  constructor(orderedIds: Array<string | number>, config: LabelStyleConfig, numbering: LabelNumberingMode) {
    super();
    this.orderedIds = orderedIds;
    this.config = config;
    this.numbering = numbering;
  }

  execute(ctx: CommandContext): void {
    this.before.clear();
    this.orderedIds.forEach((id, i) => {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) return;
      this.before.set(id, { config: f.get('labelConfig'), text: f.get('labelText') });
      const suffix = this.numbering === 'alpha' ? autoLetterCode(i) : String(i + 1);
      f.set('labelConfig', this.config, true);
      f.set('labelText', suffix, true);
    });
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const [id, prev] of this.before) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      if (prev.config) f.set('labelConfig', prev.config, true);
      else f.unset('labelConfig', true);
      if (prev.text !== undefined) f.set('labelText', prev.text, true);
      else f.unset('labelText', true);
    }
    ctx.drawSource.changed();
  }
}
