import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import type { LabelStyleConfig } from '../model/labelModel';
import { resolveEffectiveLabelConfig } from '../model/labelModel';
import { formatOrderLabel } from '../model/labelNumbering';
import type { LabelNumberingMode } from '../store/labelConfigModalStore';
import { restoreLabelFields, type LabelFieldsSnapshot } from './labelCommandUtils';

export interface AssignLabelOrderOptions {
  orderedIds: Array<string | number>;
  config: LabelStyleConfig;
  numbering: LabelNumberingMode;
  label?: string;
}

export class AssignLabelOrderCommand extends Command {
  readonly label: string;
  private readonly orderedIds: Array<string | number>;
  private readonly config: LabelStyleConfig;
  private readonly numbering: LabelNumberingMode;
  private before = new Map<string | number, LabelFieldsSnapshot>();

  constructor(opts: AssignLabelOrderOptions) {
    super();
    this.orderedIds = opts.orderedIds;
    this.config = opts.config;
    this.numbering = opts.numbering;
    this.label = opts.label ?? 'Etiquetar en orden';
  }
  private resolveParentCode(f: Feature<Geometry>, ctx: CommandContext): string | undefined {
    const groupId = f.get('lotGroupId') as string | undefined;
    if (!groupId) return undefined;
    const parent = ctx.drawSource.getFeatureById(groupId) as Feature<Geometry> | null;
    return (parent?.get('code') as string | undefined) ?? undefined;
  }

  execute(ctx: CommandContext): void {
    this.before.clear();
    const total = this.orderedIds.length;
    const effectiveConfig = resolveEffectiveLabelConfig(this.config, this.numbering);
    this.orderedIds.forEach((id, i) => {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) return;
      this.before.set(id, { config: f.get('labelConfig'), text: f.get('labelText') });
      const parentCode = this.resolveParentCode(f, ctx);
      const suffix = formatOrderLabel(this.numbering, i, total, parentCode);
      f.set('labelConfig', effectiveConfig, true);
      f.set('labelText', suffix, true);
    });
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const [id, prev] of this.before) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      restoreLabelFields(f, prev);
    }
    ctx.drawSource.changed();
  }
}
