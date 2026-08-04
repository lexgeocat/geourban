// src/store/entities/layerResolution.ts
import type { GeoUrbanFeatureKind } from '../../core/objectModel';
import { useLayersStore } from './layersRegistryStore';
import { autoCreateLayerForKind } from './layerAutoCreate';

export interface ResolveLayerOpts {
  kind: GeoUrbanFeatureKind;
  override?: string;
  requireKindMatch?: boolean;
  autoCreate?: boolean;
}

/**
 * Resuelve a qué capa debe ir una feature nueva.
 *
 * Jerarquía (en orden, primer match gana):
 *  1. `override` (si se da y existe y no está locked)
 *  2. Capa activa (si existe, no está locked y — si `requireKindMatch` —
 *     su kind coincide con `kind`)
 *  3. Primera capa del kind solicitado (si existe y no está locked)
 *  4. Auto-creación de capa nueva del kind solicitado (si `autoCreate`)
 *
 * Retorna `string` (id) si encontró o auto-creó, `undefined` si no.
 *
 * Notas de diseño:
 *  - `requireKindMatch` se agrega al wrapper de la capa activa para
 *    evitar el bug histórico donde una calle dibujada con la capa
 *    "Lote" activa terminaba asignada a "Lote". El `// FIX:` original
 *    en `layerPickerStore.ts:11-12` documenta el fix que se aplicó
 *    solo a 2 de las 4 funciones; este módulo unifica el criterio.
 *  - `autoCreate: false` (default) preserva el contrato de
 *    `resolveLayerId` original, que retorna `undefined` cuando no
 *    hay capa apta (los comandos que la usan dejan la feature sin
 *    `layerId` y la reconcilian después).
 *  - `autoCreate: true` requiere que el caller acepte el side effect
 *    de correr un `AddLayerCommand` (que es lo que hacen los modos
 *    de dibujo y los dialogs).
 */
export function pickLayerId(opts: ResolveLayerOpts): string | undefined {
  const reg = useLayersStore.getState();
  const requireKindMatch = opts.requireKindMatch ?? true;

  if (opts.override) {
    const preferred = reg.getById(opts.override);
    if (preferred && !preferred.locked) return preferred.id;
  }

  if (reg.activeLayerId) {
    const active = reg.getById(reg.activeLayerId);
    if (active && !active.locked && (!requireKindMatch || active.kind === opts.kind)) {
      return active.id;
    }
  }

  const match = reg.getLayerForKind(opts.kind);
  if (match && !match.locked) return match.id;

  if (opts.autoCreate) {
    return autoCreateLayerForKind(opts.kind);
  }

  return undefined;
}
