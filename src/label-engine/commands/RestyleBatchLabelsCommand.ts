import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import { getFeatureKind } from '@kernel/domain-model/featureModel';
import type { LabelStyleConfig } from '../model/labelModel';
import { useLabelClassStore, type LabelClass } from '../store/labelClassStore';

export interface RestyleBatchLabelsOptions {
  kind: 'manzana' | 'lote';
  manzanoId?: string | number;
  config: LabelStyleConfig;
  layerId?: string;
}

export class RestyleBatchLabelsCommand extends Command {
  readonly label = 'Actualizar estilo de etiquetas';
  private readonly opts: RestyleBatchLabelsOptions;
  private before = new Map<string | number, LabelStyleConfig | undefined>();
  private prevClass: LabelClass | null = null;
  private hadPrevClass = false;
  private nextClass: LabelClass | null = null;
  affectedCount = 0;

  constructor(opts: RestyleBatchLabelsOptions) {
    super();
    this.opts = opts;
  }

  private targets(ctx: CommandContext): Feature<Geometry>[] {
    const targetGroup =
      this.opts.kind === 'lote' && this.opts.manzanoId != null ? String(this.opts.manzanoId) : null;
    const targetLayer = this.opts.layerId;
    const out: Feature<Geometry>[] = [];
    ctx.drawSource.forEachFeature((f) => {
      const feat = f as Feature<Geometry>;
      if (getFeatureKind(feat) !== this.opts.kind) return;
      if (targetGroup && feat.get('lotGroupId') !== targetGroup) return;
      if (targetLayer && feat.get('layerId') !== targetLayer) return;
      if (!feat.get('labelConfig')) return;
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
    if (this.opts.layerId) {
      const store = useLabelClassStore.getState();
      this.prevClass = store.getForLayer(this.opts.layerId) ?? null;
      this.hadPrevClass = this.prevClass !== null;
      this.nextClass = store.upsert(this.opts.layerId, { style: this.opts.config });
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
    if (this.opts.layerId) {
      const store = useLabelClassStore.getState();
      if (this.hadPrevClass && this.prevClass) store.upsert(this.opts.layerId, this.prevClass);
      else store.remove(this.opts.layerId);
    }
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    ctx.drawSource.changed();
  }
}
