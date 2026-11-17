import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Compass,
  FileSpreadsheet,
  Globe,
  Grid3x3,
  Hash,
  Layers,
  MapPin,
  Minus,
  MoveHorizontal,
  Navigation,
  Plus,
  Route,
  Ruler,
  Scaling,
  Table2,
  Tag,
} from 'lucide-react';
import { useLayoutStore } from '@layout-engine';
import { triggerLayoutStepLot } from '@layout-engine/ui/layoutExportBridge';
import { RibbonGroup, RibbonTool } from '../RibbonPrimitives';

export default function LayoutElementsTab() {
  const config = useLayoutStore((s) => s.config);

  const setScopeMode = useLayoutStore((s) => s.setScopeMode);
  const setMainScale = useLayoutStore((s) => s.setMainScale);
  const setLocationScale = useLayoutStore((s) => s.setLocationScale);
  const zoomViewportScale = useLayoutStore((s) => s.zoomViewportScale);
  const updateWidgetSpec = useLayoutStore((s) => s.updateWidgetSpec);
  const setDisplayOption = useLayoutStore((s) => s.setDisplayOption);

  return (
    <>
      <RibbonGroup label="Alcance GIS">
        <RibbonTool
          iconOnly
          icon={<MapPin color="#2DD4BF" />}
          label="Por Lote"
          tooltip="Plano individual por Lote (Data-Driven Pages)"
          active={config.scopeMode === 'lot'}
          onClick={() => setScopeMode('lot')}
        />
        <RibbonTool
          iconOnly
          icon={<Layers color="#A78BFA" />}
          label="Urbanización"
          tooltip="Plano general de toda la urbanización"
          active={config.scopeMode === 'urbanization'}
          onClick={() => setScopeMode('urbanization')}
        />
        {config.scopeMode === 'lot' && (
          <>
            <RibbonTool
              iconOnly
              icon={<ChevronLeft color="#38BDF8" />}
              label="Lote Anterior"
              tooltip="Ir al lote anterior"
              onClick={() => triggerLayoutStepLot(-1)}
            />
            <RibbonTool
              iconOnly
              icon={<ChevronRight color="#38BDF8" />}
              label="Lote Siguiente"
              tooltip="Ir al lote siguiente"
              onClick={() => triggerLayoutStepLot(1)}
            />
          </>
        )}
      </RibbonGroup>

      <RibbonGroup label="Escalas 1:N">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} title="Escala del Plano Principal (VP-1)">
            <span style={{ fontSize: '0.59rem', fontWeight: 700, color: '#FF6B4A' }}>VP1 1:</span>
            <button
              type="button"
              onClick={() => zoomViewportScale('main', config.mainViewport.scaleDenominator, 0.85)}
              title="Acercar escala VP-1"
              style={scaleBtnStyle}
            >
              <Minus size={9} />
            </button>
            <input
              type="number"
              min={10}
              step={25}
              value={config.mainViewport.scaleDenominator}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 10) setMainScale('manual', n);
              }}
              style={{ ...scaleInputStyle, border: '1px solid rgba(255, 107, 74, 0.45)' }}
            />
            <button
              type="button"
              onClick={() => zoomViewportScale('main', config.mainViewport.scaleDenominator, 1.15)}
              title="Alejar escala VP-1"
              style={scaleBtnStyle}
            >
              <Plus size={9} />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} title="Escala del Plano de Ubicación (VP-2)">
            <span style={{ fontSize: '0.59rem', fontWeight: 700, color: '#2DD4BF' }}>VP2 1:</span>
            <button
              type="button"
              onClick={() => zoomViewportScale('location', config.locationViewport.scaleDenominator, 0.85)}
              title="Acercar escala VP-2"
              style={scaleBtnStyle}
            >
              <Minus size={9} />
            </button>
            <input
              type="number"
              min={50}
              step={100}
              value={config.locationViewport.scaleDenominator}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 50) setLocationScale('manual', n);
              }}
              style={{ ...scaleInputStyle, border: '1px solid rgba(45, 212, 191, 0.45)' }}
            />
            <button
              type="button"
              onClick={() => zoomViewportScale('location', config.locationViewport.scaleDenominator, 1.15)}
              title="Alejar escala VP-2"
              style={scaleBtnStyle}
            >
              <Plus size={9} />
            </button>
          </div>
        </div>
      </RibbonGroup>

      <RibbonGroup label="Elementos">
        <RibbonTool
          iconOnly
          icon={<Compass color="#34D399" />}
          label="Norte Plano"
          tooltip="Mostrar / ocultar Norte del Plano (VP-1)"
          active={config.widgets.northArrow.visible}
          onClick={() => updateWidgetSpec('northArrow', { visible: !config.widgets.northArrow.visible })}
        />
        <RibbonTool
          iconOnly
          icon={<Navigation color="#2DD4BF" />}
          label="Norte Ubicación"
          tooltip="Mostrar / ocultar Norte de Ubicación (VP-2)"
          active={config.widgets.locationNorthArrow.visible}
          onClick={() =>
            updateWidgetSpec('locationNorthArrow', { visible: !config.widgets.locationNorthArrow.visible })
          }
        />
        <RibbonTool
          iconOnly
          icon={<Hash color="#38BDF8" />}
          label="Escala Numérica"
          tooltip="Mostrar / ocultar Escala Numérica"
          active={config.widgets.numericScale.visible}
          onClick={() => updateWidgetSpec('numericScale', { visible: !config.widgets.numericScale.visible })}
        />
        <RibbonTool
          iconOnly
          icon={<Ruler color="#38BDF8" />}
          label="Escala Gráfica"
          tooltip="Mostrar / ocultar Escala Gráfica del Plano"
          active={config.widgets.graphicScale.visible}
          onClick={() => updateWidgetSpec('graphicScale', { visible: !config.widgets.graphicScale.visible })}
        />
        <RibbonTool
          iconOnly
          icon={<MoveHorizontal color="#2DD4BF" />}
          label="Escala Gráfica Ubic."
          tooltip="Mostrar / ocultar Escala Gráfica de Ubicación"
          active={config.widgets.locationGraphicScale.visible}
          onClick={() =>
            updateWidgetSpec('locationGraphicScale', {
              visible: !config.widgets.locationGraphicScale.visible,
            })
          }
        />
        <RibbonTool
          iconOnly
          icon={<Table2 color="#FBBF24" />}
          label="Cuadro Coordenadas"
          tooltip="Mostrar / ocultar Cuadro de Coordenadas UTM"
          active={config.widgets.coordTable.visible}
          onClick={() => updateWidgetSpec('coordTable', { visible: !config.widgets.coordTable.visible })}
        />
        <RibbonTool
          iconOnly
          icon={<FileSpreadsheet color="#F472B6" />}
          label="Datos Extra"
          tooltip="Mostrar / ocultar Cuadro de Datos Extra"
          active={config.widgets.extraDataBox.visible}
          onClick={() => updateWidgetSpec('extraDataBox', { visible: !config.widgets.extraDataBox.visible })}
        />
      </RibbonGroup>

      <RibbonGroup label="Capas VP">
        <RibbonTool
          iconOnly
          icon={<Grid3x3 color="#A78BFA" />}
          label="Grilla UTM"
          tooltip="Mostrar / ocultar Grilla UTM y marco graduado"
          active={config.display.showGrid}
          onClick={() => setDisplayOption('showGrid', !config.display.showGrid)}
        />
        <RibbonTool
          iconOnly
          icon={<Globe color="#38BDF8" />}
          label="Mapa OSM"
          tooltip="Mostrar / ocultar mapa base OSM en Ubicación (VP-2)"
          active={config.display.showLocationOsmTiles}
          onClick={() => setDisplayOption('showLocationOsmTiles', !config.display.showLocationOsmTiles)}
        />
        <RibbonTool
          iconOnly
          icon={<Scaling color="#FF6B4A" />}
          label="Cotas Lados"
          tooltip="Mostrar / ocultar cotas de distancia de lados (m)"
          active={config.display.showLotDimensions}
          onClick={() => setDisplayOption('showLotDimensions', !config.display.showLotDimensions)}
        />
        <RibbonTool
          iconOnly
          icon={<Tag color="#FBBF24" />}
          label="Etiquetas y Áreas"
          tooltip="Mostrar / ocultar códigos de lote y superficies"
          active={config.display.showLotLabels}
          onClick={() => setDisplayOption('showLotLabels', !config.display.showLotLabels)}
        />
        <RibbonTool
          iconOnly
          icon={<CircleDot color="#34D399" />}
          label="Nodos Vértices"
          tooltip="Mostrar / ocultar nodos V1..Vn del polígono"
          active={config.display.showVertexMarkers}
          onClick={() => setDisplayOption('showVertexMarkers', !config.display.showVertexMarkers)}
        />
        <RibbonTool
          iconOnly
          icon={<Route color="#CBD5E1" />}
          label="Nombres Vías"
          tooltip="Mostrar / ocultar nombres de calles y vías"
          active={config.display.showStreetNames}
          onClick={() => setDisplayOption('showStreetNames', !config.display.showStreetNames)}
        />
        <RibbonTool
          iconOnly
          icon={<Boxes color="#94A3B8" />}
          label="Colindantes"
          tooltip="Mostrar / ocultar lotes colindantes"
          active={config.display.showNeighbors}
          onClick={() => setDisplayOption('showNeighbors', !config.display.showNeighbors)}
        />
      </RibbonGroup>
    </>
  );
}

const scaleBtnStyle: React.CSSProperties = {
  width: 19,
  height: 20,
  borderRadius: 4,
  border: '1px solid var(--cad-border)',
  background: 'var(--cad-bg-surface)',
  color: 'var(--cad-text)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const scaleInputStyle: React.CSSProperties = {
  width: 48,
  height: 20,
  padding: '0 3px',
  borderRadius: 4,
  background: 'var(--cad-bg-deepest)',
  color: 'var(--cad-text)',
  fontSize: '0.61rem',
  fontFamily: 'JetBrains Mono, monospace',
  textAlign: 'center',
};
