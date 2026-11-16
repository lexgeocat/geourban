import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Focus,
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
import { cardStyle, cardTitleStyle, fieldLabelStyle, inputStyle, segmentBtnStyle } from './sidebarStyles';

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

  const setCompositionMode = useLayoutStore((s) => s.setCompositionMode);
  const setScopeMode = useLayoutStore((s) => s.setScopeMode);
  const setDataDrivenEnabled = useLayoutStore((s) => s.setDataDrivenEnabled);
  const setSelectedLotId = useLayoutStore((s) => s.setSelectedLotId);
  const setViewportFocusTarget = useLayoutStore((s) => s.setViewportFocusTarget);
  const resetViewportsToTemplate = useLayoutStore((s) => s.resetViewportsToTemplate);

  const setMainScale = useLayoutStore((s) => s.setMainScale);
  const setLocationScale = useLayoutStore((s) => s.setLocationScale);

  const setCanvasTool = useLayoutStore((s) => s.setCanvasTool);
  const setSelectedItem = useLayoutStore((s) => s.setSelectedItem);
  const updateWidgetSpec = useLayoutStore((s) => s.updateWidgetSpec);
  const resetWidgetsLayout = useLayoutStore((s) => s.resetWidgetsLayout);
  const setDisplayOption = useLayoutStore((s) => s.setDisplayOption);

  const currentIdx = selectedLot ? lotsCatalog.findIndex((l) => l.id === selectedLot.id) : -1;

  const handleStepLot = (delta: number) => {
    if (lotsCatalog.length === 0) return;
    const baseIdx = currentIdx >= 0 ? currentIdx : 0;
    const nextIdx = (baseIdx + delta + lotsCatalog.length) % lotsCatalog.length;
    setSelectedLotId(lotsCatalog[nextIdx].id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 1. Alcance GIS + Selector de Lote + Modo Directo / QGIS */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MapPin size={14} color="#2DD4BF" />
            <span>Alcance y Modo de Viewports</span>
          </div>
          <button
            type="button"
            onClick={resetViewportsToTemplate}
            title="Restaurar Viewports"
            style={{
              padding: '3px 6px',
              borderRadius: 5,
              border: '1px solid var(--cad-border)',
              background: 'var(--cad-bg-deep)',
              color: 'var(--cad-text-muted)',
              fontSize: '0.59rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <RotateCcw size={10} />
            <span>Rest. VP</span>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          <button
            type="button"
            onClick={() => setScopeMode('lot')}
            style={segmentBtnStyle(config.scopeMode === 'lot', '#2DD4BF')}
          >
            Por Lote
          </button>
          <button
            type="button"
            onClick={() => setScopeMode('urbanization')}
            style={segmentBtnStyle(config.scopeMode === 'urbanization', '#2DD4BF')}
          >
            Urbanización Gral.
          </button>
        </div>

        {config.scopeMode === 'lot' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                onClick={() => handleStepLot(-1)}
                style={{
                  padding: '5px 7px',
                  borderRadius: 6,
                  border: '1px solid var(--cad-border)',
                  background: 'var(--cad-bg-deep)',
                  color: 'var(--cad-text)',
                  cursor: 'pointer',
                }}
              >
                <ChevronLeft size={13} />
              </button>
              <select
                value={selectedLot?.id ?? ''}
                onChange={(e) => setSelectedLotId(e.target.value || null)}
                style={{ ...inputStyle, flex: 1 }}
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
              <button
                type="button"
                onClick={() => handleStepLot(1)}
                style={{
                  padding: '5px 7px',
                  borderRadius: 6,
                  border: '1px solid var(--cad-border)',
                  background: 'var(--cad-bg-deep)',
                  color: 'var(--cad-text)',
                  cursor: 'pointer',
                }}
              >
                <ChevronRight size={13} />
              </button>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.64rem',
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
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          <button
            type="button"
            onClick={() => setCompositionMode('direct')}
            style={segmentBtnStyle(config.compositionMode === 'direct', '#FF6B4A')}
          >
            1. Modo Directo
          </button>
          <button
            type="button"
            onClick={() => setCompositionMode('qgis-viewport')}
            style={segmentBtnStyle(config.compositionMode === 'qgis-viewport', '#38BDF8')}
          >
            2. Modo QGIS VP
          </button>
        </div>
      </div>

      {/* 2. Escalas Independientes VP-1 y VP-2 */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ruler size={14} color="#38BDF8" />
            <span>Escalas Independientes</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => setViewportFocusTarget('main')}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid var(--cad-border)',
                background: 'var(--cad-bg-deep)',
                color: '#FF6B4A',
                fontSize: '0.58rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Focus size={10} />
              <span>VP-1</span>
            </button>
            <button
              type="button"
              onClick={() => setViewportFocusTarget('location')}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid var(--cad-border)',
                background: 'var(--cad-bg-deep)',
                color: '#2DD4BF',
                fontSize: '0.58rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Focus size={10} />
              <span>VP-2</span>
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 5 }}>
          <div>
            <label style={{ ...fieldLabelStyle, color: '#FF6B4A', fontWeight: 700 }}>
              VP-1 Plano (1:{effectiveMainScale})
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
              <option value="auto">Auto (1:{effectiveMainScale})</option>
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
            <label style={fieldLabelStyle}>Manual VP-1</label>
            <input
              type="number"
              min={10}
              step={25}
              value={effectiveMainScale}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 10) setMainScale('manual', n);
              }}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 5 }}>
          <div>
            <label style={{ ...fieldLabelStyle, color: '#2DD4BF', fontWeight: 700 }}>
              VP-2 Ubicación (1:{effectiveLocationScale})
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
              <option value="auto">Auto (1:{effectiveLocationScale})</option>
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
          <div>
            <label style={fieldLabelStyle}>Manual VP-2</label>
            <input
              type="number"
              min={50}
              step={100}
              value={effectiveLocationScale}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 50) setLocationScale('manual', n);
              }}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
            />
          </div>
        </div>
      </div>

      {/* 3. Norte, Escala Numérica, Escala Gráfica y Cuadros (On/Off + Escala + Mover en lámina) */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Compass size={14} color="#34D399" />
            <span>Elementos Móviles y Escalables</span>
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
              fontSize: '0.58rem',
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
                  gap: 5,
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: '0.64rem',
                    color: w.visible ? 'var(--cad-text)' : 'var(--cad-text-muted)',
                    cursor: 'pointer',
                    flex: 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={w.visible}
                    onChange={(e) => updateWidgetSpec(item.id, { visible: e.target.checked })}
                  />
                  <span>{item.label}</span>
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <button
                    type="button"
                    onClick={() => updateWidgetSpec(item.id, { scale: w.scale - 0.12 })}
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
                  <span className="font-mono-cad" style={{ fontSize: '0.6rem', minWidth: 32, textAlign: 'center' }}>
                    {Math.round(w.scale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => updateWidgetSpec(item.id, { scale: w.scale + 0.12 })}
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
                    title="Seleccionar para mover con el mouse"
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

      {/* 4. Grilla y Capas Cartográficas */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <SlidersHorizontal size={14} color="#A78BFA" />
            <span>Grilla UTM y Geometría</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          {(
            [
              { key: 'showGrid', label: 'Grilla UTM / Coords' },
              { key: 'showLotDimensions', label: 'Cotas Lados (m)' },
              { key: 'showLotLabels', label: 'Etiquetas y Áreas' },
              { key: 'showVertexMarkers', label: 'Nodos V1..Vn' },
              { key: 'showStreetNames', label: 'Nombres Vías' },
              { key: 'showNeighbors', label: 'Colindantes' },
              { key: 'showLocationOsmTiles', label: 'Mapa OSM Ubic.' },
            ] as const
          ).map((opt) => (
            <label
              key={opt.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: '0.64rem',
                color: 'var(--cad-text-dim)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={config.display[opt.key]}
                onChange={(e) => setDisplayOption(opt.key, e.target.checked)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>

        {config.display.showGrid && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 6, marginTop: 2 }}>
            <select
              value={config.display.gridIntervalMode}
              onChange={(e) => setDisplayOption('gridIntervalMode', e.target.value as 'auto' | 'manual')}
              style={inputStyle}
            >
              <option value="auto">Grilla Auto (según escala)</option>
              <option value="manual">Intervalo Manual (m)</option>
            </select>
            {config.display.gridIntervalMode === 'manual' && (
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
