import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useMapStore } from '@map-core/store/mapStore';
import { useStreetStore, type Street } from '@vias-engine/store/streetStore';
import { useRoundaboutStore, type Roundabout } from '@vias-engine/store/roundaboutStore';
import { useRoadCornerStore } from '@vias-engine/store/roadCornerStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useProjectCrsStore } from '@georef-engine/store/projectCrsStore';
import { projectPathToMetricPlane } from '@georef-engine/metrics';
import { getLayerSuggestion } from '@kernel/domain-model/featureModel';
import { computeRoadNetworkNetInWorker } from '@kernel/native/geoWorkerClient';
import { useDrawSourceTick } from '@shared-ui/hooks/useDrawSourceTick';
import { toast } from '@shared-ui/store/toastStore';
import urbigeoIconUrl from '@/assets/urbigeo-icon.png';
import { EMPTY_SHEET_FALLBACK } from '../dxf/builtinTemplates';
import {
  extractProjectCartography,
  formatDms,
  type MetricRoadNetworkGroup,
} from '../extractors/cartographyExtractor';
import { getEffectivePaperDimensionsMm } from '../model/layoutTypes';
import { prefetchOsmTilesForLocation } from '../renderers/cartographicPrimitives';
import {
  renderCartographicSheet,
  type SheetCameraInput,
  type SheetRenderResult,
} from '../renderers/sheetRenderer';
import { useLayoutStore } from '../store/layoutStore';
import InteractiveViewportCanvas from './InteractiveViewportCanvas';
import { registerLayoutExportHandlers } from './layoutExportBridge';
import SidebarCarimboFieldsPanel from './SidebarCarimboFieldsPanel';
import SidebarPaperAndStylePanel from './SidebarPaperAndStylePanel';
import SidebarViewportsAndElementsPanel from './SidebarViewportsAndElementsPanel';

type SidebarTabId = 'paper-style' | 'viewports-elements' | 'carimbo-extras';

const SIDEBAR_TABS: Array<{ id: SidebarTabId; label: string; accent: string }> = [
  { id: 'paper-style', label: 'Plantillas', accent: '#A78BFA' },
  { id: 'viewports-elements', label: 'Viewports', accent: '#38BDF8' },
  { id: 'carimbo-extras', label: 'Carimbo', accent: '#FF6B4A' },
];

export default function LayoutWorkspaceView() {
  const drawSource = useMapStore((s) => s.drawSource);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const streets = useStreetStore((s) => s.streets);
  const roundabouts = useRoundaboutStore((s) => s.roundabouts);
  const cornerMode = useRoadCornerStore((s) => s.mode);
  const layers = useLayersStore((s) => s.layers);
  const crsMode = useProjectCrsStore((s) => s.mode);
  const utmZone = useProjectCrsStore((s) => s.utmZone);
  const utmHemisphere = useProjectCrsStore((s) => s.utmHemisphere);

  const templates = useLayoutStore((s) => s.templates);
  const activeTemplateId = useLayoutStore((s) => s.activeTemplateId);
  const config = useLayoutStore((s) => s.config);
  const previewZoom = useLayoutStore((s) => s.previewZoom);
  const sheetPanPx = useLayoutStore((s) => s.sheetPanPx);
  const setSelectedLotId = useLayoutStore((s) => s.setSelectedLotId);
  const importCustomDxf = useLayoutStore((s) => s.importCustomDxf);

  const tick = useDrawSourceTick(drawSource);

  const [sidebarTab, setSidebarTab] = useState<SidebarTabId>('paper-style');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tileTick, setTileTick] = useState<number>(0);
  const [metricRoadNets, setMetricRoadNets] = useState<MetricRoadNetworkGroup[]>([]);
  const [stageSize, setStageSize] = useState<{ width: number; height: number; dpr: number }>({
    width: 0,
    height: 0,
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  });
  const [renderMetrics, setRenderMetrics] = useState<SheetRenderResult | null>(null);

  const handleStageResize = useCallback((size: { width: number; height: number; dpr: number }) => {
    setStageSize((prev) =>
      prev.width === size.width && prev.height === size.height && prev.dpr === size.dpr
        ? prev
        : size
    );
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const brandImgRef = useRef<HTMLImageElement | null>(null);
  const dxfInputRef = useRef<HTMLInputElement | null>(null);

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

  const baseCarto = useMemo(() => {
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
  }, [tick, drawSource, streets, roundabouts, layers, crsMode, utmZone, utmHemisphere, viewConfig.center]);

  useEffect(() => {
    let cancelled = false;
    const byId = new Map(layers.map((l) => [l.id, l] as const));
    const defaultViaLayer = layers.find((l) => l.kind === 'via');
    const defaultRbLayer = layers.find((l) => l.kind === 'rotonda') ?? defaultViaLayer;

    const groups = new Map<
      string,
      { layerId: string; color: string; opacity: number; streets: Street[]; roundabouts: Roundabout[] }
    >();

    const ensureGroup = (key: string, color: string, opacity: number) => {
      let g = groups.get(key);
      if (!g) {
        g = { layerId: key, color, opacity, streets: [], roundabouts: [] };
        groups.set(key, g);
      }
      return g;
    };

    for (const s of streets) {
      const lyr = (s.layerId ? byId.get(s.layerId) : undefined) ?? defaultViaLayer;
      if (lyr && !lyr.visible) continue;
      const g = ensureGroup(
        lyr?.id ?? '__default_via__',
        lyr?.color ?? getLayerSuggestion('via')?.color ?? '#8b5cf6',
        lyr?.opacity ?? 1
      );
      g.streets.push(s);
    }

    for (const rb of roundabouts) {
      const lyr = (rb.layerId ? byId.get(rb.layerId) : undefined) ?? defaultRbLayer;
      if (lyr && !lyr.visible) continue;
      // Asociar rotonda al mismo grupo de calles si ya existe alguno, para unión limpia en intersecciones
      const targetGroup =
        (lyr && groups.get(lyr.id)) ??
        Array.from(groups.values())[0] ??
        ensureGroup(
          lyr?.id ?? '__default_rb__',
          lyr?.color ?? getLayerSuggestion('rotonda')?.color ?? '#f78166',
          lyr?.opacity ?? 1
        );
      targetGroup.roundabouts.push(rb);
    }

    const groupList = Array.from(groups.values());
    if (groupList.length === 0) {
      return;
    }

    void (async () => {
      const computed: MetricRoadNetworkGroup[] = [];
      for (const grp of groupList) {
        try {
          const net = await computeRoadNetworkNetInWorker(grp.streets, grp.roundabouts, cornerMode);
          const projectPolys = (polys: [number, number][][][]): [number, number][][][] =>
            polys.map((rings) =>
              rings.map((ring) =>
                projectPathToMetricPlane(ring.map((p) => [p[0], p[1]]))
              )
            );
          computed.push({
            layerId: grp.layerId,
            color: grp.color,
            opacity: grp.opacity,
            outerPolygons: projectPolys(net.outer),
            roadPolygons: projectPolys(net.road),
          });
        } catch {
          // En preview web sin Tauri se usa el fallback vectorial automáticamente
        }
      }
      if (!cancelled) {
        setMetricRoadNets(computed);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [streets, roundabouts, layers, cornerMode, crsMode, utmZone, utmHemisphere]);

  const carto = useMemo(
    () => ({
      ...baseCarto,
      roadNets: streets.length === 0 && roundabouts.length === 0 ? [] : metricRoadNets,
    }),
    [baseCarto, metricRoadNets, streets.length, roundabouts.length]
  );

  const selectedLot = useMemo(() => {
    if (!carto || carto.lotsCatalog.length === 0) return null;
    if (config.selectedLotId) {
      const found = carto.lotsCatalog.find((l) => l.id === config.selectedLotId);
      if (found) return found;
    }
    return carto.lotsCatalog[0];
  }, [carto, config.selectedLotId]);

  useEffect(() => {
    if (!carto || !config.display.showLocationOsmTiles) return;
    const [lon, lat] = carto.centroidLonLat;
    for (const z of [13, 14, 15, 16]) {
      prefetchOsmTilesForLocation(lon, lat, z, () => {
        setTileTick((t) => t + 1);
      });
    }
  }, [carto, config.display.showLocationOsmTiles]);

  useEffect(() => {
    if (!carto || !canvasRef.current || !activeTemplate) return;
    void tileTick;
    const camera: SheetCameraInput | undefined =
      stageSize.width > 0 && stageSize.height > 0
        ? {
            stageCssWidth: stageSize.width,
            stageCssHeight: stageSize.height,
            dpr: stageSize.dpr,
            previewZoom,
            sheetPanPx,
          }
        : undefined;
    const metrics = renderCartographicSheet({
      canvas: canvasRef.current,
      carto,
      config,
      template: activeTemplate,
      selectedLot,
      brandIcon: brandImgRef.current,
      camera,
    });
    setRenderMetrics(metrics);
  }, [carto, config, activeTemplate, selectedLot, tileTick, stageSize, previewZoom, sheetPanPx]);

  const effectiveMainScale = renderMetrics?.effectiveMainScale ?? config.mainViewport.scaleDenominator;
  const effectiveLocationScale =
    renderMetrics?.effectiveLocationScale ?? config.locationViewport.scaleDenominator;
  const paperDims = getEffectivePaperDimensionsMm(config);

  const lotsCatalog = useMemo(() => carto?.lotsCatalog ?? [], [carto]);
  const currentLotIdx = selectedLot ? lotsCatalog.findIndex((l) => l.id === selectedLot.id) : -1;

  useEffect(() => {
    const stepLot = (delta: number) => {
      if (lotsCatalog.length === 0) return;
      const base = currentLotIdx >= 0 ? currentLotIdx : 0;
      const nextIdx = (base + delta + lotsCatalog.length) % lotsCatalog.length;
      setSelectedLotId(lotsCatalog[nextIdx].id);
    };

    const renderExportDataUrl = (): string | null => {
      if (!carto || !activeTemplate) return null;
      const exportCanvas = document.createElement('canvas');
      renderCartographicSheet({
        canvas: exportCanvas,
        carto,
        config,
        template: activeTemplate,
        selectedLot,
        brandIcon: brandImgRef.current,
      });
      return exportCanvas.toDataURL('image/png', 1.0);
    };

    const exportPng = () => {
      try {
        const dataUrl = renderExportDataUrl();
        if (!dataUrl) return;
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

    const printPdf = () => {
      try {
        const dataUrl = renderExportDataUrl();
        if (!dataUrl) return;
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

    registerLayoutExportHandlers({
      exportPng,
      printPdf,
      openDxfPicker: () => dxfInputRef.current?.click(),
      stepLot,
    });

    return () => {
      registerLayoutExportHandlers(null);
    };
  }, [
    activeTemplate,
    carto,
    config,
    currentLotIdx,
    effectiveMainScale,
    lotsCatalog,
    paperDims.heightMm,
    paperDims.widthMm,
    selectedLot,
    setSelectedLotId,
  ]);

  const handleDxfFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (text.includes('\uFFFD')) {
        text = new TextDecoder('windows-1252').decode(buf);
      }
      if (!text.includes('SECTION') && !text.includes('ENTITIES')) {
        toast('El archivo no parece ser un DXF ASCII válido (guardalo como DXF ASCII en AutoCAD/QGIS).', {
          variant: 'warning',
          durationMs: 6000,
        });
        return;
      }
      const created = importCustomDxf(file.name, text);
      setSidebarTab('paper-style');
      toast(`Carimbo "${created.name}" integrado y guardado en tus plantillas.`, {
        variant: 'success',
        durationMs: 4500,
      });
    } catch (err) {
      console.error('Error al importar plantilla DXF:', err);
      toast('No se pudo leer el archivo .dxf seleccionado.', { variant: 'error' });
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: '#07090E',
        color: 'var(--cad-text)',
        overflow: 'hidden',
      }}
    >
      <input
        ref={dxfInputRef}
        type="file"
        accept=".dxf"
        style={{ display: 'none' }}
        onChange={handleDxfFileChange}
      />

      {/* Panel lateral izquierdo acoplado al Layout */}
      <aside
        style={{
          width: sidebarCollapsed ? 36 : 296,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(13, 16, 23, 0.96)',
          borderRight: '1px solid var(--cad-border)',
          transition: 'width 160ms ease',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarCollapsed ? 'center' : 'space-between',
            padding: '7px 9px',
            borderBottom: '1px solid var(--cad-border)',
            background: 'rgba(9, 12, 18, 0.9)',
          }}
        >
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#38BDF8', letterSpacing: '0.02em' }}>
                Inspector de Lámina
              </span>
              {carto && (
                <span className="font-mono-cad" style={{ fontSize: '0.58rem', color: 'var(--cad-text-muted)' }}>
                  {carto.epsgCode} · E {carto.centroidMetric[0].toFixed(0)} · N {carto.centroidMetric[1].toFixed(0)}
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            title={sidebarCollapsed ? 'Expandir inspector de lámina' : 'Contraer inspector'}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              border: '1px solid var(--cad-border)',
              background: 'var(--cad-bg-surface)',
              color: 'var(--cad-text-dim)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 8px 10px', flex: 1, minHeight: 0 }}>
            {/* Tabs del inspector */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 4,
                padding: 3,
                borderRadius: 9,
                background: 'var(--cad-bg-deep)',
                border: '1px solid var(--cad-border)',
                flexShrink: 0,
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
                      fontSize: '0.62rem',
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

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 3 }}>
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

            {carto && (
              <div
                className="font-mono-cad"
                style={{
                  fontSize: '0.58rem',
                  color: 'var(--cad-text-muted)',
                  borderTop: '1px solid var(--cad-border)',
                  paddingTop: 5,
                  textAlign: 'center',
                }}
              >
                {formatDms(carto.centroidLonLat[1], true)} · {formatDms(carto.centroidLonLat[0], false)}
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Escenario interactivo CAD/GIS de la Lámina */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <InteractiveViewportCanvas
          canvasRef={canvasRef}
          renderMetrics={renderMetrics}
          onStageResize={handleStageResize}
        />
      </main>
    </div>
  );
}
