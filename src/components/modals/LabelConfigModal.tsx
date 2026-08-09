import React, { useEffect, useMemo, useState } from 'react';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Modal } from '../ui/Modal';
import {
  useLabelConfigModalStore,
  type LabelNumberingMode,
  type LabelConfigTarget,
} from '../../store/ui/labelConfigModalStore';
import {
  AREA_UNIT_OPTIONS,
  LABEL_FONT_OPTIONS,
  LABEL_FONT_GROUPS,
  defaultLabelStyleConfig,
  composeLabelLines,
  type LabelStyleConfig,
  type AreaUnit,
  type LabelLineMetrics,
} from '../../core/labelModel';
import { formatOrderLabel, LABEL_NUMBERING_MODES } from '../../core/labelNumbering';
import { runCommand } from '../../commands/core/CommandStack';
import { ApplyLabelConfigCommand } from '../../commands/labels/ApplyLabelConfigCommand';
import { ApplyEntityLabelConfigCommand } from '../../commands/labels/ApplyEntityLabelConfigCommand';
import { AssignLotsLabelConfigCommand } from '../../commands/labels/AssignLotsLabelConfigCommand';
import { RestyleBatchLabelsCommand } from '../../commands/labels/RestyleBatchLabelsCommand';
import { useDrawStore } from '../../store/map/drawStore';
import { useMapStore } from '../../store/map/mapStore';
import { useStreetStore } from '../../store/entities/streetStore';
import { useRoundaboutStore } from '../../store/entities/roundaboutStore';
import { toast } from '../../store/ui/toastStore';
import { formatMetricLength, streetLengthMetricM } from '../../geo/metrics';
import { roundaboutRoadAreaM2 } from '../../geo/roundabout/roundaboutEngine';
import { getFeatureKind } from '../../core/objectModel';

const ENTITY_COPY: Record<'street' | 'roundabout', { title: string; nameHint: string; metricLabel: string; secondaryLabel: string }> = {
  street: {
    title: 'Generar etiqueta de vía',
    nameHint: 'Ej. Av. Principal',
    metricLabel: 'Longitud',
    secondaryLabel: 'Ancho de calzada',
  },
  roundabout: {
    title: 'Generar etiqueta de rotonda',
    nameHint: 'Ej. Rotonda Central',
    metricLabel: 'Área de calzada',
    secondaryLabel: 'Radio',
  },
};

/* ─────────── Sub-componentes compactos (compartidos por todos los campos) ─────────── */

function Field({
  label, children, style,
}: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ fontSize: '0.65rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 3, ...style }}>
      {label}
      {children}
    </label>
  );
}

function ToggleRow({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.68rem', color: 'var(--cad-text)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <input type="checkbox" className="cad-toggle" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Previsualización en vivo — replica el look real del `LabelPainter` (fondo oscuro + texto en negrita). */
function LabelPreview({ cfg, lines }: { cfg: LabelStyleConfig; lines: string[] }) {
  const previewFontSize = Math.min(Math.max(cfg.labelFontSizePx, 9), 22);
  const previewFontWeight = cfg.bold === false ? 500 : 700;
  return (
    <div
      style={{
        background: 'var(--cad-bg-deepest)',
        border: '1px solid var(--cad-border)',
        borderRadius: 6,
        padding: '10px 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        minHeight: 50,
      }}
    >
      {cfg.enabled && lines.length > 0 ? (
        <div
          style={{
            background: 'rgba(13, 17, 23, 0.72)',
            padding: '3px 7px',
            borderRadius: 3,
            textAlign: 'center',
            fontFamily: cfg.fontFamily,
            lineHeight: 1.3,
          }}
        >
          {lines.map((line, i) => (
            <div key={i} style={{ fontSize: previewFontSize, fontWeight: previewFontWeight, color: cfg.color, whiteSpace: 'nowrap' }}>
              {line}
            </div>
          ))}
        </div>
      ) : (
        <span style={{ fontSize: '0.62rem', color: 'var(--cad-text-muted)', fontStyle: 'italic' }}>
          {cfg.enabled ? 'Sin datos para previsualizar' : 'Etiqueta deshabilitada'}
        </span>
      )}
      {cfg.showEdgeCotas && (
        <span style={{ fontSize: '0.56rem', color: 'var(--cad-text-muted)' }}>+ cotas por lado en el mapa</span>
      )}
      <span style={{ fontSize: '0.54rem', color: 'var(--cad-text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        Vista previa
      </span>
    </div>
  );
}

/** Busca una feature real (manzano/lote) para que el preview de un batch use métricas reales cuando existen. */
function findSampleFeatureMetrics(
  kind: 'manzana' | 'lote',
  scopeManzanoId?: string | number,
): { primaryValue?: number; secondaryValue?: number } | null {
  const src = useMapStore.getState().drawSource;
  if (!src) return null;
  let found: { primaryValue?: number; secondaryValue?: number } | null = null;
  src.forEachFeature((f) => {
    if (found) return;
    const feat = f as Feature<Geometry>;
    if (getFeatureKind(feat) !== kind) return;
    if (kind === 'lote' && scopeManzanoId != null && feat.get('lotGroupId') !== String(scopeManzanoId)) return;
    found = {
      primaryValue: feat.get('areaM2') as number | undefined,
      secondaryValue: feat.get('perimeterM') as number | undefined,
    };
  });
  return found;
}

/** Resuelve las métricas a mostrar en el preview según el tipo de target (real cuando existe, ilustrativa si no). */
function computePreviewMetrics(target: LabelConfigTarget | null, numberingMode: LabelNumberingMode): LabelLineMetrics {
  if (!target) return { text: 'Etiqueta' };

  if (target.kind === 'feature') {
    const src = useMapStore.getState().drawSource;
    const f = src?.getFeatureById(target.featureId) as Feature<Geometry> | null;
    if (f) {
      return {
        text: (f.get('label') as string | undefined) ?? '',
        primaryValue: f.get('areaM2') as number | undefined,
        secondaryValue: f.get('perimeterM') as number | undefined,
      };
    }
    return { text: 'Elemento' };
  }

  if (target.kind === 'entity') {
    if (target.entityType === 'street') {
      const s = useStreetStore.getState().streets.find((x) => x.id === target.entityId);
      if (s) {
        return {
          text: s.name,
          primaryValue: streetLengthMetricM(s),
          primaryFormatter: (v) => formatMetricLength(v),
          secondaryLabel: 'Calzada',
          secondaryValue: s.widthM,
        };
      }
    } else {
      const r = useRoundaboutStore.getState().roundabouts.find((x) => x.id === target.entityId);
      if (r) {
        return {
          text: r.name,
          primaryValue: roundaboutRoadAreaM2(r),
          secondaryLabel: 'Radio',
          secondaryValue: r.radiusM,
        };
      }
    }
    return { text: 'Elemento' };
  }

 const isLotsTarget = target.kind === 'batch-lots';
  const orderSample = formatOrderLabel(numberingMode, 0, 8, isLotsTarget ? 'A' : undefined);
  if (target.kind === 'batch-manzanos') {
    const sample = findSampleFeatureMetrics('manzana');
    return { text: orderSample, primaryValue: sample?.primaryValue ?? 480, secondaryValue: sample?.secondaryValue ?? 92 };
  }
  const sample = findSampleFeatureMetrics('lote', target.manzanoId);
  return { text: orderSample, primaryValue: sample?.primaryValue ?? 180, secondaryValue: sample?.secondaryValue ?? 54 };
}

/* ─────────── Modal principal ─────────── */

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

  const isBatch = target?.kind === 'batch-manzanos';
  const isBatchLots = target?.kind === 'batch-lots';
  const isEntity = target?.kind === 'entity';
  const entityCopy = target && target.kind === 'entity' ? ENTITY_COPY[target.entityType] : null;

  const previewMetrics = useMemo(() => computePreviewMetrics(target, numberingMode), [target, numberingMode]);
  const previewText = isBatch || isBatchLots ? (previewMetrics.text ?? '') : (name.trim() || previewMetrics.text || 'Etiqueta');
  const previewLines = useMemo(
    () => composeLabelLines(cfg, { ...previewMetrics, text: previewText }),
    [cfg, previewMetrics, previewText],
  );

  if (!target) return null;

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
      void runCommand(new AssignLotsLabelConfigCommand(cfg, { manzanoId: target.manzanoId, numbering: numberingMode }));
      setLastLotsConfig(cfg);
      close();
      return;
    }
    setLastManzanoConfig(cfg);
    close();
  };

  const handleRestyleOnly = () => {
  if (target.kind !== 'batch-manzanos' && target.kind !== 'batch-lots') return;
  const kind = target.kind === 'batch-manzanos' ? 'manzana' : 'lote';
  const manzanoId = target.kind === 'batch-lots' ? target.manzanoId : undefined;
  const cmd = new RestyleBatchLabelsCommand({ kind, manzanoId, config: cfg });
  void runCommand(cmd).then((result) => {
    if (!result.ok) return;
    if (cmd.affectedCount === 0) {
      toast('No hay elementos etiquetados todavía — usá "Trazar orden…" o "Aplicar" primero.', {
        variant: 'warning',
        durationMs: 6000,
      });
    } else {
      toast(`Estilo actualizado en ${cmd.affectedCount} elemento(s).`, { variant: 'success' });
    }
  });
  if (target.kind === 'batch-manzanos') setLastManzanoConfig(cfg);
  else setLastLotsConfig(cfg);
  close();
};

  const handleTraceOrder = () => {
    if (target.kind === 'batch-manzanos') {
      setLastManzanoConfig(cfg);
      useLabelConfigModalStore.getState().startOrderTrace({ kind: 'manzana', config: cfg, numbering: numberingMode });
    } else if (target.kind === 'batch-lots') {
      setLastLotsConfig(cfg);
      useLabelConfigModalStore.getState().startOrderTrace({
        kind: 'lote',
        scopeManzanoId: target.manzanoId,
        config: cfg,
        numbering: numberingMode,
      });
    } else {
      return;
    }
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

  let subtitle: string | null = null;
  if (target.kind === 'batch-lots') {
    subtitle = target.manzanoId != null ? 'Lotes del manzano seleccionado' : 'Todos los lotes del proyecto';
  } else if (target.kind === 'batch-manzanos') {
    subtitle = 'Todos los manzanos trazados';
  }

  const primaryLabel = isBatch ? 'Guardar estilo' : isBatchLots ? 'Aplicar automático' : 'Aplicar';
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) close(); }}
      title="Configurar etiqueta"
      visuallyHiddenTitle
      width="min(400px, 92vw)"
    >
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--cad-text)' }}>{title}</h2>
        {subtitle && (
          <p style={{ fontSize: '0.62rem', color: 'var(--cad-text-muted)', marginTop: 1 }}>{subtitle}</p>
        )}
      </div>

      <LabelPreview cfg={cfg} lines={previewLines} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '48vh', overflowY: 'auto', paddingRight: 4, marginTop: 10 }}>
        {!isBatch && !isBatchLots && (
          <Field label="Nombre">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="cad-input"
              placeholder={entityCopy?.nameHint ?? 'Ej. Lote 12'}
            />
          </Field>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Field label={`Prefijo${isBatch || isBatchLots ? ' (+ letra/número de orden)' : ''}`} style={{ flex: 1 }}>
            <input value={cfg.prefix} onChange={(e) => patch({ prefix: e.target.value })} className="cad-input" placeholder="Ej. Mzo., Lote, Calle" />
          </Field>
          <ToggleRow label="Mostrar" checked={cfg.showPrefix} onChange={(v) => patch({ showPrefix: v })} />
        </div>

        {(isBatch || isBatchLots) && (
          <Field label="Numeración del trazado">
            <select value={numberingMode} onChange={(e) => setNumberingMode(e.target.value as LabelNumberingMode)} className="cad-input">
              {LABEL_NUMBERING_MODES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} — {m.example}
                  {m.needsParent && isBatch ? ' (usa código de manzano; sin efecto acá)' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {(!isEntity || (target.kind === 'entity' && target.entityType === 'roundabout')) && (
          <Field label="Unidad" style={{ flex: 1 }}>
              <select value={cfg.unit} onChange={(e) => patch({ unit: e.target.value as AreaUnit })} className="cad-input">
                {AREA_UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          )}
          <Field label="Fuente" style={{ flex: 1 }}>
            <select value={cfg.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })} className="cad-input">
              {LABEL_FONT_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {LABEL_FONT_OPTIONS.filter((o) => o.group === group).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>
        <ToggleRow label="Negrita" checked={cfg.bold !== false} onChange={(v) => patch({ bold: v })} />

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <ToggleRow label={entityCopy?.metricLabel ?? 'Área'} checked={cfg.showArea} onChange={(v) => patch({ showArea: v })} />
          <ToggleRow label={entityCopy?.secondaryLabel ?? 'Perímetro'} checked={cfg.showPerimeter} onChange={(v) => patch({ showPerimeter: v })} />
          {!isEntity && (
            <ToggleRow label="Cotas por lado" checked={cfg.showEdgeCotas} onChange={(v) => patch({ showEdgeCotas: v })} />
          )}
        </div>

        {!isEntity && (
          <div
            style={{
              display: 'flex', gap: 8,
              opacity: cfg.showEdgeCotas ? 1 : 0.4,
              pointerEvents: cfg.showEdgeCotas ? 'auto' : 'none',
            }}
          >
            <Field label="Estilo de cota" style={{ flex: 1 }}>
              <select
                value={cfg.cotaStyle ?? 'lines'}
                onChange={(e) => patch({ cotaStyle: e.target.value as LabelStyleConfig['cotaStyle'] })}
                className="cad-input"
              >
                <option value="lines">Con líneas de cota</option>
                <option value="text">Solo texto (sin líneas)</option>
             </select>
            </Field>
            <Field label="Posición" style={{ flex: 1 }}>
              <select
                value={cfg.cotaPosition ?? 'external'}
                onChange={(e) => patch({ cotaPosition: e.target.value as LabelStyleConfig['cotaPosition'] })}
                className="cad-input"
              >
                <option value="external">Externa (hacia afuera)</option>
                <option value="internal">Interna (hacia el centro)</option>
              </select>
            </Field>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Field label="Tam. etiqueta (px)" style={{ flex: 1 }}>
            <input type="number" min={7} max={40} value={cfg.labelFontSizePx}
              onChange={(e) => patch({ labelFontSizePx: Math.max(7, parseInt(e.target.value, 10) || cfg.labelFontSizePx) })} className="cad-input" />
          </Field>
          <Field label="Tam. cotas (px)" style={{ flex: 1 }}>
            <input type="number" min={6} max={30} value={cfg.cotaFontSizePx}
              onChange={(e) => patch({ cotaFontSizePx: Math.max(6, parseInt(e.target.value, 10) || cfg.cotaFontSizePx) })} className="cad-input" />
          </Field>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Field label="Color" style={{ flexShrink: 0 }}>
            <input
              type="color"
              value={cfg.color}
              onChange={(e) => patch({ color: e.target.value })}
              style={{ width: 46, height: 26, background: 'none', border: '1px solid var(--cad-border)', borderRadius: 4, cursor: 'pointer', padding: 0 }}
            />
          </Field>
          <div style={{ flex: 1 }} />
          <ToggleRow label="Habilitada" checked={cfg.enabled} onChange={(v) => patch({ enabled: v })} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={close} className="cad-icon-btn" style={{ width: 'auto', height: 'auto', padding: '6px 10px', fontSize: '0.7rem', color: 'var(--cad-text-dim)', border: '1px solid var(--cad-border)', borderRadius: 6 }}>
          Cancelar
        </button>
        {(isBatch || isBatchLots) && (
          <button
            onClick={handleRestyleOnly}
            className="cad-icon-btn"
            title="Actualiza color, tamaño, fuente, prefijo, cotas, etc. de lo YA etiquetado — sin renumerar ni volver a trazar."
            style={{ width: 'auto', height: 'auto', padding: '6px 12px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--cad-text-dim)', border: '1px solid var(--cad-border)', borderRadius: 6 }}
          >
            🎨 Solo actualizar estilo
          </button>
        )}
        <button onClick={handleApplyOnly} className="cad-icon-btn" style={{ width: 'auto', height: 'auto', padding: '6px 12px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 6 }}>
          {primaryLabel}
        </button>
        {(isBatch || isBatchLots) && (
          <button onClick={handleTraceOrder} className="cad-icon-btn" style={{ width: 'auto', height: 'auto', padding: '6px 12px', fontSize: '0.7rem', fontWeight: 700, color: '#0d1117', background: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 6 }}>
            ▶ Trazar orden…
          </button>
        )}
      </div>
    </Modal>
  );
}