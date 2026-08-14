import { useLabelConfigModalStore } from '../../store/labelConfigModalStore';
import { defaultLabelStyleConfig, defaultColorForKind } from '../../model/labelModel';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import LabelingCard from './LabelingCard';

export default function ManzanoLabelingCard() {
  const openBatch = useLabelConfigModalStore((s) => s.openForManzanoBatch);
  const lastConfig = useLabelConfigModalStore((s) => s.lastManzanoConfig);
  const manzanoLayers = useLayersStore((s) => s.layers.filter((l) => l.kind === 'manzana'));
  const primaryLayerId = manzanoLayers[0]?.id;

  return (
    <LabelingCard
      title="◼ ETIQUETADO DE MANZANOS"
      buttonLabel="🏷 Configurar / Trazar orden…"
      onClick={() =>
        openBatch(
          lastConfig ?? defaultLabelStyleConfig({ prefix: 'Mzo.', color: defaultColorForKind('manzana') }),
          primaryLayerId
        )
      }
    />
  );
}
