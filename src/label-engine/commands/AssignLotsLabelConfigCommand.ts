import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import { getFeatureKind } from '../../core/objectModel';
import type { LabelStyleConfig } from '../../core/labelModel';
import { formatOrderLabel } from '../../core/labelNumbering';
import type { LabelNumberingMode } from '../../store/ui/labelConfigModalStore';

export interface AssignLotsLabelConfigOptions {
  manzanoId?: string | number;
  numbering: LabelNumberingMode;
}
function lotSortKey(f: Feature<Geometry>): number {
  const code = f.get('code') as string | undefined;
  if (code) {
    const m = /-(\d+)R?$/.exec(code);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}

export class AssignLotsLabelConfigCommand extends Command {
  readonly label = 'Etiquetar lotes';
  private readonly config: LabelStyleConfig;
  private readonly opts: AssignLotsLabelConfigOptions;
  private before = new Map<string | number, { config?: LabelStyleConfig; text?: string }>();

  constructor(config: LabelStyleConfig, opts: AssignLotsLabelConfigOptions) {
    super();
    this.config = config;
    this.opts = opts;
  }

  /** Agrupa lotes por manzano padre (lotGroupId) — la numeración reinicia en 1 por grupo. */
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
    const isCircledMode =
      this.opts.numbering === 'circled' || this.opts.numbering === 'circled-alpha';
    const effectiveConfig: LabelStyleConfig = {
      ...this.config,
      titleBadge: isCircledMode ? 'circle' : 'none',
    };

    for (const [groupId, feats] of this.targetGroups(ctx)) {
      const parentFeat = ctx.drawSource.getFeatureById(groupId) as Feature<Geometry> | null;
      const parentCode = (parentFeat?.get('code') as string | undefined) ?? undefined;
      const sorted = [...feats].sort((a, b) => lotSortKey(a) - lotSortKey(b));
      sorted.forEach((f, i) => {
        const id = f.getId();
        if (id == null) return;
        this.before.set(id, { config: f.get('labelConfig'), text: f.get('labelText') });
        const text = formatOrderLabel(this.opts.numbering, i, sorted.length, parentCode);
        f.set('labelConfig', effectiveConfig, true);
        f.set('labelText', text, true);
      });
    }
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
