import { runCommand } from '../../commands/core/CommandStack';
import { AddLayerCommand } from '../../commands/layers/AddLayerCommand';
import { getLayerSuggestion, type GeoUrbanFeatureKind } from '../../core/objectModel';
import { useLayersStore } from './layersRegistryStore';

function uniqueAutoName(kind: GeoUrbanFeatureKind): string {
  const registry = useLayersStore.getState();
  const suggestion = getLayerSuggestion(kind);
  const baseName = suggestion?.name ?? kind;
  const existingNames = new Set(registry.layers.map((l) => l.name));
  if (!existingNames.has(baseName)) return baseName;
  let n = 2;
  let name = `${baseName} ${n}`;
  while (existingNames.has(name)) {
    n += 1;
    name = `${baseName} ${n}`;
  }
  return name;
}

/**
 * Crea automáticamente (sin modal, sin interrumpir al usuario) una nueva capa
 * para `kind`, usando el color/nombre sugerido en LAYER_SUGGESTIONS.
 * El id se genera de forma síncrona: AddLayerCommand.execute() ejecuta
 * store.add(...) de forma síncrona apenas se invoca runCommand(), aunque
 * runCommand() en sí sea async — por eso el id devuelto ya es válido y
 * está disponible de inmediato en el registro. Nunca deja features huérfanas.
 */
export function autoCreateLayerForKind(kind: GeoUrbanFeatureKind): string {
  const suggestion = getLayerSuggestion(kind);
  const id = `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  void runCommand(
    new AddLayerCommand(
      {
        id,
        name: uniqueAutoName(kind),
        kind,
        color: suggestion?.color ?? '#58a6ff',
        fillColor: suggestion?.fillColor ?? suggestion?.color ?? '#58a6ff',
        visible: true,
        locked: false,
        opacity: 1,
        showLabel: true,
        showCota: true,
        colorMode: suggestion?.colorMode ?? (kind === 'manzana' ? 'colorIdx' : 'solid'),
      },
      'Nueva capa (automática)',
    ),
  );
  return id;
}

/**
 * Resuelve la capa a usar para `kind`, priorizando:
 *  1) la capa activa, SOLO si coincide en `kind` (nunca "roba" la capa activa
 *     de otro tipo — p.ej. la del perímetro al generar manzanos),
 *  2) cualquier capa ya existente de ese `kind`,
 *  3) si no hay ninguna candidata: se crea una nueva capa independiente.
 * Nunca devuelve undefined — evita features huérfanas.
 */
export function resolveOrCreateLayerForKind(kind: GeoUrbanFeatureKind): string {
  const registry = useLayersStore.getState();

  if (registry.activeLayerId) {
    const active = registry.getById(registry.activeLayerId);
    if (active && !active.locked && active.kind === kind) return active.id;
  }

  const existing = registry.getLayerForKind(kind);
  if (existing && !existing.locked) return existing.id;

  return autoCreateLayerForKind(kind);
}
