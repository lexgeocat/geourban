import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import { getFeatureKind } from '@kernel/domain-model/featureModel';
import type { LabelStyleConfig } from '../model/labelModel';
import { resolveEffectiveLabelConfig } from '../model/labelModel';
import { formatOrderLabel, type LabelNumberingMode } from '../model/labelNumbering';
import { useLabelClassStore, type LabelClass } from '../store/labelClassStore';
import { naturalCompare } from '@kernel/utils/naturalSort';

export interface RestyleBatchLabelsOptions {
  kind?: 'manzana' | 'lote';
  manzanoId?: string | number;
  config: LabelStyleConfig;
  layerId?: string;
  numbering?: LabelNumberingMode;
  customTemplate?: string;
}

interface FieldSnapshot {
  config?: LabelStyleConfig;
  text?: string;
  orderIndex?: number;
}

export class RestyleBatchLabelsCommand extends Command {
  readonly label = 'Actualizar estilo de etiquetas';
  private readonly opts: RestyleBatchLabelsOptions;
  private before = new Map<string | number, FieldSnapshot>();
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
      if (this.opts.kind && getFeatureKind(feat) !== this.opts.kind) return;
      if (!this.opts.kind && !targetLayer) return;
      if (targetGroup && feat.get('lotGroupId') !== targetGroup) return;
      if (targetLayer && feat.get('layerId') !== targetLayer) return;
      if (!feat.get('labelConfig')) return;
      out.push(feat);
    });
    return out;
  }

  private snapshot(f: Feature<Geometry>): FieldSnapshot {
    return {
      config: f.get('labelConfig') as LabelStyleConfig | undefined,
      text: f.get('labelText') as string | undefined,
      orderIndex: f.get('labelOrderIndex') as number | undefined,
    };
  }

  execute(ctx: CommandContext): void {
    this.before.clear();
    this.affectedCount = 0;

    const targets = this.targets(ctx);
    const numbering = this.opts.numbering;

    const ordered: Feature<Geometry>[] = [];
    const plain: Feature<Geometry>[] = [];
    for (const f of targets) {
      if (numbering && f.get('labelOrderIndex') != null) ordered.push(f);
      else plain.push(f);
    }

    for (const f of plain) {
      const id = f.getId();
      if (id == null) continue;
      this.before.set(id, this.snapshot(f));
      const existing = f.get('labelConfig') as LabelStyleConfig | undefined;
      const merged: LabelStyleConfig = {
        ...this.opts.config,
        titleBadge: existing?.titleBadge ?? 'none',
      };
      f.set('labelConfig', merged, true);
      this.affectedCount++;
    }

    if (numbering && ordered.length > 0) {
      const groups = new Map<string, Feature<Geometry>[]>();
      for (const f of ordered) {
        const key = this.opts.kind === 'lote' ? String(f.get('lotGroupId') ?? '') : '__all__';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(f);
      }
      for (const [groupKey, feats] of groups) {
        const parentFeat =
          groupKey !== '__all__'
            ? (ctx.drawSource.getFeatureById(groupKey) as Feature<Geometry> | null)
            : null;
        const parentCode = (parentFeat?.get('code') as string | undefined) ?? undefined;
        const sorted = [...feats].sort((a, b) => {
          const ao = (a.get('labelOrderIndex') as number | undefined) ?? Number.MAX_SAFE_INTEGER;
          const bo = (b.get('labelOrderIndex') as number | undefined) ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return naturalCompare(String(a.get('code') ?? ''), String(b.get('code') ?? ''));
        });
        sorted.forEach((f, i) => {
          const id = f.getId();
          if (id == null) return;
          this.before.set(id, this.snapshot(f));
          const existing = f.get('labelConfig') as LabelStyleConfig | undefined;
          const merged: LabelStyleConfig = {
            ...this.opts.config,
            titleBadge: existing?.titleBadge ?? 'none',
          };
          const effective = resolveEffectiveLabelConfig(merged, numbering);
          const text = formatOrderLabel(
            numbering,
            i,
            sorted.length,
            parentCode,
            this.opts.customTemplate
          );
          f.set('labelConfig', effective, true);
          f.set('labelText', text, true);
          f.set('labelOrderIndex', i, true);
          f.set('labelNumberingMode', numbering, true);
          this.affectedCount++;
        });
      }
    }

    if (this.opts.layerId) {
      const store = useLabelClassStore.getState();
      this.prevClass = store.getForLayer(this.opts.layerId) ?? null;
      this.hadPrevClass = this.prevClass !== null;
      this.nextClass = store.upsert(this.opts.layerId, {
        style: this.opts.config,
        ...(numbering
          ? {
              numbering: {
                mode: numbering,
                restartPerParent: this.opts.kind === 'lote',
                customTemplate: this.opts.customTemplate,
              },
            }
          : {}),
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
      if (prev.orderIndex !== undefined) f.set('labelOrderIndex', prev.orderIndex, true);
      else f.unset('labelOrderIndex', true);
    }
    if (this.opts.layerId) {
      const store = useLabelClassStore.getState();
      if (this.hadPrevClass && this.prevClass) store.upsert(this.opts.layerId, this.prevClass);
      else store.remove(this.opts.layerId);
    }
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    this.execute(ctx);
  }
}
