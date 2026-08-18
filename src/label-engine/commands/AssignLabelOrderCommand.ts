import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import type { LabelStyleConfig } from '../model/labelModel';
import { resolveEffectiveLabelConfig } from '../model/labelModel';
import { formatOrderLabel } from '../model/labelNumbering';
import type { LabelNumberingMode } from '../store/labelConfigModalStore';
import {
  ensureLayerLabelsVisible,
  restoreLabelFields,
  restoreLayerVisibility,
  type LabelFieldsSnapshot,
  type LayerVisibilitySnapshot,
} from './labelCommandUtils';

export interface AssignLabelOrderOptions {
  orderedIds: Array<string | number>;
  config: LabelStyleConfig;
  numbering: LabelNumberingMode;
  customTemplate?: string;
  label?: string;
}

export class AssignLabelOrderCommand extends Command {
  readonly label: string;
  private readonly orderedIds: Array<string | number>;
  private readonly config: LabelStyleConfig;
  private readonly numbering: LabelNumberingMode;
  private readonly customTemplate?: string;
  private before = new Map<string | number, LabelFieldsSnapshot>();
  private layerSnapshots = new Map<string, LayerVisibilitySnapshot>();

  constructor(opts: AssignLabelOrderOptions) {
    super();
    this.orderedIds = opts.orderedIds;
    this.config = opts.config;
    this.numbering = opts.numbering;
    this.customTemplate = opts.customTemplate;
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
    this.layerSnapshots.clear();
    const total = this.orderedIds.length;
    const effectiveConfig = resolveEffectiveLabelConfig(this.config, this.numbering);
    this.orderedIds.forEach((id, i) => {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) return;
      this.before.set(id, {
        config: f.get('labelConfig') as LabelStyleConfig | undefined,
        text: f.get('labelText') as string | undefined,
        orderIndex: f.get('labelOrderIndex') as number | undefined,
      });
      const parentCode = this.resolveParentCode(f, ctx);
      const suffix = formatOrderLabel(this.numbering, i, total, parentCode, this.customTemplate);
      f.set('labelConfig', effectiveConfig, true);
      f.set('labelText', suffix, true);
      f.set('labelOrderIndex', i, true);
      f.set('labelNumberingMode', this.numbering, true);
      const layerId = f.get('layerId') as string | undefined;
      if (layerId && !this.layerSnapshots.has(layerId)) {
        this.layerSnapshots.set(layerId, ensureLayerLabelsVisible(layerId));
      }
    });
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const [id, prev] of this.before) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      restoreLabelFields(f, prev);
    }
    for (const [layerId, snap] of this.layerSnapshots) {
      restoreLayerVisibility(layerId, snap);
    }
    ctx.drawSource.changed();
  }
}
