import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from './Command';

let _idCounter = 0;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now()}-${_idCounter.toString(36)}`;
}

/**
 * Agrega un feature al drawSource.
 *
 * Modos:
 *  - `register` (default): `execute` agrega el feature al source. Uso
 *    normal desde código que construye un feature y lo quiere agregar
 *    pasando por el CommandStack.
 *  - `claim`: el feature YA fue agregado al source por fuera (p.ej. la
 *    interacción `Draw` de OpenLayers); `execute` no lo vuelve a
 *    agregar, sólo deja que el CommandStack registre el snapshot para
 *    que undo funcione.
 */
export class AddFeatureCommand extends Command {
  readonly label: string;
  private readonly feature: Feature<Geometry>;
  private readonly mode: 'register' | 'claim';

  constructor(
    feature: Feature<Geometry>,
    options: { mode?: 'register' | 'claim'; label?: string; prefix?: string } = {},
  ) {
    super();
    const { mode = 'register', label, prefix = 'feat' } = options;
    this.mode = mode;
    this.feature = feature;
    this.label = label ?? (mode === 'claim' ? 'Dibujar feature' : 'Agregar feature');
    if (mode === 'register' && feature.getId() == null) {
      feature.setId(nextId(prefix));
    }
  }

  execute(ctx: CommandContext): void {
    if (this.mode === 'claim') {
      const id = this.feature.getId();
      if (id == null) {
        this.feature.setId(nextId('feat'));
      }
      if (ctx.drawSource.getFeatureById(this.feature.getId() as string | number) == null) {
        ctx.drawSource.addFeature(this.feature);
      }
      return;
    }
    ctx.drawSource.addFeature(this.feature);
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    const id = this.feature.getId();
    if (id == null) return;
    const f = ctx.drawSource.getFeatureById(id);
    if (f) ctx.drawSource.removeFeature(f);
    ctx.drawSource.changed();
  }
}
