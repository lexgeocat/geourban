import { useLabelConfigModalStore } from '../../store/labelConfigModalStore';
import { defaultLabelStyleConfig, defaultColorForKind } from '../../model/labelModel';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import LabelingCard from './LabelingCard';

export default function LoteLabelingCard() {
  const openLotsBatch = useLabelConfigModalStore((s) => s.openForLotsBatch);
  const lastConfig = useLabelConfigModalStore((s) => s.lastLotsConfig);
  const loteLayers = useLayersStore((s) => s.layers.filter((l) => l.kind === 'lote'));
  const primaryLayerId = loteLayers[0]?.id;

  return (
    <LabelingCard
      title="◼ ETIQUETADO DE LOTES"
      buttonLabel="🏷 Etiquetar todos los lotes"
      onClick={() =>
        openLotsBatch(
          undefined,
          lastConfig ?? defaultLabelStyleConfig({ prefix: 'Lote', color: defaultColorForKind('lote') }),
          primaryLayerId
        )
      }
    />
  );
}
