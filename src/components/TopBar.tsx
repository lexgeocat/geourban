import React, { useRef } from 'react';
import { FolderOpen, Save, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMapStore } from '../store/mapStore';
import { useDrawStore } from '../store/drawStore';
import { useLayerStore } from '../store/layerStore';
import {
  importFile,
  exportProject,
  writeProjectFromOlFeatures,
  readOlFeaturesFromProject,
  type ExportFormat,
} from '../io';
import { refreshSourceMetrics } from '../geo/metrics';
import { useProjectCrsStore, getProjectCrsConfig } from '../store/projectCrsStore';
import { ensureUtmZoneRegistered } from '../geo/utmZones';

const modeLabels: Record<string, { label: string; color: string }> = {
  select: { label: 'SELECCIÓN', color: 'var(--cad-text-dim)' },
  none: { label: 'INACTIVO', color: 'var(--cad-text-muted)' },
};

const IMPORT_ACCEPT = '.geourban,.geojson,.json,.kml,.kmz,.shp,.gpkg,.dxf';

export default function TopBar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zoomIn = useMapStore((s) => s.zoomIn);
  const zoomOut = useMapStore((s) => s.zoomOut);
  const fitToExtent = useMapStore((s) => s.fitToExtent);
  const drawSource = useMapStore((s) => s.drawSource);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const mode = useDrawStore((s) => s.mode);
  const baseMap = useLayerStore((s) => s.baseMap);
  const statsPanelVisible = useLayerStore((s) => s.statsPanelVisible);
  const setStatsPanelVisible = useLayerStore((s) => s.setStatsPanelVisible);
  const modeInfo = modeLabels[mode] || modeLabels.none;

const getCurrentProject = () => {
  const features = drawSource?.getFeatures() ?? [];
  const project = writeProjectFromOlFeatures(features);
  project.name = 'Proyecto GeoUrban';
  project.baseMap = baseMap;
  project.view = { center: viewConfig.center, zoom: viewConfig.zoom };
  project.crs = getProjectCrsConfig(); // CRS viaja con el archivo
  return project;
};

const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  if (!file || !drawSource) return;
  try {
    const { project, warnings } = await importFile(file);
    // Solo un .geourban trae config de CRS propia; los demás formatos
    // (geojson/kml/shp/dxf) usan el CRS YA configurado del proyecto activo.
    if (file.name.toLowerCase().endsWith('.geourban')) {
      useProjectCrsStore.getState().loadConfig(project.crs);
    }
    const features = readOlFeaturesFromProject(project);
    drawSource.clear();
    drawSource.addFeatures(features as never);
    refreshSourceMetrics(drawSource);
    drawSource.changed();
    fitToExtent();
    if (warnings.length) alert(warnings.join('\n'));
  } catch (err) {
    console.error(err);
    alert(err instanceof Error ? err.message : 'Error al importar archivo');
  } finally {
    event.target.value = '';
  }
};

const handleExport = async (format: ExportFormat) => {
  try {
    const result = await exportProject(getCurrentProject(), format, 'geourban-proyecto');
    if (result?.message) alert(result.message);
  } catch (err) {
    console.error(err);
    alert(err instanceof Error ? err.message : 'Error al exportar');
  }
};
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 'var(--cad-topbar-height)',
        background: 'var(--cad-bg-deep)',
        borderBottom: '1px solid var(--cad-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: 'linear-gradient(135deg, var(--cad-accent), var(--cad-accent-violet))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 10px rgba(0, 212, 255, 0.3)',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 14, height: 14 }}
          >
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
          </svg>
        </div>
        <span
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: 'var(--cad-text)',
          }}
        >
          Geo<span style={{ color: 'var(--cad-accent)' }}>Urban</span>
        </span>

        <div style={{ width: 1, height: 16, background: 'var(--cad-border)', margin: '0 4px' }} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            borderRadius: 4,
            background: 'var(--cad-bg-surface)',
            border: '1px solid var(--cad-border)',
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: modeInfo.color,
              boxShadow:
                mode === 'polyline' ? '0 0 6px var(--cad-accent)' : 'none',
            }}
          />
          <span
            className="font-mono-cad"
            style={{
              fontSize: '0.6rem',
              fontWeight: 500,
              letterSpacing: '0.08em',
              color: modeInfo.color,
            }}
          >
            {modeInfo.label}
          </span>
        </div>

        <div style={{ width: 1, height: 16, background: 'var(--cad-border)' }} />

        <input
          ref={fileInputRef}
          type="file"
          accept={IMPORT_ACCEPT}
          hidden
          onChange={handleImport}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          title="Importar"
        >
          <FolderOpen size={14} />
          Importar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleExport('geourban')}
          title="Guardar .geourban"
        >
          <Save size={14} />
          Guardar
        </Button>
         <select
          defaultValue=""
          onChange={(e) => {
            const fmt = e.target.value as ExportFormat;
            if (fmt) void handleExport(fmt);
            e.target.value = '';
          }}
          title="Exportar"
          style={{
            height: 30,
            background: 'transparent',
            border: '1px solid var(--cad-border)',
            borderRadius: 6,
            color: 'var(--cad-text-dim)',
            fontSize: '0.75rem',
            padding: '0 6px',
            cursor: 'pointer',
          }}
        >
          <option value="" disabled>
            ⬇ Exportar…
          </option>
          <option value="geojson">GeoJSON (.geojson)</option>
          <option value="kml">KML (.kml)</option>
          <option value="kmz">KMZ (.kmz)</option>
          <option value="shp">Shapefile (.shp)</option>
          <option value="dxf">DXF (.dxf)</option>
        </select>

        <div style={{ width: 1, height: 16, background: 'var(--cad-border)' }} />

        <button
          onClick={() => setStatsPanelVisible(!statsPanelVisible)}
          className="cad-icon-btn cad-tooltip-bottom cad-tooltip"
          data-tooltip="Estadísticas"
          aria-label="Estadísticas"
          style={{
            width: 28,
            height: 28,
            color: statsPanelVisible ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
            opacity: statsPanelVisible ? 1 : 0.5,
          }}
        >
          <BarChart3 size={15} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button
          onClick={zoomOut}
          className="cad-icon-btn cad-tooltip-bottom cad-tooltip"
          data-tooltip="Alejar"
          aria-label="Alejar"
          style={{ width: 28, height: 28 }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button
          onClick={fitToExtent}
          className="cad-icon-btn cad-tooltip-bottom cad-tooltip"
          data-tooltip="Centrar vista"
          aria-label="Centrar vista"
          style={{ width: 28, height: 28 }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
        </button>
        <button
          onClick={zoomIn}
          className="cad-icon-btn cad-tooltip-bottom cad-tooltip"
          data-tooltip="Acercar"
          aria-label="Acercar"
          style={{ width: 28, height: 28 }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
      </div>
    </div>
  );
}
