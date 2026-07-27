import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useLayerPickerStore } from '../../store/ui/layerPickerStore';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { GeoUrbanFeatureKind } from '../../core/objectModel';

const KIND_LABELS: Partial<Record<GeoUrbanFeatureKind, string>> = {
  lote: 'Lote / parcela',
  manzana: 'Manzano',
  calle: 'Vía',
  equipamiento: 'Equipamiento',
  area_verde: 'Área verde',
  linea: 'Línea',
};

export default function LayerPickerModal() {
  const pending = useLayerPickerStore((s) => s.pending);
  const resolvePending = useLayerPickerStore((s) => s.resolvePending);
  const cancelPending = useLayerPickerStore((s) => s.cancelPending);
  const layers = useLayersStore((s) => s.layers);
  const [remember, setRemember] = useState(false);

  if (!pending) return null;

  const kindLabel = KIND_LABELS[pending.kind] ?? 'elemento';
  const sorted = [...layers].sort((a, b) => {
    const aMatch = a.kind === pending.kind ? 0 : 1;
    const bMatch = b.kind === pending.kind ? 0 : 1;
    return aMatch - bMatch;
  });

  const handlePick = (layerId: string) => {
    resolvePending(layerId, remember);
    setRemember(false);
  };

  const handleCancel = () => {
    cancelPending();
    setRemember(false);
  };

  return (
    <Modal
      open={!!pending}
      onOpenChange={(o) => { if (!o) handleCancel(); }}
      title="Elegí la capa destino"
      visuallyHiddenTitle
      width="min(420px, 90vw)"
    >
      <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--cad-text)', marginBottom: 4 }}>
        ¿A qué capa va este {kindLabel.toLowerCase()}?
      </h2>
      <p style={{ fontSize: '0.72rem', color: 'var(--cad-text-muted)', marginBottom: 12 }}>
        Elegí la capa destino. Podés crear capas nuevas desde el panel de Capas.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50vh', overflowY: 'auto' }}>
        {sorted.map((layer) => (
          <button
            key={layer.id}
            onClick={() => handlePick(layer.id)}
            className="cad-icon-btn"
            style={{
              width: '100%', height: 'auto', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: 'flex-start', background: 'var(--cad-bg-surface)', border: '1px solid var(--cad-border)',
              borderRadius: 6, color: 'var(--cad-text)', textAlign: 'left',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: layer.fillColor ?? layer.color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{layer.name}</span>
            {layer.kind === pending.kind && (
              <span style={{ fontSize: '0.6rem', color: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 3, padding: '0 5px' }}>
                sugerida
              </span>
            )}
          </button>
        ))}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: '0.68rem', color: 'var(--cad-text-dim)', cursor: 'pointer' }}>
        <input type="checkbox" className="cad-toggle" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        No preguntar de nuevo para "{kindLabel}" en esta sesión
      </label>

      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleCancel}
          className="cad-icon-btn"
          style={{ width: 'auto', height: 'auto', padding: '7px 12px', fontSize: '0.72rem', color: 'var(--cad-text-dim)', border: '1px solid var(--cad-border)', borderRadius: 6 }}
        >
          Cancelar (usar capa activa)
        </button>
      </div>
    </Modal>
  );
}
