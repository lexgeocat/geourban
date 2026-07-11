import React, { useMemo, useState } from 'react';
import { useSubdivisionStore } from '../store/subdivisionStore';
import { useMapStore } from '../store/mapStore';
import { useHistoryStore } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { useDrawStore } from '../store/drawStore';
import { subdivide } from '../geo/subdivisionAlgorithms';
import { updateFeatureMetrics, refreshSourceMetrics } from '../geo/metrics';
import type { Polygon as GeoJsonPolygon, LineString as GeoJsonLineString } from 'geojson';
import GeoJSON from 'ol/format/GeoJSON.js';
import type Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';

const geoJsonFormat = new GeoJSON();

const METHOD_LABELS: Record<string, string> = {
  grid: 'Grilla regular',
  proportional: 'Proporcional por área',
  manual: 'Corte manual (con línea)',
  offset: 'Offsets paralelos al frente',
};

const METHOD_DESCRIPTIONS: Record<string, string> = {
  grid: 'Divide el polígono en una grilla uniforme de ancho × profundidad. Opcionalmente con calle interna.',
  proportional: 'Genera N lotes del mismo tamaño aproximado, optimizando el aspect ratio.',
  manual: 'Traza una línea de corte sobre el polígono (en mapa) y lo divide en dos partes.',
  offset: 'Genera lotes paralelos al frente del polígono, espaciados por la distancia indicada.',
};

export default function SubdivisionDialog() {
  const isOpen = useSubdivisionStore((s) => s.isOpen);
  const method = useSubdivisionStore((s) => s.method);
  const options = useSubdivisionStore((s) => s.options);
  const preview = useSubdivisionStore((s) => s.preview);
  const loading = useSubdivisionStore((s) => s.loading);
  const errorMessage = useSubdivisionStore((s) => s.errorMessage);
  const setMethod = useSubdivisionStore((s) => s.setMethod);
  const setOption = useSubdivisionStore((s) => s.setOption);
  const close = useSubdivisionStore((s) => s.close);
  const setPreview = useSubdivisionStore((s) => s.setPreview);
  const setLoading = useSubdivisionStore((s) => s.setLoading);
  const setError = useSubdivisionStore((s) => s.setError);

  const drawSource = useMapStore((s) => s.drawSource);
  const targetId = useSubdivisionStore((s) => s.targetFeatureId);
  const lastDrawnLineId = useDrawStore((s) => s.lastDrawnLineId);

  // Hooks deben estar siempre
  // En vez de sincronizar el estado de la geometria en useEffect (que dispara
  // re-renders innecesarios), lo derivamos en cada render a partir de
  // targetId/drawSource/isOpen. Solo cacheamos el GeoJSON como estado si el
  // target cambio; para evitar el set-state-in-effect usamos un useMemo.
  const targetGeom = useMemo<GeoJsonPolygon | null>(() => {
    if (!isOpen || !drawSource || targetId == null) return null;
    const feat = drawSource.getFeatureById(targetId) as Feature<Geometry> | null;
    if (!feat) return null;
    const g = feat.getGeometry();
    if (!g) return null;
    const gj = geoJsonFormat.writeGeometryObject(g, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:3857',
    });
    if (gj.type === 'Polygon') return gj as GeoJsonPolygon;
    return null;
  }, [isOpen, targetId, drawSource]);

  const loadError: string | null = useMemo(() => {
    if (!isOpen) return null;
    if (targetId == null) return 'No hay feature seleccionada';
    if (!drawSource) return 'Source no inicializado';
    if (drawSource.getFeatureById(targetId) == null) return 'Feature no encontrada';
    if (targetGeom == null) return 'La geometría no es un polígono';
    return null;
   }, [isOpen, targetId, drawSource, targetGeom]);

  const manualSplitLine = useMemo<GeoJsonLineString | null>(() => {
    if (!isOpen || method !== 'manual' || !drawSource || lastDrawnLineId == null) return null;
    const lineFeat = drawSource.getFeatureById(lastDrawnLineId) as Feature<Geometry> | null;
    const g = lineFeat?.getGeometry();
    if (!g || g.getType() !== 'LineString') return null;
    const gj = geoJsonFormat.writeGeometryObject(g, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:3857',
    });
    return gj.type === 'LineString' ? (gj as GeoJsonLineString) : null;
  }, [isOpen, method, drawSource, lastDrawnLineId]);

  if (!isOpen) return null;
  // Combinar el loadError con el errorMessage del store
  const combinedError = errorMessage ?? loadError;

  // Live preview: recalcular subdivision con los options actuales
  const runPreview = () => {
    setError(null);
    if (!targetGeom) {
      setError('No hay polígono target');
      return;
    }
    if (method === 'manual' && !manualSplitLine) {
      setError('Trazá una línea (tecla L) que cruce el polígono antes de previsualizar.');
      setPreview(null);
      return;
    }
    const effectiveOptions =
      method === 'manual' ? { ...options, splitLine: manualSplitLine } : options;
    const r = subdivide(targetGeom, effectiveOptions);
    if (!r.ok) {
      setError(r.error ?? 'No se pudo generar el preview');
      setPreview(null);
      return;
    }
    setPreview({ count: r.features.length, warnings: r.warnings });
  };

  const applySubdivision = () => {
    if (!drawSource || targetId == null) return;
    if (method === 'manual' && !manualSplitLine) {
      setError('Trazá una línea (tecla L) que cruce el polígono antes de aplicar.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // targetGeom ya esta en EPSG:3857
      const effectiveOptions =
        method === 'manual' ? { ...options, splitLine: manualSplitLine } : options;
      const r = subdivide(targetGeom!, effectiveOptions);      if (!r.ok) {
        setError(r.error ?? 'Subdivisión falló');
        return;
      }
      // Eliminar el feature original
      const target = drawSource.getFeatureById(targetId);
      if (target) drawSource.removeFeature(target);

      // Convertir los GeoJSON resultantes (EPSG:3857) a features OL
      r.features.forEach((f) => {
        const wgs = f.geometry.type === 'Polygon' ? (f.geometry as GeoJsonPolygon) : null;
        if (!wgs) return;
        const geom3857 = geoJsonFormat.readGeometry(
          { type: 'Polygon', coordinates: wgs.coordinates },
          { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:3857' }
        );
        const olFeat = new Feature({ geometry: geom3857 as Geometry });
        const newId = `subdiv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        olFeat.setId(newId);
        olFeat.setProperties({
          ...(f.properties ?? {}),
          createdAt: new Date().toISOString(),
          method: options.method,
        });
        drawSource.addFeature(olFeat);
        updateFeatureMetrics(olFeat as Feature<Geometry>);
      });

      // Recalcular metricas y refrescar
      refreshSourceMetrics(drawSource);
      drawSource.changed();
      useHistoryStore.getState().pushState(drawSource.getFeatures());

      // Limpiar seleccion y cerrar
      useSelectionStore.getState().clear();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="subdivision-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeSlideIn 0.2s ease-out',
      }}
    >
      <div
        className="cad-panel-glass"
        style={{
          width: 'min(560px, 92vw)',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: '20px 22px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: '1px solid var(--cad-border)',
          }}
        >
          <h2
            id="subdivision-title"
            style={{
              fontSize: '0.95rem',
              fontWeight: 700,
              color: 'var(--cad-text)',
              letterSpacing: '0.02em',
            }}
          >
            Subdividir polígono
          </h2>
          <button
            onClick={close}
            className="cad-icon-btn"
            aria-label="Cerrar"
            style={{ width: 28, height: 28 }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ width: 14, height: 14 }}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Method selector */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Método</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {Object.entries(METHOD_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMethod(key as never)}
                className={`cad-icon-btn`}
                style={{
                  ...methodBtnStyle,
                  ...(method === key ? methodBtnActiveStyle : {}),
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p style={helpStyle}>{METHOD_DESCRIPTIONS[method]}</p>
        </div>

        {/* Options por metodo */}
        {method === 'grid' && (
          <GridOptions options={options} setOption={setOption} />
        )}
        {method === 'proportional' && (
          <ProportionalOptions options={options} setOption={setOption} />
        )}
        {method === 'manual' && <ManualOptions />}
        {method === 'offset' && (
          <OffsetOptions options={options} setOption={setOption} />
        )}

        {/* Error */}
        {combinedError && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid var(--cad-accent-red)',
              color: 'var(--cad-accent-red)',
              fontSize: '0.75rem',
            }}
          >
            {combinedError}
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(16, 185, 129, 0.10)',
              border: '1px solid var(--cad-accent-green)',
              color: 'var(--cad-accent-green)',
              fontSize: '0.75rem',
            }}
          >
            <strong>{preview.count} lotes</strong> se generarán
            {preview.warnings.length > 0 && (
              <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                {preview.warnings.map((w, i) => (
                  <li key={i} style={{ color: 'var(--cad-accent-amber)' }}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            marginTop: 18,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <button onClick={runPreview} className="cad-icon-btn" style={secondaryBtnStyle}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Vista previa
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={close} className="cad-icon-btn" style={secondaryBtnStyle}>
              Cancelar
            </button>
            <button
              onClick={applySubdivision}
              disabled={loading}
              className="cad-icon-btn"
              style={{
                ...primaryBtnStyle,
                opacity: loading ? 0.5 : 1,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? 'Aplicando...' : 'Aplicar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Sub-componentes de opciones ---------- */

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  unit = 'm',
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={labelStyle}>
        {label} <span style={{ color: 'var(--cad-text-muted)' }}>({unit})</span>
      </label>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={inputStyle}
      />
    </div>
  );
}

function GridOptions({
  options,
  setOption,
}: {
  options: any;
  setOption: (k: any, v: any) => void;
}) {
  return (
    <div>
      <NumberField
        label="Ancho de lote"
        value={options.lotWidthM}
        onChange={(v) => setOption('lotWidthM', v)}
        step={0.5}
      />
      <NumberField
        label="Profundidad de lote"
        value={options.lotDepthM}
        onChange={(v) => setOption('lotDepthM', v)}
        step={0.5}
      />
      <NumberField
        label="Calle interna (opcional)"
        value={options.innerStreetWidthM}
        onChange={(v) => setOption('innerStreetWidthM', v)}
        step={0.5}
      />
    </div>
  );
}

function ProportionalOptions({
  options,
  setOption,
}: {
  options: any;
  setOption: (k: any, v: any) => void;
}) {
  return (
    <div>
      <NumberField
        label="Número de lotes objetivo"
        value={options.targetCount}
        onChange={(v) => {
          setOption('targetCount', v);
          setOption('targetAreaM2', undefined);
        }}
        step={1}
        unit="lotes"
      />
      <div style={{ textAlign: 'center', color: 'var(--cad-text-muted)', fontSize: '0.7rem', margin: '4px 0' }}>
        — o —
      </div>
      <NumberField
        label="Área objetivo por lote"
        value={options.targetAreaM2}
        onChange={(v) => {
          setOption('targetAreaM2', v);
          setOption('targetCount', undefined);
        }}
        step={10}
        unit="m²"
      />
    </div>
  );
}

function ManualOptions() {
  return (
    <div
      style={{
        padding: 10,
        background: 'var(--cad-bg-surface)',
        borderRadius: 6,
        fontSize: '0.75rem',
        color: 'var(--cad-text-dim)',
      }}
    >
      <p style={{ marginBottom: 6 }}>
        <strong>Cómo usarlo:</strong> active el modo <em>Dibujo de línea</em> (tecla
        <kbd style={kbdStyle}>L</kbd>) y trace una línea cruzando el polígono seleccionado. La
        subdivisión se aplicará al aplicar.
      </p>
      <p>
        La línea de corte es la última <code>LineString</code> dibujada que intersecte el
        polígono target.
      </p>
    </div>
  );
}

function OffsetOptions({
  options,
  setOption,
}: {
  options: any;
  setOption: (k: any, v: any) => void;
}) {
  return (
    <div>
      <NumberField
        label="Distancia entre lotes (offset)"
        value={options.offsetDistanceM}
        onChange={(v) => setOption('offsetDistanceM', v)}
        step={0.5}
      />
    </div>
  );
}

/* ---------- Helpers ---------- */

/* ---------- Estilos ---------- */

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.7rem',
  fontWeight: 600,
  color: 'var(--cad-text-dim)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  marginBottom: 4,
};

const helpStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--cad-text-muted)',
  marginTop: 6,
  fontStyle: 'italic',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--cad-bg-deepest)',
  border: '1px solid var(--cad-border)',
  borderRadius: 4,
  color: 'var(--cad-text)',
  fontSize: '0.8rem',
  fontFamily: 'JetBrains Mono, monospace',
};

const methodBtnStyle: React.CSSProperties = {
  width: 'auto',
  height: 'auto',
  padding: '8px 10px',
  fontSize: '0.75rem',
  fontWeight: 500,
  textAlign: 'left',
  background: 'var(--cad-bg-surface)',
  border: '1px solid var(--cad-border)',
  borderRadius: 6,
  color: 'var(--cad-text-dim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const methodBtnActiveStyle: React.CSSProperties = {
  background: 'var(--cad-bg-active)',
  borderColor: 'var(--cad-accent)',
  color: 'var(--cad-accent)',
  boxShadow: '0 0 0 1px var(--cad-accent)',
};

const primaryBtnStyle: React.CSSProperties = {
  width: 'auto',
  height: 'auto',
  padding: '8px 14px',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: 'var(--cad-accent)',
  color: '#0d1117',
  border: '1px solid var(--cad-accent)',
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const secondaryBtnStyle: React.CSSProperties = {
  width: 'auto',
  height: 'auto',
  padding: '8px 12px',
  fontSize: '0.75rem',
  fontWeight: 500,
  background: 'transparent',
  color: 'var(--cad-text-dim)',
  border: '1px solid var(--cad-border)',
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 5px',
  background: 'var(--cad-bg-deepest)',
  border: '1px solid var(--cad-border)',
  borderRadius: 3,
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '0.65rem',
  color: 'var(--cad-accent)',
};
