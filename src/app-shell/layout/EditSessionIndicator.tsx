import { useEditSessionStore } from '@layers-engine/store/editSessionStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { PenLine } from 'lucide-react';

export default function EditSessionIndicator() {
  const editingLayerIds = useEditSessionStore((s) => s.editingLayerIds);
  const stopAll = useEditSessionStore((s) => s.stopAll);
  const getById = useLayersStore((s) => s.getById);

  const active = Array.from(editingLayerIds).filter((id) => !getById(id)?.locked);
  if (active.length === 0) return null;

  const names = active.map((id) => getById(id)?.name).filter((n): n is string => !!n).join(', ');

  return (
    <span
      className="cad-tooltip"
      data-tooltip={`Editando: ${names}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '2px 6px', borderRadius: 4,
        background: 'rgba(245, 158, 11, 0.12)',
        border: '1px solid rgba(245, 158, 11, 0.35)',
        color: 'var(--cad-accent-amber)', fontSize: '0.65rem', fontWeight: 600,
      }}
    >
      <PenLine size={12} />
      <span>{active.length} {active.length === 1 ? 'capa en edición' : 'capas en edición'}</span>
      <button
        onClick={stopAll}
        className="cad-a11y-btn"
        title="Detener edición en todas las capas"
        aria-label="Detener edición en todas las capas"
        style={{ marginLeft: 4, color: 'var(--cad-accent-amber)', fontSize: '0.7rem', lineHeight: 1 }}
      >
        ✕
      </button>
    </span>
  );
}