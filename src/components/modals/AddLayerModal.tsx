import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import type { LayerKind } from '../../core/objectModel';
import { useLayersStore } from '../../store/entities/layersRegistryStore';

const KIND_OPTIONS: { value: LayerKind; label: string }[] = [
  { value: 'lote', label: 'Lotes / parcelas' },
  { value: 'manzana', label: 'Manzanos' },
  { value: 'calle', label: 'Vías' },
  { value: 'equipamiento', label: 'Equipamientos' },
  { value: 'area_verde', label: 'Áreas verdes' },
  { value: 'linea', label: 'Líneas' },
  { value: 'texto', label: 'Textos' },
  { value: 'cota', label: 'Acotaciones' },
];

export interface AddLayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AddLayerModal({ open, onOpenChange }: AddLayerModalProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LayerKind>('lote');
  const [color, setColor] = useState('#58a6ff');
  const [fillColor, setFillColor] = useState('#58a6ff');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = `layer-${Date.now().toString(36)}`;
    useLayersStore.getState().add({
      id, name: name.trim(), kind,
      color, fillColor,
      visible: true, locked: false, opacity: 1,
      showLabel: true, showCota: true,
      colorMode: kind === 'manzana' ? 'colorIdx' : 'solid',
    });
    setName('');
    setKind('lote');
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Nueva capa" visuallyHiddenTitle>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--cad-text)', marginBottom: 4 }}>
          Nueva capa
        </h2>

        <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          Nombre
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="cad-input"
            placeholder="Nombre de la capa"
            style={{ width: '100%' }}
          />
        </label>

        <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          Tipo de geometría
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as LayerKind)}
            className="cad-input"
            style={{ width: '100%' }}
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            Color de contorno
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: '100%', height: 32, background: 'none', border: '1px solid var(--cad-border)', borderRadius: 4, cursor: 'pointer' }}
            />
          </label>
          <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            Color de relleno
            <input
              type="color"
              value={fillColor}
              onChange={(e) => setFillColor(e.target.value)}
              style={{ width: '100%', height: 32, background: 'none', border: '1px solid var(--cad-border)', borderRadius: 4, cursor: 'pointer' }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="cad-icon-btn"
            style={{ height: 30, padding: '0 12px', fontSize: '0.72rem', color: 'var(--cad-text-dim)', border: '1px solid var(--cad-border)', borderRadius: 6 }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="cad-icon-btn"
            style={{ height: 30, padding: '0 12px', fontSize: '0.72rem', color: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 6 }}
          >
            Crear capa
          </button>
        </div>
      </form>
    </Modal>
  );
}
