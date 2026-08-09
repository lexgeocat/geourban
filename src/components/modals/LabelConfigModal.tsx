import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useLabelConfigModalStore, type LabelNumberingMode } from '../../store/ui/labelConfigModalStore';
import {
  AREA_UNIT_OPTIONS,
  LABEL_FONT_OPTIONS,
  defaultLabelStyleConfig,
  type LabelStyleConfig,
  type AreaUnit,
} from '../../core/labelModel';
import { runCommand } from '../../commands/core/CommandStack';
import { ApplyLabelConfigCommand } from '../../commands/labels/ApplyLabelConfigCommand';
import { ApplyEntityLabelConfigCommand } from '../../commands/labels/ApplyEntityLabelConfigCommand';
import { AssignLotsLabelConfigCommand } from '../../commands/labels/AssignLotsLabelConfigCommand';
import { useDrawStore } from '../../store/map/drawStore';

const ENTITY_COPY: Record<'street' | 'roundabout', { title: string; nameHint: string; metricLabel: string; secondaryLabel: string }> = {
  street: {
    title: 'Generar etiqueta de vía',
    nameHint: 'Ej. Av. Principal',
    metricLabel: 'Mostrar longitud',
    secondaryLabel: 'Mostrar ancho de calzada',
  },
  roundabout: {
    title: 'Generar etiqueta de rotonda',
    nameHint: 'Ej. Rotonda Central',
    metricLabel: 'Mostrar área de calzada',
    secondaryLabel: 'Mostrar radio',
  },
};

export default function LabelConfigModal() {
  const open = useLabelConfigModalStore((s) => s.open);
  const target = useLabelConfigModalStore((s) => s.target);
  const initialConfig = useLabelConfigModalStore((s) => s.initialConfig);
  const initialText = useLabelConfigModalStore((s) => s.initialText);
  const numberingMode = useLabelConfigModalStore((s) => s.numberingMode);
  const setNumberingMode = useLabelConfigModalStore((s) => s.setNumberingMode);
  const setLastManzanoConfig = useLabelConfigModalStore((s) => s.setLastManzanoConfig);
  const setLastLotsConfig = useLabelConfigModalStore((s) => s.setLastLotsConfig);
  const close = useLabelConfigModalStore((s) => s.close);

  const [cfg, setCfg] = useState<LabelStyleConfig>(defaultLabelStyleConfig());
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) return;
    setCfg(initialConfig ?? defaultLabelStyleConfig());
    setName(initialText ?? '');
  }, [open, initialConfig, initialText]);

  if (!target) return null;
  const isBatch = target.kind === 'batch-manzanos';
  const isBatchLots = target.kind === 'batch-lots';
  const isEntity = target.kind === 'entity';
  const entityCopy = isEntity ? ENTITY_COPY[target.entityType] : null;

  const patch = (p: Partial<LabelStyleConfig>) => setCfg((c) => ({ ...c, ...p }));

  const handleApplyOnly = () => {
    if (target.kind === 'feature') {
      void runCommand(new ApplyLabelConfigCommand(target.featureId, cfg, name));
      close();
      return;
    }
    if (target.kind === 'entity') {
      void runCommand(new ApplyEntityLabelConfigCommand(target.entityId, cfg, name));
      close();
      return;
    }
    if (target.kind === 'batch-lots') {
      void runCommand(new AssignLotsLabelConfigCommand(cfg, { manzanoId: target.manzanoId }));
      setLastLotsConfig(cfg);
      close();
      return;
    }
    setLastManzanoConfig(cfg);
    close();
  };

  const handleTraceOrder = () => {
    setLastManzanoConfig(cfg);
    close();
    useDrawStore.getState().setMode('labelOrder');
  };

  const title = isBatch
    ? 'Etiquetado de manzanos'
    : isBatchLots
      ? 'Etiquetado de lotes'
      : entityCopy
        ? entityCopy.title
        : 'Generar etiqueta';

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) close(); }}
      title="Configurar etiqueta"
      visuallyHiddenTitle
      width="min(460px, 92vw)"
    >
      <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--cad-text)', marginBottom: 12 }}>
        {title}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
        {!isBatch && !isBatchLots && (
          <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Nombre
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="cad-input"
              placeholder={entityCopy?.nameHint ?? 'Ej. Lote 12'}
            />
          </label>
        )}

        <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          Prefijo {isBatch ? '(se combina con la letra/número de orden)' : ''}
          <input value={cfg.prefix} onChange={(e) => patch({ prefix: e.target.value })} className="cad-input" placeholder="Ej. Mzo., Lote, Calle" />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--cad-text)' }}>
          <input type="checkbox" className="cad-toggle" checked={cfg.showPrefix} onChange={(e) => patch({ showPrefix: e.target.checked })} />
          Mostrar prefijo
        </label>

        {isBatch && (
          <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Numeración del trazado
            <select value={numberingMode} onChange={(e) => setNumberingMode(e.target.value as LabelNumberingMode)} className="cad-input">
              <option value="alpha">Alfabética (A, B, C…)</option>
              <option value="numeric">Numérica (1, 2, 3…)</option>
            </select>
          </label>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {(!isEntity || target.entityType === 'roundabout') && (
            <label style={{ flex: 1, fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              Unidad de superficie
              <select value={cfg.unit} onChange={(e) => patch({ unit: e.target.value as AreaUnit })} className="cad-input">
                {AREA_UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          <label style={{ flex: 1, fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Fuente
            <select value={cfg.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })} className="cad-input">
              {LABEL_FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--cad-text)' }}>
            <input type="checkbox" className="cad-toggle" checked={cfg.showArea} onChange={(e) => patch({ showArea: e.target.checked })} />
            {entityCopy?.metricLabel ?? 'Mostrar área'}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--cad-text)' }}>
            <input type="checkbox" className="cad-toggle" checked={cfg.showPerimeter} onChange={(e) => patch({ showPerimeter: e.target.checked })} />
            {entityCopy?.secondaryLabel ?? 'Mostrar perímetro'}
          </label>
        </div>

        {!isEntity && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--cad-text)' }}>
            <input type="checkbox" className="cad-toggle" checked={cfg.showEdgeCotas} onChange={(e) => patch({ showEdgeCotas: e.target.checked })} />
            Mostrar cotas por lado (dimensión de cada arista)
          </label>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1, fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Tamaño de etiqueta (px)
            <input type="number" min={7} max={40} value={cfg.labelFontSizePx}
              onChange={(e) => patch({ labelFontSizePx: Math.max(7, parseInt(e.target.value, 10) || cfg.labelFontSizePx) })} className="cad-input" />
          </label>
          <label style={{ flex: 1, fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Tamaño de cotas (px)
            <input type="number" min={6} max={30} value={cfg.cotaFontSizePx}
              onChange={(e) => patch({ cotaFontSizePx: Math.max(6, parseInt(e.target.value, 10) || cfg.cotaFontSizePx) })} className="cad-input" />
          </label>
        </div>

        <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          Color
          <input type="color" value={cfg.color} onChange={(e) => patch({ color: e.target.value })}
            style={{ width: '100%', height: 32, background: 'none', border: '1px solid var(--cad-border)', borderRadius: 4, cursor: 'pointer' }} />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--cad-text)' }}>
          <input type="checkbox" className="cad-toggle" checked={cfg.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
          Etiqueta habilitada (visible en el mapa)
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={close} className="cad-icon-btn" style={{ width: 'auto', height: 'auto', padding: '7px 12px', fontSize: '0.72rem', color: 'var(--cad-text-dim)', border: '1px solid var(--cad-border)', borderRadius: 6 }}>
          Cancelar
        </button>
        <button onClick={handleApplyOnly} className="cad-icon-btn" style={{ width: 'auto', height: 'auto', padding: '7px 14px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 6 }}>
          {isBatch ? 'Guardar estilo' : isBatchLots ? 'Aplicar a lotes' : 'Aplicar'}
        </button>
        {isBatch && (
          <button onClick={handleTraceOrder} className="cad-icon-btn" style={{ width: 'auto', height: 'auto', padding: '7px 14px', fontSize: '0.72rem', fontWeight: 700, color: '#0d1117', background: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 6 }}>
            ▶ Trazar orden de etiquetado…
          </button>
        )}
      </div>
    </Modal>
  );
}