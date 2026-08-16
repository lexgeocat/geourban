import React, { useMemo, useState } from 'react';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Modal } from '@shared-ui/Modal';
import {
  useLabelConfigModalStore,
  type LabelNumberingMode,
  type LabelConfigTarget,
} from '../store/labelConfigModalStore';
import {
  AREA_UNIT_OPTIONS,
  LABEL_FONT_OPTIONS,
  LABEL_FONT_GROUPS,
  defaultLabelStyleConfig,
  composeLabelLines,
  type LabelStyleConfig,
  type AreaUnit,
  type LabelLineMetrics,
} from '../model/labelModel';
import { formatOrderLabel, LABEL_NUMBERING_MODES } from '../model/labelNumbering';
import { runCommand } from '@kernel/command/CommandStack';
import { ApplyLabelConfigCommand } from '../commands/ApplyLabelConfigCommand';
import { ApplyEntityLabelConfigCommand } from '../commands/ApplyEntityLabelConfigCommand';
import { AssignLotsLabelConfigCommand } from '../commands/AssignLotsLabelConfigCommand';
import { RestyleBatchLabelsCommand } from '../commands/RestyleBatchLabelsCommand';
import { UpsertLabelClassCommand } from '../commands/UpsertLabelClassCommand';
import { useDrawStore } from '@map-core/store/drawStore';
import { useMapStore } from '@map-core/store/mapStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { toast } from '@shared-ui/store/toastStore';
import { formatMetricLength, streetLengthMetricM } from '@georef-engine/metrics';
import { roundaboutRoadAreaM2 } from '@vias-engine/geometry/roundaboutEngine';
import { getFeatureKind } from '@kernel/domain-model/featureModel';
import { CAD_BG_DEEPEST_RGB } from '@kernel/theme/colors';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';

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
            background: `rgba(${CAD_BG_DEEPEST_RGB}, 0.72)`,
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

/** Cuenta cuántos elementos caen dentro del alcance del target — sirve para "congelar" botones sin efecto. */
function countBatchTargets(target: LabelConfigTarget | null): number {
  if (!target) return 0;
  const src = useMapStore.getState().drawSource;
  if (!src) return 0;
  let count = 0;
  if (target.kind === 'batch-manzanos') {
    src.forEachFeature((f) => {
      const feat = f as Feature<Geometry>;
      if (getFeatureKind(feat) !== 'manzana') return;
      if (target.layerId && feat.get('layerId') !== target.layerId) return;
      count++;
    });
  } else if (target.kind === 'batch-lots') {
    src.forEachFeature((f) => {
      const feat = f as Feature<Geometry>;
      if (getFeatureKind(feat) !== 'lote') return;
      if (target.manzanoId != null && feat.get('lotGroupId') !== String(target.manzanoId)) return;
      count++;
    });
  } else if (target.kind === 'batch-layer') {
    src.forEachFeature((f) => {
      if ((f as Feature<Geometry>).get('layerId') !== target.layerId) return;
      count++;
    });
  }
  return count;
}

/** Resuelve las métricas a mostrar en el preview según el tipo de target (real cuando existe, ilustrativa si no). */
function computePreviewMetrics(target: LabelConfigTarget | null, numberingMode: LabelNumberingMode): LabelLineMetrics {
  if (!target) return { text: 'Etiqueta' };

  if (target.kind === 'feature') {
    const src = useMapStore.getState().drawSource;
    const f = src?.getFeatureById(target.featureId) as Feature<Geometry> | null;
    if (f) {
      const text = (f.get('label') as string | undefined) ?? '';
      const areaM2 = f.get('areaM2') as number | undefined;
      if (areaM2 !== undefined) {
        return { text, primaryValue: areaM2, secondaryValue: f.get('perimeterM') as number | undefined };
      }
      // Línea/punto: no hay área/perímetro — se usa longitud (si existe) como métrica primaria.
      return {
        text,
        primaryValue: f.get('lengthM') as number | undefined,
        primaryFormatter: (v) => formatMetricLength(v),
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
  if (target.kind === 'batch-layer') {
    const orderSampleLayer = formatOrderLabel(numberingMode, 0, 8);
    const src = useMapStore.getState().drawSource;
    let sample: { primaryValue?: number; secondaryValue?: number; isLine?: boolean } | null = null;
    if (src) {
      for (const f of src.getFeatures()) {
        if (sample) break;
        if (f.get('layerId') !== target.layerId) continue;
        const areaM2 = f.get('areaM2') as number | undefined;
        sample =
          areaM2 !== undefined
            ? { primaryValue: areaM2, secondaryValue: f.get('perimeterM') as number | undefined }
            : { primaryValue: f.get('lengthM') as number | undefined, isLine: true };
      }
    }
    return {
      text: orderSampleLayer,
      primaryValue: sample?.primaryValue ?? 180,
      secondaryValue: sample?.isLine? undefined : (sample?.secondaryValue ?? 54),
    };
  }
  if (target.kind === 'batch-manzanos') {
    const sample = findSampleFeatureMetrics('manzana');
    return { text: orderSample, primaryValue: sample?.primaryValue ?? 480, secondaryValue: sample?.secondaryValue ?? 92 };
  }
  const sample = findSampleFeatureMetrics('lote', target.manzanoId);
  return { text: orderSample, primaryValue: sample?.primaryValue ?? 180, secondaryValue: sample?.secondaryValue ?? 54 };
}

function resolveTargetIsLineFeature(target: LabelConfigTarget | null): boolean {
  if (!target || target.kind !== 'feature') return false;
  const src = useMapStore.getState().drawSource;
  const f = src?.getFeatureById(target.featureId) as Feature<Geometry> | null;
  if (!f) return false;
  return f.get('areaM2') === undefined;
}

function snapshotOf(cfg: LabelStyleConfig, name: string): string {
  return `${JSON.stringify(cfg)}|${name}`;
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
  const [prevOpen, setPrevOpen] = useState(open);
  const [openedSnapshot, setOpenedSnapshot] = useState('');

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const initial = initialConfig ?? defaultLabelStyleConfig();
      const initialName = initialText ?? '';
      setCfg(initial);
      setName(initialName);
      setOpenedSnapshot(snapshotOf(initial, initialName));
    }
  }

  const isBatch = target?.kind === 'batch-manzanos';
  const isBatchLots = target?.kind === 'batch-lots';
  const isBatchLayer = target?.kind === 'batch-layer';
  const isAnyBatch = isBatch || isBatchLots || isBatchLayer;
  const isEntity = target?.kind === 'entity';
  const entityCopy = target && target.kind === 'entity' ? ENTITY_COPY[target.entityType] : null;
  const isLineFeature = useMemo(() => resolveTargetIsLineFeature(target), [target]);

  const previewMetrics = useMemo(() => computePreviewMetrics(target, numberingMode), [target, numberingMode]);
  const previewText = isBatch || isBatchLots ? (previewMetrics.text ?? '') : (name.trim() || previewMetrics.text || 'Etiqueta');
  const previewLines = useMemo(
    () => composeLabelLines(cfg, { ...previewMetrics, text: previewText }),
    [cfg, previewMetrics, previewText],
  );

  const targetCount = useMemo(() => countBatchTargets(target), [target]);
  const hasChanges = snapshotOf(cfg, name) !== openedSnapshot;

  if (!target) return null;

  const patch = (p: Partial<LabelStyleConfig>) => setCfg((c) => ({ ...c, ...p }));

  const handleSave = () => {
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

    const kind = target.kind === 'batch-manzanos' ? 'manzana' : target.kind === 'batch-lots' ? 'lote' : undefined;
    const manzanoId = target.kind === 'batch-lots' ? target.manzanoId : undefined;
    const layerId = target.layerId;
    const cmd = new RestyleBatchLabelsCommand({ kind, manzanoId, config: cfg, layerId });
    void runCommand(cmd).then((result) => {
      if (!result.ok) return;
      if (cmd.affectedCount > 0) {
        toast(`Estilo guardado y actualizado en ${cmd.affectedCount} elemento(s) ya etiquetados.`, { variant: 'success' });
      } else {
        toast('Estilo guardado. Se va a aplicar automáticamente a lo que etiquetes de acá en más.', { variant: 'info' });
      }
    });
    if (target.kind === 'batch-manzanos') setLastManzanoConfig(cfg);
    else if (target.kind === 'batch-lots') setLastLotsConfig(cfg);
    close();
  };

  /** Solo tiene sentido para lotes: numera y aplica automáticamente, reiniciando por manzano. */
  const handleApplyAuto = () => {
    if (target.kind !== 'batch-lots') return;
    void runCommand(new AssignLotsLabelConfigCommand(cfg, { manzanoId: target.manzanoId, numbering: numberingMode }));
    if (target.layerId) {
      void runCommand(
        new UpsertLabelClassCommand({
          layerId: target.layerId,
          style: cfg,
          numbering: { mode: numberingMode, restartPerParent: true },
          enabled: cfg.enabled,
          visibleMinZoom: cfg.visibleMinZoom,
          visibleMaxZoom: cfg.visibleMaxZoom,
          priority: cfg.priority,
        })
      );
    }
    setLastLotsConfig(cfg);
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
    } else if (target.kind === 'batch-layer') {
      useLabelConfigModalStore.getState().startOrderTrace({
        kind: 'layer',
        layerId: target.layerId,
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
      ? (target.manzanoId != null ? 'Etiquetado de lotes' : 'Etiquetado de lotes — todos los manzanos')
      : isBatchLayer
        ? 'Etiquetado de capa'
        : entityCopy
          ? entityCopy.title
          : 'Generar etiqueta';

  let subtitle: string | null = null;
  if (target.kind === 'batch-lots') {
    subtitle = target.manzanoId != null
      ? 'Lotes del manzano seleccionado.'
      : 'Todos los lotes del proyecto — la numeración reinicia automáticamente en cada manzano.';
  } else if (target.kind === 'batch-manzanos') {
    subtitle = 'Todos los manzanos trazados.';
  } else if (target.kind === 'batch-layer') {
    const layerName = useLayersStore.getState().getById(target.layerId)?.name;
    subtitle = layerName ? `Todos los elementos de "${layerName}"` : 'Todos los elementos de esta capa';
  }

  const showAutoApply = isBatchLots;
  const showTraceOrder = isAnyBatch && !(isBatchLots && target.manzanoId == null);

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
        {isAnyBatch && (
          <p style={{ fontSize: '0.58rem', color: 'var(--cad-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
            💾 <strong style={{ color: 'var(--cad-text-dim)' }}>Guardar</strong> aplica el estilo a lo nuevo y
            actualiza al toque lo que ya esté etiquetado — sin pasos extra.
          </p>
        )}
      </div>

      <LabelPreview cfg={cfg} lines={previewLines} />

      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '48vh', overflowY: 'auto',
          paddingRight: 4, marginTop: 10,
          opacity: cfg.enabled ? 1 : 0.55,
          transition: 'opacity 150ms ease',
        }}
      >
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
            <input value={cfg.prefix} onChange={(e) => patch({ prefix: e.target.value })} className="cad-input" placeholder="Ej. Mzo., Lote, Vía" />
          </Field>
          <ToggleRow label="Mostrar" checked={cfg.showPrefix} onChange={(v) => patch({ showPrefix: v })} />
        </div>

        {isAnyBatch && (
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

        {isAnyBatch && (
          <Field label="Prioridad (mayor gana en colisión)">
            <input
              type="number"
              step={1}
              value={cfg.priority ?? 0}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) patch({ priority: n });
              }}
              className="cad-input"
            />
          </Field>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {(!isEntity && !isLineFeature) || (target.kind === 'entity' && target.entityType === 'roundabout') ? (
            <Field label="Unidad" style={{ flex: 1 }}>
              <select value={cfg.unit} onChange={(e) => patch({ unit: e.target.value as AreaUnit })} className="cad-input">
                {AREA_UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          ) : null}
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
          <ToggleRow
            label={entityCopy?.metricLabel ?? (isLineFeature ? 'Longitud' : 'Área')}
            checked={cfg.showPrimaryMetric ?? cfg.showArea ?? false}
            onChange={(v) => patch({ showPrimaryMetric: v, showArea: v })}
          />
          {!isLineFeature && (
            <ToggleRow
              label={entityCopy?.secondaryLabel ?? 'Perímetro'}
              checked={cfg.showSecondaryMetric ?? cfg.showPerimeter ?? false}
              onChange={(v) => patch({ showSecondaryMetric: v, showPerimeter: v })}
            />
          )}
          {!isEntity && !isLineFeature && (
            <ToggleRow label="Cotas por lado" checked={cfg.showEdgeCotas} onChange={(v) => patch({ showEdgeCotas: v })} />
          )}
        </div>

        {!isEntity && !isLineFeature && (
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

        {isAnyBatch && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Field label="Zoom mín. (0-28)" style={{ flex: 1 }}>
              <input
                type="number"
                min={0}
                max={28}
                step={0.5}
                value={cfg.visibleMinZoom ?? ''}
                placeholder="sin mín."
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') patch({ visibleMinZoom: undefined });
                  else {
                    const n = Number(raw);
                    if (Number.isFinite(n)) patch({ visibleMinZoom: Math.max(0, Math.min(28, n)) });
                  }
                }}
                className="cad-input"
              />
            </Field>
            <Field label="Zoom máx. (0-28)" style={{ flex: 1 }}>
              <input
                type="number"
                min={0}
                max={28}
                step={0.5}
                value={cfg.visibleMaxZoom ?? ''}
                placeholder="sin máx."
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') patch({ visibleMaxZoom: undefined });
                  else {
                    const n = Number(raw);
                    if (Number.isFinite(n)) patch({ visibleMaxZoom: Math.max(0, Math.min(28, n)) });
                  }
                }}
                className="cad-input"
              />
            </Field>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Field label="Color" style={{ flexShrink: 0 }}>
            <input
              type="color"
              value={cfg.color}
              onChange={(e) => patch({ color: e.target.value })}
              style={{ width: 46, height: 26, background: 'none', border: '1px solid var(--cad-border)', borderRadius: 4, cursor: 'pointer', padding: 0 }}
            />
          </Field>
          <ToggleRow
            label="Usar color de capa"
            checked={cfg.useLayerColor === true}
            onChange={(v) => patch({ useLayerColor: v })}
          />
          <div style={{ flex: 1 }} />
          <ToggleRow label="Habilitada" checked={cfg.enabled} onChange={(v) => patch({ enabled: v })} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {isAnyBatch && (
          <span
            style={{
              fontSize: '0.58rem',
              color: hasChanges ? 'var(--cad-accent-amber)' : 'var(--cad-text-muted)',
              marginRight: 'auto',
            }}
          >
            {hasChanges ? '● cambios sin guardar' : '✓ estilo al día'}
          </span>
        )}
        <button onClick={close} className="cad-btn-secondary">
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={isAnyBatch && !hasChanges}
          className="cad-btn-primary"
          title={isAnyBatch ? 'Guarda el estilo y sincroniza lo ya etiquetado' : undefined}
        >
          💾 Guardar
        </button>
        {showAutoApply && (
          <button
            onClick={handleApplyAuto}
            disabled={targetCount === 0}
            className="cad-btn-primary"
            title={
              targetCount === 0
                ? 'No hay lotes en este alcance todavía'
                : 'Numera y aplica automáticamente, reiniciando por manzano'
            }
          >
            ▶ Aplicar automático
          </button>
        )}
        {showTraceOrder && (
          <button
            onClick={handleTraceOrder}
            disabled={targetCount === 0}
            className="cad-btn-primary"
            title={targetCount === 0 ? 'No hay elementos para trazar todavía' : undefined}
          >
            ✏ Trazar orden…
          </button>
        )}
      </div>
    </Modal>
  );
}