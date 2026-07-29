import React, { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useLayerPickerStore } from '../../store/ui/layerPickerStore';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import { UNASSIGNED_LAYER_ID, type GeoUrbanFeatureKind } from '../../core/objectModel';

const KIND_LABELS: Partial<Record<GeoUrbanFeatureKind, string>> = {
  lote: 'Lote / parcela',
  manzana: 'Manzano',
  calle: 'Vía',
  equipamiento: 'Equipamiento',
  area_verde: 'Área verde',
  linea: 'Línea',
  texto: 'Texto',
  cota: 'Acotación',
  urbanizacion: 'Urbanización',
  georreferenciado: 'Georreferenciado',
  rotonda: 'Rotonda',

};

type Tab = 'existing' | 'create';

export default function LayerResolverModal() {
  const pending = useLayerPickerStore((s) => s.pending);
  const resolveWithExisting = useLayerPickerStore((s) => s.resolveWithExisting);
  const resolveWithNewLayer = useLayerPickerStore((s) => s.resolveWithNewLayer);
  const cancelPending = useLayerPickerStore((s) => s.cancelPending);
  const layers = useLayersStore((s) => s.layers);

  const [tab, setTab] = useState<Tab>('existing');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#58a6ff');
  const [fillColor, setFillColor] = useState('#58a6ff');
  const [lastPendingRef, setLastPendingRef] = useState<typeof pending>(null);

  const kindLabel = pending ? (KIND_LABELS[pending.kind] ?? 'elemento') : '';

  // Cuando llega un nuevo `pending` (identidad del objeto cambia entre
  // requests), reseteamos el estado del formulario derivado de él. Usamos
  // el patrón "ajustar estado durante render" — más performante que un
  // useEffect, y no causa renders en cascada.
  if (pending !== lastPendingRef) {
    setLastPendingRef(pending);
    if (pending) {
      const suggestion = pending.suggestion;
      const selectableCount = layers.filter((l) => l.id !== UNASSIGNED_LAYER_ID).length;
      setTab(selectableCount > 0 ? 'existing' : 'create');
      setName(suggestion?.name ?? (KIND_LABELS[pending.kind] ?? 'Nueva capa'));
      setColor(suggestion?.color ?? '#58a6ff');
      setFillColor(suggestion?.fillColor ?? suggestion?.color ?? '#58a6ff');
    }
  }

  const sorted = useMemo(() => {
    if (!pending) return [];
    return [...layers]
      .filter((l) => l.id !== UNASSIGNED_LAYER_ID)
      .sort((a, b) => {
        const aMatch = a.kind === pending.kind ? 0 : 1;
        const bMatch = b.kind === pending.kind ? 0 : 1;
        return aMatch - bMatch;
      });
  }, [layers, pending]);

  if (!pending) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    resolveWithNewLayer({ name: name.trim(), color, fillColor });
  };

  return (
    <Modal
      open={!!pending}
      onOpenChange={(o) => { if (!o) cancelPending(); }}
      title="Elegí o creá la capa destino"
      visuallyHiddenTitle
      width="min(440px, 90vw)"
    >
      <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--cad-text)', marginBottom: 4 }}>
        ¿A qué capa va este {kindLabel.toLowerCase()}?
      </h2>
      <p style={{ fontSize: '0.72rem', color: 'var(--cad-text-muted)', marginBottom: 12 }}>
        Toda entidad necesita una capa asignada — elegí una existente o creá una nueva.
      </p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--cad-border)' }}>
        <button
          type="button"
          onClick={() => setTab('existing')}
          style={{
            flex: 1, padding: '6px 4px', background: 'none', border: 'none',
            borderBottom: tab === 'existing' ? '2px solid var(--cad-accent)' : '2px solid transparent',
            color: tab === 'existing' ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
            fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Elegir existente {sorted.length > 0 ? `(${sorted.length})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setTab('create')}
          style={{
            flex: 1, padding: '6px 4px', background: 'none', border: 'none',
            borderBottom: tab === 'create' ? '2px solid var(--cad-accent)' : '2px solid transparent',
            color: tab === 'create' ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
            fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Crear nueva
        </button>
      </div>

      {tab === 'existing' ? (
        sorted.length === 0 ? (
          <p style={{ fontSize: '0.72rem', color: 'var(--cad-text-muted)', marginBottom: 12 }}>
            Todavía no hay ninguna capa creada — pasá a "Crear nueva".
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '46vh', overflowY: 'auto', marginBottom: 8 }}>
            {sorted.map((layer) => {
              const disabled = !!layer.locked;
              return (
                <button
                  key={layer.id}
                  onClick={() => { if (!disabled) resolveWithExisting(layer.id); }}
                  disabled={disabled}
                  title={disabled ? 'Capa bloqueada — desbloqueala desde el panel de Capas para poder usarla' : undefined}
                  className="cad-icon-btn"
                  style={{
                    width: '100%', height: 'auto', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
                    justifyContent: 'flex-start', background: 'var(--cad-bg-surface)', border: '1px solid var(--cad-border)',
                    borderRadius: 6, color: 'var(--cad-text)', textAlign: 'left', flexWrap: 'wrap',
                    opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: layer.fillColor ?? layer.color, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{layer.name}</span>
                  {disabled ? (
                    <span style={{ fontSize: '0.6rem', color: 'var(--cad-accent-red)', border: '1px solid var(--cad-accent-red)', borderRadius: 3, padding: '0 5px' }}>
                      🔒 bloqueada
                    </span>
                  ) : layer.kind === pending.kind ? (
                    <span style={{ fontSize: '0.6rem', color: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 3, padding: '0 5px' }}>
                      sugerida
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.6rem', color: 'var(--cad-accent-amber)', border: '1px solid var(--cad-accent-amber)', borderRadius: 3, padding: '0 5px' }}>
                      tipo distinto
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )
      ) : (
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Nombre
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="cad-input"
              placeholder={`Nombre de la capa de ${kindLabel.toLowerCase()}`}
            />
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              Color de contorno
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                style={{ width: '100%', height: 30, background: 'none', border: '1px solid var(--cad-border)', borderRadius: 4, cursor: 'pointer' }} />
            </label>
            <label style={{ fontSize: '0.7rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              Color de relleno
              <input type="color" value={fillColor} onChange={(e) => setFillColor(e.target.value)}
                style={{ width: '100%', height: 30, background: 'none', border: '1px solid var(--cad-border)', borderRadius: 4, cursor: 'pointer' }} />
            </label>
          </div>
          <button
            type="submit"
            className="cad-icon-btn"
            style={{ height: 32, fontSize: '0.75rem', fontWeight: 600, color: '#0d1117', background: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 6 }}
          >
            Crear capa y usarla
          </button>
        </form>
      )}

      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => cancelPending()}
          className="cad-icon-btn"
          style={{ width: 'auto', height: 'auto', padding: '7px 12px', fontSize: '0.72rem', color: 'var(--cad-accent-red)', border: '1px solid var(--cad-border)', borderRadius: 6 }}
        >
          Cancelar (no crear esta entidad)
        </button>
      </div>
    </Modal>
  );
}