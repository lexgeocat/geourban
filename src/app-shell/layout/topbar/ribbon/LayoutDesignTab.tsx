import {
  BookmarkPlus,
  Crosshair,
  Download,
  Frame,
  LayoutTemplate,
  MapPin,
  Maximize2,
  Minus,
  MousePointer,
  Palette,
  Printer,
  RectangleHorizontal,
  RectangleVertical,
  Scan,
  Square,
  Type,
  Upload,
} from 'lucide-react';
import { toast } from '@shared-ui/store/toastStore';
import { useLayoutStore } from '@layout-engine';
import type { PaperSizeId } from '@layout-engine';
import {
  triggerLayoutDxfImport,
  triggerLayoutExportPng,
  triggerLayoutPrintPdf,
} from '@layout-engine/ui/layoutExportBridge';
import { RibbonGroup, RibbonTool } from '../RibbonPrimitives';

export default function LayoutDesignTab() {
  const canvasTool = useLayoutStore((s) => s.canvasTool);
  const config = useLayoutStore((s) => s.config);
  const viewportFocusTarget = useLayoutStore((s) => s.viewportFocusTarget);

  const setCanvasTool = useLayoutStore((s) => s.setCanvasTool);
  const setPaperSize = useLayoutStore((s) => s.setPaperSize);
  const setOrientation = useLayoutStore((s) => s.setOrientation);
  const setTheme = useLayoutStore((s) => s.setTheme);
  const setDisplayOption = useLayoutStore((s) => s.setDisplayOption);
  const setViewportFocusTarget = useLayoutStore((s) => s.setViewportFocusTarget);
  const resetSheetView = useLayoutStore((s) => s.resetSheetView);
  const saveActiveTemplateToLibrary = useLayoutStore((s) => s.saveActiveTemplateToLibrary);

  const handleSave = () => {
    const saved = saveActiveTemplateToLibrary();
    if (saved) {
      toast(`Plantilla "${saved.name}" guardada en biblioteca.`, { variant: 'success' });
    }
  };

  return (
    <>
      <RibbonGroup label="Archivo">
        <RibbonTool
          iconOnly
          icon={<Upload color="#FBBF24" />}
          label="Importar .DXF"
          tooltip="Importar plantilla o carimbo .DXF"
          onClick={triggerLayoutDxfImport}
        />
        <RibbonTool
          iconOnly
          icon={<BookmarkPlus color="#2DD4BF" />}
          label="Guardar"
          tooltip="Guardar plantilla actual en tu biblioteca"
          onClick={handleSave}
        />
        <RibbonTool
          iconOnly
          icon={<Printer color="#38BDF8" />}
          label="Imprimir / PDF"
          tooltip="Imprimir o guardar lámina en PDF"
          onClick={triggerLayoutPrintPdf}
        />
        <RibbonTool
          iconOnly
          icon={<Download color="#FF6B4A" />}
          label="Exportar PNG"
          tooltip="Exportar lámina en PNG de alta resolución"
          onClick={triggerLayoutExportPng}
        />
      </RibbonGroup>

      <RibbonGroup label="Dibujo CAD">
        <RibbonTool
          iconOnly
          icon={<MousePointer color="#38BDF8" />}
          label="Seleccionar / Pan"
          active={canvasTool === 'edit-elements' || canvasTool === 'pan-content'}
          tooltip="Seleccionar, mover/escalar objetos o encuadrar viewports"
          onClick={() => setCanvasTool('edit-elements')}
        />
        <RibbonTool
          iconOnly
          icon={<Frame color="#FF6B4A" />}
          label="Cajas VP"
          active={canvasTool === 'edit-viewport-box'}
          tooltip="Mover o redimensionar marcos VP-1 y VP-2"
          onClick={() => setCanvasTool('edit-viewport-box')}
        />
        <RibbonTool
          iconOnly
          icon={<Type color="#34D399" />}
          label="Texto"
          active={canvasTool === 'draw-text'}
          tooltip="Añadir texto independiente en la lámina"
          onClick={() => setCanvasTool('draw-text')}
        />
        <RibbonTool
          iconOnly
          icon={<Square color="#FBBF24" />}
          label="Recuadro"
          active={canvasTool === 'draw-rect'}
          tooltip="Dibujar recuadro o celda de carimbo"
          onClick={() => setCanvasTool('draw-rect')}
        />
        <RibbonTool
          iconOnly
          icon={<Minus color="#A78BFA" />}
          label="Línea"
          active={canvasTool === 'draw-line'}
          tooltip="Dibujar línea separadora"
          onClick={() => setCanvasTool('draw-line')}
        />
      </RibbonGroup>

      <RibbonGroup label="Página">
        <select
          value={config.paperSize}
          onChange={(e) => setPaperSize(e.target.value as PaperSizeId)}
          aria-label="Formato de papel"
          title="Formato de papel"
          style={{
            height: 24,
            padding: '0 6px',
            borderRadius: 5,
            background: 'var(--cad-bg-deepest)',
            border: '1px solid var(--cad-border)',
            color: 'var(--cad-text)',
            fontSize: '0.63rem',
            fontWeight: 600,
            marginRight: 2,
          }}
        >
          <option value="OFICIO_BOL">Oficio 8.5×13&quot;</option>
          <option value="LETTER">Carta 8.5×11&quot;</option>
          <option value="LEGAL">Legal 8.5×14&quot;</option>
          <option value="TABLOID">Tabloide 11×17&quot;</option>
          <option value="A4">ISO A4</option>
          <option value="A3">ISO A3</option>
          <option value="A2">ISO A2</option>
          <option value="A1">ISO A1</option>
          <option value="A0">ISO A0</option>
          <option value="ARCH_D">ARCH D 24×36&quot;</option>
          <option value="CUSTOM">Personalizado</option>
        </select>

        <RibbonTool
          iconOnly
          icon={
            config.orientation === 'landscape' ? (
              <RectangleHorizontal color="#CBD5E1" />
            ) : (
              <RectangleVertical color="#CBD5E1" />
            )
          }
          label="Orientación"
          tooltip={`Orientación actual: ${config.orientation === 'landscape' ? 'Horizontal' : 'Vertical'} (clic para alternar)`}
          onClick={() => setOrientation(config.orientation === 'landscape' ? 'portrait' : 'landscape')}
        />

        <RibbonTool
          iconOnly
          icon={<Palette color={config.display.viewportStyleMode === 'designer' ? '#38BDF8' : '#94A3B8'} />}
          label="Colores del Diseñador"
          tooltip={
            config.display.viewportStyleMode === 'designer'
              ? 'Viewports: Colores y grosores reales del Diseñador (clic para Monocromo B/N)'
              : 'Viewports: Monocromo B/N (clic para restaurar colores reales del Diseñador)'
          }
          active={config.display.viewportStyleMode === 'designer'}
          onClick={() =>
            setDisplayOption(
              'viewportStyleMode',
              config.display.viewportStyleMode === 'designer' ? 'monochrome' : 'designer'
            )
          }
        />

        <RibbonTool
          iconOnly
          icon={
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: 3,
                background: '#FFFFFF',
                border: '1px solid #64748B',
                display: 'inline-block',
              }}
            />
          }
          label="Blanco CTB"
          tooltip="Papel blanco (impresión)"
          active={config.theme === 'monochrome-cad-white'}
          onClick={() => setTheme('monochrome-cad-white')}
        />
        <RibbonTool
          iconOnly
          icon={
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: 3,
                background: '#090C12',
                border: '1px solid #CBD5E1',
                display: 'inline-block',
              }}
            />
          }
          label="Negro AutoCAD"
          tooltip="Papel oscuro estilo AutoCAD"
          active={config.theme === 'autocad-model-dark'}
          onClick={() => setTheme('autocad-model-dark')}
        />
      </RibbonGroup>

      <RibbonGroup label="Vista">
        <RibbonTool
          iconOnly
          icon={<Maximize2 color="#94A3B8" />}
          label="Centrar"
          tooltip="Ajustar lámina completa a la ventana"
          onClick={resetSheetView}
        />
        <RibbonTool
          iconOnly
          icon={<Scan color="#E2E8F0" />}
          label="Hoja"
          tooltip="Enfocar hoja completa"
          active={viewportFocusTarget === 'sheet'}
          onClick={() => setViewportFocusTarget('sheet')}
        />
        <RibbonTool
          iconOnly
          icon={<Crosshair color="#FF6B4A" />}
          label="VP-1"
          tooltip="Zoom rápido a VP-1 (Plano Principal)"
          active={viewportFocusTarget === 'main'}
          onClick={() => setViewportFocusTarget('main')}
        />
        <RibbonTool
          iconOnly
          icon={<MapPin color="#2DD4BF" />}
          label="VP-2"
          tooltip="Zoom rápido a VP-2 (Plano de Ubicación)"
          active={viewportFocusTarget === 'location'}
          onClick={() => setViewportFocusTarget('location')}
        />
        <RibbonTool
          iconOnly
          icon={<LayoutTemplate color="#FBBF24" />}
          label="Carimbo"
          tooltip="Zoom rápido al Carimbo / Cajetín"
          active={viewportFocusTarget === 'carimbo'}
          onClick={() => setViewportFocusTarget('carimbo')}
        />
      </RibbonGroup>
    </>
  );
}
