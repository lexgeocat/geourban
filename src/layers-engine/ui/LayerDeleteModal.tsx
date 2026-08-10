import { useMemo, useState } from 'react';
import { Modal } from '@shared-ui/Modal';
import { useMapStore } from '@map-core/store/mapStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { runCommand } from '@kernel/command/CommandStack';
import { RemoveLayerCommand } from '@layers-engine/commands/RemoveLayerCommand';

export interface LayerDeleteRequest {
  id: string;
  name: string;
}

interface LayerDeleteModalProps {
  request: LayerDeleteRequest | null;
  onClose: () => void;
}

export default function LayerDeleteModal({ request, onClose }: LayerDeleteModalProps) {
  const drawSource = useMapStore((s) => s.drawSource);
  const layers = useLayersStore((s) => s.layers);

  const affectedIds = useMemo(() => {
    if (!request || !drawSource) return [];
    const ids: Array<string | number> = [];
    drawSource.forEachFeature((f) => {
      if (f.get('layerId') === request.id) {
        const id = f.getId();
        if (id != null) ids.push(id);
      }
    });
    return ids;
  }, [request, drawSource]);

  const otherLayers = layers.filter((l) => l.id !== request?.id);
  const [action, setAction] = useState<'move' | 'delete'>('move');
  const [targetLayerId, setTargetLayerId] = useState<string>('');

  const effectiveTarget = targetLayerId || otherLayers[0]?.id || '';

  if (!request) return null;

  const handleConfirm = () => {
    void runCommand(new RemoveLayerCommand({
      layerId: request.id,
      action,
      targetLayerId: action === 'move' ? effectiveTarget : undefined,
    }));
    onClose();
  };

  return (
    <Modal
      open={!!request}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Eliminar capa"
      visuallyHiddenTitle
      width="min(420px, 90vw)"
    >
      <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--cad-text)', marginBottom: 4 }}>
        ¿Eliminar la capa "{request.name}"?
      </h2>

      {affectedIds.length === 0 ? (
        <p style={{ fontSize: '0.72rem', color: 'var(--cad-text-muted)', marginBottom: 14 }}>
          Esta capa no tiene elementos asignados — se puede eliminar sin afectar el dibujo.
        </p>
      ) : (
        <>
          <p style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', marginBottom: 12 }}>
            <strong style={{ color: 'var(--cad-accent-amber)' }}>{affectedIds.length}</strong> elemento(s) están
            asignados a esta capa. Elegí qué hacer con ellos antes de continuar:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="radio" className="cad-radio" checked={action === 'move'} onChange={() => setAction('move')} />
              <span style={{ fontSize: '0.75rem', color: 'var(--cad-text)' }}>Mover a otra capa</span>
            </label>
            {action === 'move' && (
              <select
                value={effectiveTarget}
                onChange={(e) => setTargetLayerId(e.target.value)}
                className="cad-input"
                style={{ marginLeft: 24, width: 'calc(100% - 24px)' }}
                disabled={otherLayers.length === 0}
              >
                {otherLayers.length === 0 && <option value="">No hay otra capa disponible</option>}
                {otherLayers.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="radio" className="cad-radio" checked={action === 'delete'} onChange={() => setAction('delete')} />
              <span style={{ fontSize: '0.75rem', color: 'var(--cad-accent-red)' }}>
                Eliminar también estos {affectedIds.length} elemento(s)
              </span>
            </label>
          </div>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button onClick={onClose} className="cad-btn-secondary">
          Cancelar
        </button>
        <button
          onClick={handleConfirm}
          disabled={affectedIds.length > 0 && action === 'move' && !effectiveTarget}
          className="cad-btn-danger"
        >
          Eliminar capa
        </button>
      </div>
    </Modal>
  );
}