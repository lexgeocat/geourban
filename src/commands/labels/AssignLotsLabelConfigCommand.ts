import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import { getFeatureKind } from '../../core/objectModel';
import type { LabelStyleConfig } from '../../core/labelModel';

export interface AssignLotsLabelConfigOptions {
  manzanoId?: string | number;
}

export class AssignLotsLabelConfigCommand extends Command {
  readonly label = 'Etiquetar lotes';
  private readonly config: LabelStyleConfig;
  private readonly opts: AssignLotsLabelConfigOptions;
  private before = new Map<string | number, { config?: LabelStyleConfig; text?: string }>();

  constructor(config: LabelStyleConfig, opts: AssignLotsLabelConfigOptions = {}) {
    super();
    this.config = config;
    this.opts = opts;
  }

  private targets(ctx: CommandContext): Feature<Geometry>[] {
    const targetGroup = this.opts.manzanoId != null ? String(this.opts.manzanoId) : null;
    const out: Feature<Geometry>[] = [];
    ctx.drawSource.forEachFeature((f) => {
      const feat = f as Feature<Geometry>;
      if (getFeatureKind(feat) !== 'lote') return;
      if (targetGroup && feat.get('lotGroupId') !== targetGroup) return;
      out.push(feat);
    });
    return out;
  }

  execute(ctx: CommandContext): void {
    this.before.clear();
    for (const f of this.targets(ctx)) {
      const id = f.getId();
      if (id == null) continue;
      this.before.set(id, { config: f.get('labelConfig'), text: f.get('labelText') });
      const code = (f.get('code') as string | undefined) ?? '';
      f.set('labelConfig', this.config, true);
      f.set('labelText', code, true);
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
