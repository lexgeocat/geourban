import React from 'react';
import { useLabelConfigModalStore } from '../../../store/ui/labelConfigModalStore';
import { defaultLabelStyleConfig, defaultColorForKind } from '../../../core/labelModel';

export default function LoteLabelingCard() {
  const openLotsBatch = useLabelConfigModalStore((s) => s.openForLotsBatch);
  const lastConfig = useLabelConfigModalStore((s) => s.lastLotsConfig);

  return (
    <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
        ◼ ETIQUETADO DE LOTES
      </div>
      <button
        onClick={() => openLotsBatch(undefined, lastConfig ?? defaultLabelStyleConfig({ prefix: 'Lote', color: defaultColorForKind('lote') }))}
        className="cad-icon-btn"
        style={{ width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        🏷 Etiquetar todos los lotes
      </button>
    </div>
  );
}
