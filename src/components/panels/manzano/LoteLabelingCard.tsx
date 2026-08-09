import React from 'react';
import { useLabelConfigModalStore } from '../../../store/ui/labelConfigModalStore';
import { defaultLabelStyleConfig, defaultColorForKind } from '../../../core/labelModel';
import LabelingCard from './LabelingCard';

export default function LoteLabelingCard() {
  const openLotsBatch = useLabelConfigModalStore((s) => s.openForLotsBatch);
  const lastConfig = useLabelConfigModalStore((s) => s.lastLotsConfig);

  return (
    <LabelingCard
      title="◼ ETIQUETADO DE LOTES"
      buttonLabel="🏷 Etiquetar todos los lotes"
      onClick={() => openLotsBatch(undefined, lastConfig ?? defaultLabelStyleConfig({ prefix: 'Lote', color: defaultColorForKind('lote') }))}
    />
  );
}
