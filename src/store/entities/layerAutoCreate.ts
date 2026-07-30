import { runCommand } from '../../commands/core/CommandStack';
import { AddLayerCommand } from '../../commands/layers/AddLayerCommand';
import { getLayerSuggestion, type GeoUrbanFeatureKind } from '../../core/objectModel';
import { useLayersStore } from './layersRegistryStore';
import { newId } from '../../lib/id';

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

export function autoCreateLayerForKind(kind: GeoUrbanFeatureKind): string {
  const suggestion = getLayerSuggestion(kind);
  const id = newId('layer');
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
        showLabel: false,
        showCota: false,
        colorMode: suggestion?.colorMode ?? (kind === 'manzana' ? 'colorIdx' : 'solid'),
      },
      'Nueva capa (automática)',
    ),
  );
  return id;
}

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