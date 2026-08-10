import { useLabelConfigModalStore } from '../../store/labelConfigModalStore';
import { defaultLabelStyleConfig, defaultColorForKind } from '../../model/labelModel';
import LabelingCard from './LabelingCard';

export default function ManzanoLabelingCard() {
  const openBatch = useLabelConfigModalStore((s) => s.openForManzanoBatch);
  const lastConfig = useLabelConfigModalStore((s) => s.lastManzanoConfig);

  return (
    <LabelingCard
      title="◼ ETIQUETADO DE MANZANOS"
      buttonLabel="🏷 Configurar / Trazar orden…"
      onClick={() => openBatch(lastConfig ?? defaultLabelStyleConfig({ prefix: 'Mzo.', color: defaultColorForKind('manzana') }))}
    />
  );
}
