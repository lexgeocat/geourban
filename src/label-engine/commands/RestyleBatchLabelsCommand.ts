import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import { getFeatureKind } from '@kernel/domain-model/featureModel';
import type { LabelStyleConfig } from '../model/labelModel';

export interface RestyleBatchLabelsOptions {
  kind: 'manzana' | 'lote';
  manzanoId?: string | number;
  config: LabelStyleConfig;
}

export class RestyleBatchLabelsCommand extends Command {
  readonly label = 'Actualizar estilo de etiquetas';
  private readonly opts: RestyleBatchLabelsOptions;
  private before = new Map<string | number, LabelStyleConfig | undefined>();
  affectedCount = 0;

  constructor(opts: RestyleBatchLabelsOptions) {
    super();
    this.opts = opts;
  }

  private targets(ctx: CommandContext): Feature<Geometry>[] {
    const targetGroup =
      this.opts.kind === 'lote' && this.opts.manzanoId != null ? String(this.opts.manzanoId) : null;
    const out: Feature<Geometry>[] = [];
    ctx.drawSource.forEachFeature((f) => {
      const feat = f as Feature<Geometry>;
      if (getFeatureKind(feat) !== this.opts.kind) return;
      if (targetGroup && feat.get('lotGroupId') !== targetGroup) return;
      if (!feat.get('labelConfig')) return; // solo restylear lo que ya está etiquetado
      out.push(feat);
    });
    return out;
  }

  execute(ctx: CommandContext): void {
    this.before.clear();
    this.affectedCount = 0;
    for (const f of this.targets(ctx)) {
      const id = f.getId();
      if (id == null) continue;
      const existing = f.get('labelConfig') as LabelStyleConfig | undefined;
      this.before.set(id, existing);
      const merged: LabelStyleConfig = {
        ...this.opts.config,
        titleBadge: existing?.titleBadge ?? 'none',
      };
      f.set('labelConfig', merged, true);
      this.affectedCount++;
    }
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const [id, prevConfig] of this.before) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      if (prevConfig) f.set('labelConfig', prevConfig, true);
      else f.unset('labelConfig', true);
    }
    ctx.drawSource.changed();
  }
}
