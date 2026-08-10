// src/store/entities/layerAutoCreate.ts
import { runCommand } from '@kernel/command/CommandStack';
import { AddLayerCommand } from '@layers-engine/commands/AddLayerCommand';
import { getLayerSuggestion, type GeoUrbanFeatureKind } from '@kernel/domain-model/featureModel';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { newId } from '@kernel/id/id';

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
        visible: true,
        locked: false,
        opacity: 1,
        showLabel: false,
        showCota: false,
      },
      'Nueva capa (automática)',
    ),
  );
  return id;
}
