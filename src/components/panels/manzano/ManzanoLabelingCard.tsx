import React from 'react';
import { useLabelConfigModalStore } from '../../../store/ui/labelConfigModalStore';
import { defaultLabelStyleConfig, defaultColorForKind } from '../../../core/labelModel';

export default function ManzanoLabelingCard() {
  const openBatch = useLabelConfigModalStore((s) => s.openForManzanoBatch);
  const lastConfig = useLabelConfigModalStore((s) => s.lastManzanoConfig);

  return (
    <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
        ◼ ETIQUETADO DE MANZANOS
      </div>
      <button
        onClick={() => openBatch(lastConfig ?? defaultLabelStyleConfig({ prefix: 'Mzo.', color: defaultColorForKind('manzana') }))}
        className="cad-icon-btn"
        style={{ width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }} >
        🏷 Configurar / Trazar orden…
      </button>
    </div>
  );
}
