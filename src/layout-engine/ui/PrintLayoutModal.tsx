import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Download,
  Grid3x3,
  Maximize2,
  Printer,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Modal } from '@shared-ui/Modal';
import { useUiShellStore } from '@app-shell/store/uiShellStore';
import { useMapStore } from '@map-core/store/mapStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useProjectCrsStore } from '@georef-engine/store/projectCrsStore';
import { useDrawSourceTick } from '@shared-ui/hooks/useDrawSourceTick';
import { toast } from '@shared-ui/store/toastStore';
import urbigeoIconUrl from '@/assets/urbigeo-icon.png';
import { EMPTY_SHEET_FALLBACK } from '../dxf/builtinTemplates';
import { extractProjectCartography, formatDms } from '../extractors/cartographyExtractor';
import { getEffectivePaperDimensionsMm } from '../model/layoutTypes';
import { prefetchOsmTilesForLocation } from '../renderers/cartographicPrimitives';
import { renderCartographicSheet, type SheetRenderResult } from '../renderers/sheetRenderer';
import { useLayoutStore } from '../store/layoutStore';
import InteractiveViewportCanvas from './InteractiveViewportCanvas';
import SidebarCarimboFieldsPanel from './SidebarCarimboFieldsPanel';
import SidebarPaperAndStylePanel from './SidebarPaperAndStylePanel';
import SidebarViewportsAndElementsPanel from './SidebarViewportsAndElementsPanel';

type SidebarTabId = 'paper-style' | 'viewports-elements' | 'carimbo-extras';

const SIDEBAR_TABS: Array<{ id: SidebarTabId; label: string; accent: string }> = [
  { id: 'paper-style', label: '1. Plantilla & Papel', accent: '#A78BFA' },
  { id: 'viewports-elements', label: '2. Viewports & Elem.', accent: '#38BDF8' },
  { id: 'carimbo-extras', label: '3. Carimbo & Datos', accent: '#FF6B4A' },
];

export default function PrintLayoutModal() {
  const open = useUiShellStore((s) => s.layoutModalOpen);
  const setOpen = useUiShellStore((s) => s.setLayoutModalOpen);

  const drawSource = useMapStore((s) => s.drawSource);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const streets = useStreetStore((s) => s.streets);
  const roundabouts = useRoundaboutStore((s) => s.roundabouts);
  const layers = useLayersStore((s) => s.layers);
  const crsMode = useProjectCrsStore((s) => s.mode);
  const utmZone = useProjectCrsStore((s) => s.utmZone);
  const utmHemisphere = useProjectCrsStore((s) => s.utmHemisphere);

  const templates = useLayoutStore((s) => s.templates);
  const activeTemplateId = useLayoutStore((s) => s.activeTemplateId);
  const config = useLayoutStore((s) => s.config);
  const previewZoom = useLayoutStore((s) => s.previewZoom);
  const setPreviewZoom = useLayoutStore((s) => s.setPreviewZoom);
  const setSelectedLotId = useLayoutStore((s) => s.setSelectedLotId);
  const resetSheetView = useLayoutStore((s) => s.resetSheetView);

  const tick = useDrawSourceTick(drawSource);

  const [sidebarTab, setSidebarTab] = useState<SidebarTabId>('paper-style');
  const [tileTick, setTileTick] = useState<number>(0);
  const [renderMetrics, setRenderMetrics] = useState<SheetRenderResult | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const brandImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = urbigeoIconUrl;
    img.onload = () => {
      brandImgRef.current = img;
      setTileTick((t) => t + 1);
    };
  }, []);

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === activeTemplateId) ?? templates[0] ?? EMPTY_SHEET_FALLBACK,
    [templates, activeTemplateId]
  );

  const carto = useMemo(() => {
    if (!open) return null;
    void tick;
    return extractProjectCartography({
      drawSource,
      streets,
      roundabouts,
      layers,
      crsMode,
      utmZone,
      utmHemisphere,
      fallbackCenterLonLat: viewConfig.center,
    });
  }, [open, tick, drawSource, streets, roundabouts, layers, crsMode, utmZone, utmHemisphere, viewConfig.center]);

  const selectedLot = useMemo(() => {
    if (!carto || carto.lotsCatalog.length === 0) return null;
    if (config.selectedLotId) {
      const found = carto.lotsCatalog.find((l) => l.id === config.selectedLotId);
      if (found) return found;
    }
    return carto.lotsCatalog[0];
  }, [carto, config.selectedLotId]);

  useEffect(() => {
    if (!open || !carto || !config.display.showLocationOsmTiles) return;
    const [lon, lat] = carto.centroidLonLat;
    for (const z of [13, 14, 15, 16]) {
      prefetchOsmTilesForLocation(lon, lat, z, () => {
        setTileTick((t) => t + 1);
      });
    }
  }, [open, carto, config.display.showLocationOsmTiles]);

  useEffect(() => {
    if (!open || !carto || !canvasRef.current || !activeTemplate) return;
    void tileTick;
    const metrics = renderCartographicSheet({
      canvas: canvasRef.current,
      carto,
      config,
      template: activeTemplate,
      selectedLot,
      brandIcon: brandImgRef.current,
    });
    setRenderMetrics(metrics);
  }, [open, carto, config, activeTemplate, selectedLot, tileTick]);

  const effectiveMainScale = renderMetrics?.effectiveMainScale ?? config.mainViewport.scaleDenominator;
  const effectiveLocationScale =
    renderMetrics?.effectiveLocationScale ?? config.locationViewport.scaleDenominator;
  const paperDims = getEffectivePaperDimensionsMm(config);

  const lotsCatalog = carto?.lotsCatalog ?? [];
  const currentLotIdx = selectedLot ? lotsCatalog.findIndex((l) => l.id === selectedLot.id) : -1;

  const handleQuickStepLot = (delta: number) => {
    if (lotsCatalog.length === 0) return;
    const base = currentLotIdx >= 0 ? currentLotIdx : 0;
    const nextIdx = (base + delta + lotsCatalog.length) % lotsCatalog.length;
    setSelectedLotId(lotsCatalog[nextIdx].id);
  };

  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      const scopeTag =
        config.scopeMode === 'lot' && selectedLot
          ? `lote-${selectedLot.manzanoCode}-${selectedLot.code}`
          : 'urbanizacion-general';
      link.download = `urbigeo-${scopeTag}-${config.paperSize}-1_${effectiveMainScale}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast('Lámina cartográfica exportada en PNG de alta resolución.', { variant: 'success' });
    } catch (err) {
      console.error('Error al exportar PNG del layout:', err);
      toast('No se pudo exportar la imagen PNG.', { variant: 'error' });
    }
  };

  const handlePrintPdf = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const printWin = window.open('', '_blank', 'width=1280,height=860');
      if (!printWin) {
        toast('Habilitá ventanas emergentes o usá Exportar PNG.', { variant: 'warning' });
        return;
      }
      printWin.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>${config.cadastral.planTitle || 'Lámina UrbiGeo'} — Esc. 1:${effectiveMainScale}</title>
  <style>
    @page {
      size: ${paperDims.widthMm}mm ${paperDims.heightMm}mm;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
  </style>
</head>
<body>
  <img src="${dataUrl}" onload="setTimeout(() => { window.print(); }, 250);" />
</body>
</html>`);
      printWin.document.close();
    } catch (err) {
      console.error('Error al imprimir PDF:', err);
      toast('No se pudo abrir la vista de impresión.', { variant: 'error' });
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="Compositor Profesional CAD/GIS — Carimbos, Viewports y Data-Driven Pages"
      visuallyHiddenTitle
      width="min(1520px, 97vw)"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'min(90vh, 920px)',
          gap: 10,
          color: 'var(--cad-text)',
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 9,
            borderBottom: '1px solid var(--cad-border)',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: 'var(--ui-10-gradient-soft)',
                border: '1px solid rgba(255, 107, 74, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Compass size={18} color="#FF6B4A" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '0.96rem',
                    fontWeight: 700,
                    margin: 0,
                  }}
                >
                  UrbiGeo Layout CAD/GIS
                </h2>
                <span
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: 'rgba(255, 107, 74, 0.16)',
                    border: '1px solid rgba(255, 107, 74, 0.4)',
                    color: '#FF6B4A',
                  }}
                >
                  VP-1 1:{effectiveMainScale.toLocaleString('es-BO')}
                </span>
                <span
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: 'rgba(45, 212, 191, 0.16)',
                    border: '1px solid rgba(45, 212, 191, 0.4)',
                    color: '#2DD4BF',
                  }}
                >
                  VP-2 1:{effectiveLocationScale.toLocaleString('es-BO')}
                </span>
              </div>
              <p style={{ fontSize: '0.65rem', color: 'var(--cad-text-muted)', margin: '2px 0 0 0' }}>
                Editor CAD de Carimbos .DXF · Clic medio = Mover hoja · Guardado persistente de plantillas
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {config.scopeMode === 'lot' && lotsCatalog.length > 0 && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 6px',
                  borderRadius: 8,
                  background: 'var(--cad-bg-deep)',
                  border: '1px solid rgba(45, 212, 191, 0.35)',
                }}
              >
                <button
                  type="button"
                  onClick={() => handleQuickStepLot(-1)}
                  title="Lote anterior"
                  style={{
                    padding: 3,
                    borderRadius: 5,
                    border: 'none',
                    background: 'transparent',
                    color: '#2DD4BF',
                    cursor: 'pointer',
                    display: 'inline-flex',
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="font-mono-cad" style={{ fontSize: '0.67rem', color: 'var(--cad-text)' }}>
                  Lote {selectedLot?.code ?? '1'} ({Math.max(1, currentLotIdx + 1)}/{lotsCatalog.length})
                </span>
                <button
                  type="button"
                  onClick={() => handleQuickStepLot(1)}
                  title="Lote siguiente"
                  style={{
                    padding: 3,
                    borderRadius: 5,
                    border: 'none',
                    background: 'transparent',
                    color: '#2DD4BF',
                    cursor: 'pointer',
                    display: 'inline-flex',
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handlePrintPdf}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                borderRadius: 8,
                border: '1px solid rgba(56, 189, 248, 0.45)',
                background: 'rgba(56, 189, 248, 0.14)',
                color: '#38BDF8',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Printer size={14} />
              <span>Imprimir / PDF</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPng}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 13px',
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.22)',
                background: 'var(--ui-10-gradient)',
                color: '#FFF',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Download size={14} />
              <span>Exportar PNG</span>
            </button>

            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Cerrar compositor"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: '1px solid var(--cad-border)',
                background: 'var(--cad-bg-surface)',
                color: 'var(--cad-text-dim)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Main Split Layout */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '370px 1fr',
            gap: 12,
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Left Sidebar with 3 Structured Tabs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 4,
                padding: 3,
                borderRadius: 9,
                background: 'var(--cad-bg-deep)',
                border: '1px solid var(--cad-border)',
              }}
            >
              {SIDEBAR_TABS.map((t) => {
                const active = sidebarTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSidebarTab(t.id)}
                    style={{
                      padding: '6px 4px',
                      borderRadius: 6,
                      fontSize: '0.64rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: 'none',
                      background: active ? 'var(--cad-bg-surface)' : 'transparent',
                      color: active ? t.accent : 'var(--cad-text-muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
              {sidebarTab === 'paper-style' && <SidebarPaperAndStylePanel />}
              {sidebarTab === 'viewports-elements' && (
                <SidebarViewportsAndElementsPanel
                  lotsCatalog={lotsCatalog}
                  selectedLot={selectedLot}
                  effectiveMainScale={effectiveMainScale}
                  effectiveLocationScale={effectiveLocationScale}
                />
              )}
              {sidebarTab === 'carimbo-extras' && (
                <SidebarCarimboFieldsPanel
                  activeDxfDoc={activeTemplate?.dxfDoc}
                  selectedLot={selectedLot}
                />
              )}
            </div>
          </div>

          {/* Right Preview Stage */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: '#07090E',
              borderRadius: 12,
              border: '1px solid var(--cad-border)',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            {/* Telemetry & Preview Zoom Toolbar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 12px',
                background: 'rgba(16, 18, 26, 0.94)',
                borderBottom: '1px solid var(--cad-border)',
                fontSize: '0.66rem',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--cad-text-dim)' }}>
                  <Grid3x3 size={12} color="#FF6B4A" />
                  <strong>{config.paperSize === 'OFICIO_BOL' ? 'OFICIO' : config.paperSize}</strong> (
                  {paperDims.widthMm.toFixed(0)}×{paperDims.heightMm.toFixed(0)} mm)
                </span>
                {carto && (
                  <>
                    <span className="font-mono-cad" style={{ color: '#2DD4BF' }}>
                      {carto.epsgCode} · E {carto.centroidMetric[0].toFixed(1)} · N {carto.centroidMetric[1].toFixed(1)}
                    </span>
                    <span className="font-mono-cad" style={{ color: 'var(--cad-text-muted)' }}>
                      {formatDms(carto.centroidLonLat[1], true)} · {formatDms(carto.centroidLonLat[0], false)}
                    </span>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <button
                  type="button"
                  onClick={() => setPreviewZoom(previewZoom - 0.2)}
                  title="Alejar lámina"
                  style={{
                    padding: '3px 6px',
                    borderRadius: 5,
                    border: '1px solid var(--cad-border)',
                    background: 'var(--cad-bg-surface)',
                    color: 'var(--cad-text)',
                    cursor: 'pointer',
                  }}
                >
                  <ZoomOut size={12} />
                </button>
                <span className="font-mono-cad" style={{ minWidth: 42, textAlign: 'center', fontSize: '0.65rem' }}>
                  {Math.round(previewZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewZoom(previewZoom + 0.2)}
                  title="Acercar lámina"
                  style={{
                    padding: '3px 6px',
                    borderRadius: 5,
                    border: '1px solid var(--cad-border)',
                    background: 'var(--cad-bg-surface)',
                    color: 'var(--cad-text)',
                    cursor: 'pointer',
                  }}
                >
                  <ZoomIn size={12} />
                </button>
                <button
                  type="button"
                  onClick={resetSheetView}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 7px',
                    borderRadius: 5,
                    border: '1px solid var(--cad-border)',
                    background: 'var(--cad-bg-surface)',
                    color: 'var(--cad-text-dim)',
                    fontSize: '0.64rem',
                    cursor: 'pointer',
                  }}
                >
                  <Maximize2 size={11} />
                  <span>Ajustar</span>
                </button>
              </div>
            </div>

            <InteractiveViewportCanvas canvasRef={canvasRef} renderMetrics={renderMetrics} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
