import React, { useRef, useState } from 'react';
import { Layers, Hexagon, Slash, Plus, X, Palette, Check } from 'lucide-react';
import { Modal } from '@shared-ui/Modal';
import type { LayerKind } from '@kernel/domain-model/featureModel';
import { runCommand } from '@kernel/command/CommandStack';
import { AddLayerCommand } from '@layers-engine/commands/AddLayerCommand';
import { newId } from '@kernel/id/id';

const KIND_OPTIONS: {
  value: LayerKind;
  label: string;
  desc: string;
  accent: string;
  icon: React.ReactNode;
}[] = [
  {
    value: 'lote',
    label: 'Polígono',
    desc: 'Áreas, predios o envolventes cerradas',
    accent: '#34D399',
    icon: <Hexagon size={16} color="#34D399" fill="rgba(52, 211, 153, 0.2)" />,
  },
  {
    value: 'linea',
    label: 'Línea',
    desc: 'Ejes, linderos o trazos lineales',
    accent: '#FBBF24',
    icon: <Slash size={16} color="#FBBF24" strokeWidth={2.4} />,
  },
];

const PRESET_COLORS = [
  '#FF6B4A',
  '#34D399',
  '#38BDF8',
  '#A78BFA',
  '#FBBF24',
  '#FB7185',
  '#2DD4BF',
  '#818CF8',
  '#F472B6',
  '#A3E635',
];

export interface AddLayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AddLayerModal({ open, onOpenChange }: AddLayerModalProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LayerKind>('lote');
  const [color, setColor] = useState('#38BDF8');
  const colorInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = newId('layer');
    void runCommand(
      new AddLayerCommand({
        id,
        name: name.trim(),
        kind,
        color,
        visible: true,
        locked: false,
        opacity: 1,
        showLabel: false,
        showCota: false,
      }),
    );
    setName('');
    setKind('lote');
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Nueva capa"
      visuallyHiddenTitle
      width="min(440px, 92vw)"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* ─── Header ─── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'var(--ui-10-gradient-soft)',
                border: '1px solid rgba(255, 107, 74, 0.38)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 4px 14px rgba(255, 107, 74, 0.18)',
              }}
            >
              <Layers size={18} color="#FF6B4A" />
            </div>
            <div>
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.96rem',
                  fontWeight: 700,
                  color: 'var(--cad-text)',
                  lineHeight: 1.2,
                }}
              >
                Nueva capa
              </h2>
              <p style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)', marginTop: 2 }}>
                Configurá la geometría e identidad visual en el lienzo
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="cad-panel-header-close"
            aria-label="Cerrar modal"
            title="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── Live Layer Preview Bar ─── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(10, 11, 15, 0.75)',
            border: '1px solid var(--cad-border)',
            borderLeft: `3px solid ${color}`,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: color,
              border: '1.5px solid rgba(255,255,255,0.3)',
              boxShadow: `0 0 10px ${color}66`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              flex: 1,
              fontSize: '0.76rem',
              fontWeight: 600,
              color: name.trim() ? 'var(--cad-text)' : 'var(--cad-text-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {name.trim() || 'Vista previa de la capa…'}
          </span>
          <span
            style={{
              fontSize: '0.58rem',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '2px 7px',
              borderRadius: 999,
              background: 'var(--cad-bg-surface)',
              border: '1px solid var(--cad-border)',
              color: 'var(--cad-text-dim)',
            }}
          >
            {kind === 'lote' ? 'Polígono' : 'Línea'}
          </span>
        </div>

        {/* ─── Layer Name ─── */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.66rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--cad-text-dim)',
            }}
          >
            Nombre de la capa
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="cad-input"
            placeholder="Ej. Equipamiento Urbano, Áreas Verdes, Red Eléctrica…"
            style={{
              width: '100%',
              padding: '8px 11px',
              fontSize: '0.78rem',
              fontFamily: 'var(--font-sans)',
              borderRadius: 8,
            }}
          />
        </label>

        {/* ─── Geometry Type Selector Cards ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.66rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--cad-text-dim)',
            }}
          >
            Tipo de geometría
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {KIND_OPTIONS.map((opt) => {
              const selected = kind === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setKind(opt.value)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 9,
                    padding: '10px 11px',
                    borderRadius: 10,
                    textAlign: 'left',
                    cursor: 'pointer',
                    background: selected ? 'var(--ui-10-gradient-soft)' : 'var(--cad-bg-surface)',
                    border: `1px solid ${selected ? opt.accent : 'var(--cad-border)'}`,
                    boxShadow: selected ? `0 4px 14px ${opt.accent}22` : 'none',
                    transition: 'all 150ms ease',
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: 'rgba(10, 11, 15, 0.55)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    {opt.icon}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        color: selected ? '#FFFFFF' : 'var(--cad-text)',
                      }}
                    >
                      {opt.label}
                    </div>
                    <div
                      style={{
                        fontSize: '0.62rem',
                        color: 'var(--cad-text-muted)',
                        lineHeight: 1.3,
                        marginTop: 2,
                      }}
                    >
                      {opt.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Layer Color Swatches + Custom Picker ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '0.66rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--cad-text-dim)',
              }}
            >
              Color de capa (contorno)
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.64rem',
                color: 'var(--cad-text-dim)',
              }}
            >
              {color.toUpperCase()}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              padding: '8px 10px',
              borderRadius: 10,
              background: 'var(--cad-bg-surface)',
              border: '1px solid var(--cad-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((swatch) => {
                const isSelected = color.toLowerCase() === swatch.toLowerCase();
                return (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setColor(swatch)}
                    title={`Color ${swatch}`}
                    aria-label={`Seleccionar color ${swatch}`}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: swatch,
                      border: isSelected ? '2px solid #FFFFFF' : '1.5px solid rgba(255,255,255,0.2)',
                      boxShadow: isSelected ? `0 0 10px ${swatch}` : 'none',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'transform 120ms ease, box-shadow 120ms ease',
                      transform: isSelected ? 'scale(1.12)' : 'scale(1)',
                    }}
                  >
                    {isSelected && <Check size={12} color="#0A0B0F" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => colorInputRef.current?.click()}
              className="cad-btn-secondary"
              style={{ padding: '5px 9px', fontSize: '0.65rem', borderRadius: 7 }}
              title="Elegir color personalizado"
            >
              <Palette size={13} color={color} />
              <span>Otro…</span>
            </button>
            <input
              ref={colorInputRef}
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>
        </div>

        {/* ─── Footer Actions ─── */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            paddingTop: 10,
            borderTop: '1px solid var(--cad-border)',
          }}
        >
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="cad-btn-secondary"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="cad-btn-primary"
          >
            <Plus size={14} />
            <span>Crear capa</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
