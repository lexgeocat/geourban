import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import { getFeatureKind } from '@kernel/domain-model/featureModel';
import type { LabelStyleConfig } from '../model/labelModel';
import { resolveEffectiveLabelConfig } from '../model/labelModel';
import { formatOrderLabel } from '../model/labelNumbering';
import type { LabelNumberingMode } from '../store/labelConfigModalStore';
import { naturalCompare } from '@kernel/utils/naturalSort';
import {
  ensureLayerLabelsVisible,
  restoreLabelFields,
  restoreLayerVisibility,
  type LabelFieldsSnapshot,
  type LayerVisibilitySnapshot,
} from './labelCommandUtils';

export interface AssignLotsLabelConfigOptions {
  manzanoId?: string | number;
  numbering: LabelNumberingMode;
  customTemplate?: string;
}

export class AssignLotsLabelConfigCommand extends Command {
  readonly label = 'Etiquetar lotes';
  private readonly config: LabelStyleConfig;
  private readonly opts: AssignLotsLabelConfigOptions;
  private before = new Map<string | number, LabelFieldsSnapshot>();
  private layerSnapshots = new Map<string, LayerVisibilitySnapshot>();

  constructor(config: LabelStyleConfig, opts: AssignLotsLabelConfigOptions) {
    super();
    this.config = config;
    this.opts = opts;
  }

  private targetGroups(ctx: CommandContext): Map<string, Feature<Geometry>[]> {
    const targetGroup = this.opts.manzanoId != null ? String(this.opts.manzanoId) : null;
    const groups = new Map<string, Feature<Geometry>[]>();
    ctx.drawSource.forEachFeature((f) => {
      const feat = f as Feature<Geometry>;
      if (getFeatureKind(feat) !== 'lote') return;
      const groupId = feat.get('lotGroupId') as string | undefined;
      if (!groupId) return;
      if (targetGroup && groupId !== targetGroup) return;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId)!.push(feat);
    });
    return groups;
  }

  execute(ctx: CommandContext): void {
    this.before.clear();
    this.layerSnapshots.clear();
    const effectiveConfig = resolveEffectiveLabelConfig(this.config, this.opts.numbering);

    for (const [groupId, feats] of this.targetGroups(ctx)) {
      const parentFeat = ctx.drawSource.getFeatureById(groupId) as Feature<Geometry> | null;
      const parentCode = (parentFeat?.get('code') as string | undefined) ?? undefined;
      const sorted = [...feats].sort((a, b) =>
        naturalCompare(String(a.get('code') ?? ''), String(b.get('code') ?? ''))
      );
      sorted.forEach((f, i) => {
        const id = f.getId();
        if (id == null) return;
        this.before.set(id, {
          config: f.get('labelConfig') as LabelStyleConfig | undefined,
          text: f.get('labelText') as string | undefined,
          orderIndex: f.get('labelOrderIndex') as number | undefined,
        });
        const text = formatOrderLabel(
          this.opts.numbering,
          i,
          sorted.length,
          parentCode,
          this.opts.customTemplate
        );
        f.set('labelConfig', effectiveConfig, true);
        f.set('labelText', text, true);
        f.set('labelOrderIndex', i, true);
        f.set('labelNumberingMode', this.opts.numbering, true);
        const layerId = f.get('layerId') as string | undefined;
        if (layerId && !this.layerSnapshots.has(layerId)) {
          this.layerSnapshots.set(layerId, ensureLayerLabelsVisible(layerId));
        }
      });
    }
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
