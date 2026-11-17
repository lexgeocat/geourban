import {
  Compass,
  MapPin,
  Minus,
  MousePointerClick,
  Plus,
  RotateCcw,
  Ruler,
  SlidersHorizontal,
} from 'lucide-react';
import type { LotCatalogItem } from '../extractors/cartographyExtractor';
import {
  LOCATION_PRESET_SCALES,
  MAIN_PRESET_SCALES,
  type CartoWidgetId,
} from '../model/layoutTypes';
import { useLayoutStore } from '../store/layoutStore';
import { cardStyle, cardTitleStyle, fieldLabelStyle, inputStyle } from './sidebarStyles';

interface SidebarViewportsAndElementsPanelProps {
  lotsCatalog: LotCatalogItem[];
  selectedLot: LotCatalogItem | null;
  effectiveMainScale: number;
  effectiveLocationScale: number;
}

const MOVABLE_WIDGETS: Array<{ id: CartoWidgetId; label: string }> = [
  { id: 'northArrow', label: 'Norte (Plano)' },
  { id: 'locationNorthArrow', label: 'Norte (Ubicación)' },
  { id: 'numericScale', label: 'Escala Numérica' },
  { id: 'graphicScale', label: 'Escala Gráfica' },
  { id: 'locationGraphicScale', label: 'Escala Gráfica Ubic.' },
  { id: 'coordTable', label: 'Cuadro Coordenadas' },
  { id: 'extraDataBox', label: 'Cuadro Datos Extra' },
];

export default function SidebarViewportsAndElementsPanel({
  lotsCatalog,
  selectedLot,
  effectiveMainScale,
  effectiveLocationScale,
}: SidebarViewportsAndElementsPanelProps) {
  const config = useLayoutStore((s) => s.config);
  const selectedItem = useLayoutStore((s) => s.selectedItem);

  const setDataDrivenEnabled = useLayoutStore((s) => s.setDataDrivenEnabled);
  const setSelectedLotId = useLayoutStore((s) => s.setSelectedLotId);
  const resetViewportsToTemplate = useLayoutStore((s) => s.resetViewportsToTemplate);

  const setMainScale = useLayoutStore((s) => s.setMainScale);
  const setLocationScale = useLayoutStore((s) => s.setLocationScale);

  const setCanvasTool = useLayoutStore((s) => s.setCanvasTool);
  const setSelectedItem = useLayoutStore((s) => s.setSelectedItem);
  const updateWidgetSpec = useLayoutStore((s) => s.updateWidgetSpec);
  const resetWidgetsLayout = useLayoutStore((s) => s.resetWidgetsLayout);
  const setDisplayOption = useLayoutStore((s) => s.setDisplayOption);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 1. Lote Activo (solo en modo Por Lote) */}
      {config.scopeMode === 'lot' && (
        <div style={cardStyle}>
          <div style={cardTitleStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <MapPin size={14} color="#2DD4BF" />
              <span>Lote Activo (Data-Driven)</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div>
              <label style={fieldLabelStyle}>Lote seleccionado ({lotsCatalog.length})</label>
              <select
                value={selectedLot?.id ?? ''}
                onChange={(e) => setSelectedLotId(e.target.value || null)}
                style={inputStyle}
              >
                {lotsCatalog.length === 0 ? (
                  <option value="">Sin lotes dibujados en el proyecto</option>
                ) : (
                  lotsCatalog.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      Mzn {lot.manzanoCode} · Lote {lot.code} ({lot.areaM2.toFixed(1)} m²)
                    </option>
                  ))
                )}
              </select>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.62rem',
                color: 'var(--cad-text-dim)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={config.dataDrivenEnabled}
                onChange={(e) => setDataDrivenEnabled(e.target.checked)}
              />
              <span>GIS Data-Driven: actualizar carimbo según lote</span>
            </label>
          </div>
        </div>
      )}

      {/* 2. Escalas Predefinidas, Restaurar VP e Intervalo de Grilla */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ruler size={14} color="#38BDF8" />
            <span>Escalas y Viewports</span>
          </div>
          <button
            type="button"
            onClick={resetViewportsToTemplate}
            title="Restaurar marcos y encuadre original de los Viewports"
            style={{
              padding: '3px 6px',
              borderRadius: 5,
              border: '1px solid var(--cad-border)',
              background: 'var(--cad-bg-deep)',
              color: 'var(--cad-text-muted)',
              fontSize: '0.57rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <RotateCcw size={10} />
            <span>Restaurar VP</span>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>
            <label style={{ ...fieldLabelStyle, color: '#FF6B4A', fontWeight: 700 }}>
              VP-1 (1:{effectiveMainScale})
            </label>
            <select
              value={
                config.mainViewport.scaleMode === 'auto'
                  ? 'auto'
                  : MAIN_PRESET_SCALES.includes(config.mainViewport.scaleDenominator)
                    ? String(config.mainViewport.scaleDenominator)
                    : 'custom'
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'auto') setMainScale('auto');
                else if (v !== 'custom') setMainScale('preset', Number(v));
              }}
              style={inputStyle}
            >
              <option value="auto">Auto</option>
              {MAIN_PRESET_SCALES.map((sc) => (
                <option key={sc} value={String(sc)}>
                  1 : {sc}
                </option>
              ))}
              {!MAIN_PRESET_SCALES.includes(config.mainViewport.scaleDenominator) &&
                config.mainViewport.scaleMode !== 'auto' && (
                  <option value="custom">1 : {config.mainViewport.scaleDenominator}</option>
                )}
            </select>
          </div>

          <div>
            <label style={{ ...fieldLabelStyle, color: '#2DD4BF', fontWeight: 700 }}>
              VP-2 (1:{effectiveLocationScale})
            </label>
            <select
              value={
                config.locationViewport.scaleMode === 'auto'
                  ? 'auto'
                  : LOCATION_PRESET_SCALES.includes(config.locationViewport.scaleDenominator)
                    ? String(config.locationViewport.scaleDenominator)
                    : 'custom'
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'auto') setLocationScale('auto');
                else if (v !== 'custom') setLocationScale('preset', Number(v));
              }}
              style={inputStyle}
            >
              <option value="auto">Auto</option>
              {LOCATION_PRESET_SCALES.map((sc) => (
                <option key={sc} value={String(sc)}>
                  1 : {sc}
                </option>
              ))}
              {!LOCATION_PRESET_SCALES.includes(config.locationViewport.scaleDenominator) &&
                config.locationViewport.scaleMode !== 'auto' && (
                  <option value="custom">1 : {config.locationViewport.scaleDenominator}</option>
                )}
            </select>
          </div>
        </div>

        {config.display.showGrid && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 6, marginTop: 2 }}>
            <div>
              <label style={fieldLabelStyle}>
                <SlidersHorizontal size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                Intervalo Grilla UTM
              </label>
              <select
                value={config.display.gridIntervalMode}
                onChange={(e) => setDisplayOption('gridIntervalMode', e.target.value as 'auto' | 'manual')}
                style={inputStyle}
              >
                <option value="auto">Auto (según escala)</option>
                <option value="manual">Manual (metros)</option>
              </select>
            </div>
            {config.display.gridIntervalMode === 'manual' && (
              <div>
                <label style={fieldLabelStyle}>Paso (m)</label>
                <input
                  type="number"
                  min={1}
                  step={5}
                  value={config.display.gridIntervalMeters}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 1) setDisplayOption('gridIntervalMeters', v);
                  }}
                  style={inputStyle}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Tamaño y Selección de Elementos Móviles (On/Off está en la Cinta) */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Compass size={14} color="#34D399" />
            <span>Tamaño y Posición</span>
          </div>
          <button
            type="button"
            onClick={resetWidgetsLayout}
            title="Restaurar posiciones y escalas"
            style={{
              padding: '3px 6px',
              borderRadius: 5,
              border: '1px solid var(--cad-border)',
              background: 'var(--cad-bg-deep)',
              color: 'var(--cad-text-muted)',
              fontSize: '0.57rem',
              cursor: 'pointer',
            }}
          >
            Restaurar Pos.
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {MOVABLE_WIDGETS.map((item) => {
            const w = config.widgets[item.id];
            const isSel = selectedItem?.kind === 'widget' && selectedItem.id === item.id;
            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 6px',
                  borderRadius: 6,
                  background: isSel ? 'rgba(56, 189, 248, 0.14)' : 'var(--cad-bg-deep)',
                  border: `1px solid ${isSel ? '#38BDF8' : 'var(--cad-border)'}`,
                  opacity: w.visible ? 1 : 0.48,
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontSize: '0.62rem',
                    color: w.visible ? 'var(--cad-text)' : 'var(--cad-text-muted)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={w.visible ? item.label : `${item.label} (oculto — activalo en Elementos)`}
                >
                  {item.label}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <button
                    type="button"
                    onClick={() => updateWidgetSpec(item.id, { scale: w.scale - 0.12 })}
                    title="Reducir tamaño"
                    style={{
                      padding: '2px 5px',
                      borderRadius: 4,
                      border: '1px solid var(--cad-border)',
                      background: 'var(--cad-bg-surface)',
                      color: 'var(--cad-text)',
                      cursor: 'pointer',
                    }}
                  >
                    <Minus size={9} />
                  </button>
                  <span className="font-mono-cad" style={{ fontSize: '0.59rem', minWidth: 30, textAlign: 'center' }}>
                    {Math.round(w.scale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => updateWidgetSpec(item.id, { scale: w.scale + 0.12 })}
                    title="Ampliar tamaño"
                    style={{
                      padding: '2px 5px',
                      borderRadius: 4,
                      border: '1px solid var(--cad-border)',
                      background: 'var(--cad-bg-surface)',
                      color: 'var(--cad-text)',
                      cursor: 'pointer',
                    }}
                  >
                    <Plus size={9} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCanvasTool('edit-elements');
                      setSelectedItem({ kind: 'widget', id: item.id });
                    }}
                    title="Seleccionar en la lámina para mover"
                    style={{
                      padding: '2px 5px',
                      borderRadius: 4,
                      border: '1px solid var(--cad-border)',
                      background: isSel ? '#38BDF8' : 'var(--cad-bg-surface)',
                      color: isSel ? '#0B0F17' : 'var(--cad-text-dim)',
                      cursor: 'pointer',
                    }}
                  >
                    <MousePointerClick size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
