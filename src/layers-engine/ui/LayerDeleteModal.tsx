import { useMemo, useState } from 'react';
import { Trash2, FolderInput, AlertTriangle, X } from 'lucide-react';
import { Modal } from '@shared-ui/Modal';
import { useMapStore } from '@map-core/store/mapStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { sumAdapterCounts } from '@layers-engine/extension-points';
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

  const entityCount = useMemo(() => {
    if (!request) return 0;
    return sumAdapterCounts(request.id);
  }, [request]);

  const totalAffected = affectedIds.length + entityCount;

  const otherLayers = layers.filter((l) => l.id !== request?.id);
  const [action, setAction] = useState<'move' | 'delete'>('move');
  const [targetLayerId, setTargetLayerId] = useState<string>('');

  const effectiveTarget = targetLayerId || otherLayers[0]?.id || '';

  if (!request) return null;

  const handleConfirm = () => {
    void runCommand(
      new RemoveLayerCommand({
        layerId: request.id,
        action,
        targetLayerId: action === 'move' ? effectiveTarget : undefined,
      }),
    );
    onClose();
  };

  return (
    <Modal
      open={!!request}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Eliminar capa"
      visuallyHiddenTitle
      width="min(440px, 92vw)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(244, 63, 94, 0.15)',
                border: '1px solid rgba(244, 63, 94, 0.38)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Trash2 size={18} color="#FB7185" />
            </div>
            <div>
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.94rem',
                  fontWeight: 700,
                  color: 'var(--cad-text)',
                }}
              >
                ¿Eliminar la capa &ldquo;{request.name}&rdquo;?
              </h2>
              <p style={{ fontSize: '0.67rem', color: 'var(--cad-text-muted)', marginTop: 2 }}>
                Esta acción modificará la estructura de capas del proyecto
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="cad-panel-header-close"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {totalAffected === 0 ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--cad-bg-surface)',
              border: '1px solid var(--cad-border)',
              fontSize: '0.73rem',
              color: 'var(--cad-text-dim)',
              lineHeight: 1.45,
            }}
          >
            Esta capa no tiene elementos asignados — se puede eliminar directamente sin afectar el dibujo.
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                fontSize: '0.72rem',
                color: 'var(--cad-text-dim)',
                lineHeight: 1.45,
              }}
            >
              <AlertTriangle size={15} color="#FBBF24" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Hay <strong style={{ color: '#FBBF24' }}>{totalAffected}</strong> elemento(s) asignados a esta capa
                {entityCount > 0 && (
                  <span> ({affectedIds.length} geometrías + {entityCount} entidad/es vial/es)</span>
                )}
                . Elegí qué hacer con ellos:
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: action === 'move' ? 'var(--ui-10-gradient-soft)' : 'var(--cad-bg-surface)',
                  border: `1px solid ${action === 'move' ? 'rgba(255, 107, 74, 0.45)' : 'var(--cad-border)'}`,
                  cursor: 'pointer',
                  transition: 'all 140ms ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    className="cad-radio"
                    checked={action === 'move'}
                    onChange={() => setAction('move')}
                  />
                  <FolderInput size={14} color="#38BDF8" />
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--cad-text)' }}>
                    Mover elementos a otra capa
                  </span>
                </div>
                {action === 'move' && (
                  <select
                    value={effectiveTarget}
                    onChange={(e) => setTargetLayerId(e.target.value)}
                    className="cad-input"
                    style={{ marginLeft: 24, width: 'calc(100% - 24px)', fontFamily: 'var(--font-sans)' }}
                    disabled={otherLayers.length === 0}
                  >
                    {otherLayers.length === 0 && <option value="">No hay otra capa disponible</option>}
                    {otherLayers.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: action === 'delete' ? 'rgba(244, 63, 94, 0.14)' : 'var(--cad-bg-surface)',
                  border: `1px solid ${action === 'delete' ? 'rgba(244, 63, 94, 0.45)' : 'var(--cad-border)'}`,
                  cursor: 'pointer',
                  transition: 'all 140ms ease',
                }}
              >
                <input
                  type="radio"
                  className="cad-radio"
                  checked={action === 'delete'}
                  onChange={() => setAction('delete')}
                />
                <Trash2 size={14} color="#FB7185" />
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#FB7185' }}>
                  Eliminar también estos {totalAffected} elemento(s)
                </span>
              </label>
            </div>
          </>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            paddingTop: 10,
            borderTop: '1px solid var(--cad-border)',
          }}
        >
          <button onClick={onClose} className="cad-btn-secondary">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={totalAffected > 0 && action === 'move' && !effectiveTarget}
            className="cad-btn-danger"
          >
            <Trash2 size={14} />
            <span>Eliminar capa</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
