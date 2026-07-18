import React, { useRef, useState } from 'react';
import {
  ChevronUp,
  Trash2,
  Layers as LayersIcon,
  Map as MapIcon,
  Eye,
  Settings2,
  Save,
  FolderOpen,
  Download,
  FilePlus,
  LogOut,
  Info,
  BarChart3,
  ChevronRight,
} from 'lucide-react';
import { useMapStore } from '../store/mapStore';
import { useDrawStore, type DrawMode } from '../store/drawStore';
import {
  useLayerStore,
  type RibbonTabId,
} from '../store/layerStore';
import { useCommandStack } from '../commands/CommandStack';
import { ClearFeaturesCommand } from '../commands/ClearFeaturesCommand';
import { AddFeaturesCommand } from '../commands/AddFeaturesCommand';
import { useSelectionStore } from '../store/selectionStore';
import { useSubdivisionStore } from '../store/subdivisionStore';
import { useStreetStore } from '../store/streetStore';
import { useTransformBridge } from '../store/transformBridge';
import { GenerateLotsCommand } from '../commands/GenerateLotsCommand';
import {
  copySelected,
  rotateSelected,
  scaleSelected,
  mirrorSelected,
} from '../commands/editOperations';
import {
  importFile,
  exportProject,
  writeProjectFromOlFeatures,
  readOlFeaturesFromProject,
  type ExportFormat,
} from '../io';
import { refreshSourceMetrics } from '../geo/metrics';
import {
  useProjectCrsStore,
  getProjectCrsConfig,
} from '../store/projectCrsStore';
import { BASE_MAP_DEFS, type BaseMapId } from '../map/baseMaps';

/* ================================================================
   Import accept list (formats supported by io/importers)
   ================================================================ */
const IMPORT_ACCEPT = '.geourban,.geojson,.json,.kml,.kmz,.shp,.gpkg,.dxf';

/* ================================================================
   SVG Icon Set (inline)
   ================================================================ */

const IconCursor = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    <path d="M13 13l6 6" />
  </svg>
);
const IconPolygon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l8.5 6.2-3.2 9.8H6.7L3.5 8.2z" />
  </svg>
);
const IconLine = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="20" x2="20" y2="4" />
  </svg>
);
const IconRect = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="6" width="16" height="12" />
  </svg>
);
const IconRectDashed = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="6" width="16" height="12" strokeDasharray="3 2" />
  </svg>
);
const IconLasso = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 18 Q12 4 20 18" strokeDasharray="3 2" />
    <circle cx="4" cy="18" r="1.5" fill="currentColor" />
  </svg>
);
const IconCircle = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8" />
  </svg>
);
const IconArc = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 18 A10 10 0 0 1 20 10" />
  </svg>
);
const IconText = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </svg>
);
const IconStreet = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19L8 5" />
    <path d="M16 5l4 14" />
    <path d="M6 10h12" />
    <path d="M5 14h14" />
  </svg>
);
const IconEraser = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </svg>
);
const IconGreen = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22c5.5 0 10-4.5 10-10S17.5 2 12 2 2 6.5 2 12s4.5 10 10 10z" />
    <path d="M12 8v8" />
    <path d="M8 12h8" />
  </svg>
);
const IconEquip = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 9h6" />
    <path d="M9 12h6" />
    <path d="M9 15h4" />
  </svg>
);
const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);
const IconMerge = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v3a4 4 0 0 0 4 4 4 4 0 0 1 4 4v3" />
    <path d="M4 7h4" />
    <path d="M16 17h4" />
    <path d="m19 14 2 3-2 3" />
    <path d="m5 4-2 3 2 3" />
  </svg>
);
const IconSubdivide = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);
const IconLots = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="9" height="9" rx="1" />
    <rect x="13" y="2" width="9" height="9" rx="1" />
    <rect x="2" y="13" width="9" height="9" rx="1" />
    <rect x="13" y="13" width="9" height="9" rx="1" />
  </svg>
);
const IconCopy = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const IconRotate = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);
const IconScale = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const IconMirror = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="3" x2="12" y2="21" />
    <path d="M3 8h7a4 4 0 0 1 0 8H3" />
    <path d="M14 8h7a4 4 0 0 1 0 8h-7" />
  </svg>
);
const IconGrid = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);
const IconSat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);
const IconRoad = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 22L8 2" />
    <path d="M16 2l4 20" />
    <path d="M12 6v2M12 12v2M12 18v2" />
  </svg>
);
const IconAlertTriangle = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const IconAlertCircle = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

/* ================================================================
   Ribbon Tab definitions
   ================================================================ */
const RIBBON_TABS: { id: RibbonTabId; label: string; icon: React.ReactNode }[] = [
  { id: 'map', label: 'Mapa', icon: <MapIcon size={12} /> },
  { id: 'edit', label: 'Editar', icon: <IconEdit /> },
  { id: 'insert', label: 'Insertar', icon: <IconStreet /> },
  { id: 'view', label: 'Vista', icon: <Eye size={12} /> },
];

/* ================================================================
   Ribbon context (so RibbonTool children can read current mode
   without each call site having to thread props).
   ================================================================ */

const RibbonContext = React.createContext<{
  currentMode: DrawMode;
  setMode: (m: DrawMode) => void;
} | null>(null);

function useRibbonCtx() {
  const ctx = React.useContext(RibbonContext);
  if (!ctx) throw new Error('RibbonContext missing');
  return ctx;
}

/* ================================================================
   Ribbon helpers (defined at module scope, NOT inside TopBar, to
   satisfy react-hooks/static-components rule).
   ================================================================ */

type RibbonToolProps = {
  mode?: DrawMode;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
};

function RibbonTool({
  mode: tMode,
  icon,
  label,
  shortcut,
  disabled,
  active,
  badge,
  onClick,
}: RibbonToolProps) {
  const { currentMode, setMode } = useRibbonCtx();
  const isActive = active ?? (tMode ? currentMode === tMode : false);
  const tip = shortcut ? `${label} (${shortcut})` : label;
  const handle = () => {
    if (onClick) onClick();
    else if (tMode) setMode(tMode);
  };
  return (
    <button
      onClick={handle}
      disabled={disabled}
      className={`ribbon-tool ${isActive ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      data-tooltip={tip}
      aria-label={tip}
      title={tip}
    >
      {icon}
      <span className="ribbon-tool-label">{label}</span>
      {badge != null && badge > 0 && <span className="ribbon-tool-badge">{badge}</span>}
    </button>
  );
}

function RibbonGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-items">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  );
}

/* ================================================================
   Component
   ================================================================ */

export default function TopBar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [exportSubmenuOpen, setExportSubmenuOpen] = useState(false);
  const appMenuRef = useRef<HTMLDivElement>(null);

  // Close app menu on outside click
  React.useEffect(() => {
    if (!appMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (appMenuRef.current && !appMenuRef.current.contains(e.target as Node)) {
        setAppMenuOpen(false);
        setExportSubmenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [appMenuOpen]);

  const drawSource = useMapStore((s) => s.drawSource);
  const fitToExtent = useMapStore((s) => s.fitToExtent);
  const viewConfig = useMapStore((s) => s.viewConfig);

  const mode = useDrawStore((s) => s.mode);
  const setMode = useDrawStore((s) => s.setMode);
  const setAreaKind = useDrawStore((s) => s.setAreaKind);

  const baseMap = useLayerStore((s) => s.baseMap);
  const setBaseMap = useLayerStore((s) => s.setBaseMap);
  const workVisibility = useLayerStore((s) => s.workVisibility);
  const setWorkVisibility = useLayerStore((s) => s.setWorkVisibility);
  const statsPanelVisible = useLayerStore((s) => s.statsPanelVisible);
  const setStatsPanelVisible = useLayerStore((s) => s.setStatsPanelVisible);
  const activeTab = useLayerStore((s) => s.activeTab);
  const setActiveTab = useLayerStore((s) => s.setActiveTab);
  const ribbonCollapsed = useLayerStore((s) => s.ribbonCollapsed);
  const setRibbonCollapsed = useLayerStore((s) => s.setRibbonCollapsed);
  const propsPanelVisible = useLayerStore((s) => s.panelVisibility.properties);

  const selectedCount = useSelectionStore((s) => s.selectedIds.size);
  const primarySelected = useSelectionStore((s) => s.primaryId !== null);
  const selectMode = useSelectionStore((s) => s.selectMode);
  const setSelectMode = useSelectionStore((s) => s.setSelectMode);

  const openSubdivision = useSubdivisionStore((s) => s.open);
  const defaultWidthM = useStreetStore((s) => s.defaultWidthM);
  const setDefaultWidth = useStreetStore((s) => s.setDefaultWidth);
  const clearStreets = useStreetStore((s) => s.clearStreets);
  const streets = useStreetStore((s) => s.streets);

  const [lotsBusy, setLotsBusy] = React.useState(false);
  const [mergeBusy, setMergeBusy] = React.useState(false);

  /* ─── Project I/O ─── */
  const getCurrentProject = () => {
    const features = drawSource?.getFeatures() ?? [];
    const project = writeProjectFromOlFeatures(features);
    project.name = 'Proyecto GeoUrban';
    project.baseMap = baseMap;
    project.view = { center: viewConfig.center, zoom: viewConfig.zoom };
    project.crs = getProjectCrsConfig();
    return project;
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !drawSource) return;
    try {
      const { project, warnings } = await importFile(file);
      if (file.name.toLowerCase().endsWith('.geourban')) {
        useProjectCrsStore.getState().loadConfig(project.crs);
      }
      const features = readOlFeaturesFromProject(project);
      const commandStack = useCommandStack.getState();
      await commandStack.run(new ClearFeaturesCommand());
      await commandStack.run(new AddFeaturesCommand(features));
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
    setAppMenuOpen(false);
    setExportSubmenuOpen(false);
    try {
      const result = await exportProject(getCurrentProject(), format, 'geourban-proyecto');
      if (result?.message) alert(result.message);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Error al exportar');
    }
  };

  const handleSave = async () => {
    setAppMenuOpen(false);
    await handleExport('geourban');
  };

  const handleImportClick = () => {
    setAppMenuOpen(false);
    fileInputRef.current?.click();
  };

  const handleNewProject = async () => {
    setAppMenuOpen(false);
    const ok = window.confirm(
      '¿Crear un nuevo proyecto? Se borrarán todos los features del mapa actual.',
    );
    if (!ok || !drawSource) return;
    await useCommandStack.getState().run(new ClearFeaturesCommand());
    refreshSourceMetrics(drawSource);
    drawSource.changed();
    useSelectionStore.getState().clear();
  };

  const handleExit = () => {
    setAppMenuOpen(false);
    // Para una PWA/web no hay un "salir" real; informamos al usuario.
    window.alert(
      'GeoUrban se ejecuta en el navegador. Para salir, cerrá la pestaña o la ventana.',
    );
  };

  const handleAbout = () => {
    setAppMenuOpen(false);
    window.alert(
      'GeoUrban v0.1\n\nEditor CAD/GIS client-side para planificación urbana.\nConstruido con React + TypeScript + OpenLayers + Tauri.\n\n© 2026',
    );
  };

  const handleDeleteSelected = () => {
    const removed = useMapStore.getState().deleteSelected();
    if (removed === 0 && primarySelected) {
      useSelectionStore.getState().clear();
    }
  };

  const handleMergeSelected = async () => {
    if (mergeBusy) return;
    setMergeBusy(true);
    try {
      const newId = await useMapStore.getState().mergeSelected();
      if (newId) {
        useSelectionStore.getState().setSelection([newId], newId);
      } else {
        alert('Necesitás seleccionar al menos 2 polígonos contiguos para fusionar.');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al fusionar');
    } finally {
      setMergeBusy(false);
    }
  };

  const handleFindOverlaps = async () => {
    const src = useMapStore.getState().drawSource;
    if (!src) return;
    try {
      const GeoJSON = (await import('ol/format/GeoJSON')).default;
      const format = new GeoJSON();
      const features = src.getFeatures().map((f) => {
        return format.writeFeatureObject(f, {
          featureProjection: 'EPSG:3857',
          dataProjection: 'EPSG:3857',
        });
      });
      const { findOverlapsInWorker } = await import('../workers/geoWorkerClient');
      const overlaps = await findOverlapsInWorker({ type: 'FeatureCollection', features });
      if (overlaps.length > 0) {
        alert(`Se detectaron ${overlaps.length} superposiciones:\n${overlaps.map((o: any) => `Lote ${o.indexA} ↔ Lote ${o.indexB}: ${o.area.toFixed(2)} m²`).join('\n')}`);
      } else {
        alert('No se detectaron superposiciones.');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al validar superposiciones');
    }
  };

  const handleFindGaps = async () => {
    const src = useMapStore.getState().drawSource;
    if (!src) return;
    try {
      const GeoJSON = (await import('ol/format/GeoJSON')).default;
      const format = new GeoJSON();
      const features = src.getFeatures().map((f) => {
        return format.writeFeatureObject(f, {
          featureProjection: 'EPSG:3857',
          dataProjection: 'EPSG:3857',
        });
      });
      const { findGapsInWorker } = await import('../workers/geoWorkerClient');
      const gaps = await findGapsInWorker({ type: 'FeatureCollection', features });
      if (gaps.features.length > 0) {
        alert(`Se detectaron ${gaps.features.length} huecos.`);
      } else {
        alert('No se detectaron huecos.');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al validar huecos');
    }
  };

  const handleOpenSubdivision = () => {
    const primaryId = useSelectionStore.getState().primaryId;
    if (!primaryId) {
      alert('Seleccioná un polígono para subdividir.');
      return;
    }
    openSubdivision(primaryId);
  };

  const handleGenerateLots = async () => {
    if (lotsBusy) return;
    const src = useMapStore.getState().drawSource;
    if (!src) return;
    let manzanoCount = 0;
    src.forEachFeature((f) => {
      if (f.get('type') === 'manzana') manzanoCount++;
    });
    if (manzanoCount === 0) {
      alert('No hay manzanos para subdividir. Trazá calles primero para generar manzanos.');
      return;
    }
    setLotsBusy(true);
    try {
      const result = await useCommandStack
        .getState()
        .run(new GenerateLotsCommand({ targetAreaM2: 250, frontMinM: 12 }));
      if (!result.ok) {
        alert(result.error);
        return;
      }
      let newLotes = 0;
      src.forEachFeature((f) => {
        const k = (f.get('kind') as string | undefined) ?? (f.get('type') as string | undefined);
        if (k === 'lote' || (typeof f.get('label') === 'string' && f.get('label')?.toString().startsWith('Lote'))) {
          newLotes++;
        }
      });
      if (newLotes > 0) alert(`${newLotes} lotes generados automáticamente.`);
      else alert('No se pudieron generar lotes. Verificá que los manzanos sean lo suficientemente grandes.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al generar lotes');
    } finally {
      setLotsBusy(false);
    }
  };

  const handleToggleEdit = () => {
    if (mode === 'edit') {
      setMode('select');
      return;
    }
    const primaryId = useSelectionStore.getState().primaryId;
    if (!primaryId) {
      alert('Seleccioná un polígono para editar sus vértices.');
      return;
    }
    setMode('edit');
  };

  /* ─── Edit Engine: Copy / Rotate / Scale / Mirror ─── */
  const handleCopy = async () => {
    const ok = await copySelected();
    if (!ok) alert('Seleccioná al menos un feature para copiar.');
  };

  const handleRotate = () => {
    if (useSelectionStore.getState().selectedIds.size === 0) {
      alert('Seleccioná al menos un feature para rotar.');
      return;
    }
    useTransformBridge.getState().setHandler({
      kind: 'rotate',
      apply: async (angle, anchor) => { await rotateSelected(angle, anchor); },
      cancel: () => setMode('select'),
    });
    setMode('rotate');
  };

  const handleScale = () => {
    if (useSelectionStore.getState().selectedIds.size === 0) {
      alert('Seleccioná al menos un feature para escalar.');
      return;
    }
    useTransformBridge.getState().setHandler({
      kind: 'scale',
      apply: async (factor, anchor) => { await scaleSelected(factor, anchor); },
      cancel: () => setMode('select'),
    });
    setMode('scale');
  };

  const handleMirror = () => {
    if (useSelectionStore.getState().selectedIds.size === 0) {
      alert('Seleccioná al menos un feature para reflejar.');
      return;
    }
    useTransformBridge.getState().setHandler({
      kind: 'mirror',
      apply: async (a, b) => { await mirrorSelected(a, b); },
      cancel: () => setMode('select'),
    });
    setMode('mirror');
  };

  /* ─── Render: topbar ─── */
  return (
    <div className="topbar-root">
      {/* Hidden file input (used by Importar menu item) */}
      <input
        ref={fileInputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        onChange={handleImport}
      />

      {/* ═══════════════ TAB STRIP ═══════════════ */}
      <div className="topbar-tabs">
        {/* GU app menu (left of tabs) */}
        <div ref={appMenuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <button
            className={`topbar-app-menu ${appMenuOpen ? 'open' : ''}`}
            onClick={() => setAppMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={appMenuOpen}
            aria-label="Menú principal"
            title="Menú principal"
          >
            <span>GU</span>
            <svg className="app-menu-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {appMenuOpen && (
            <div
              className="app-menu-panel cad-panel-glass animate-fade-in"
              role="menu"
            >
              <button
                role="menuitem"
                className="app-menu-item"
                onClick={handleNewProject}
              >
                <FilePlus />
                <span>Nuevo proyecto</span>
                <span className="app-menu-shortcut">Ctrl+N</span>
              </button>

              <button
                role="menuitem"
                className="app-menu-item"
                onClick={handleImportClick}
              >
                <FolderOpen />
                <span>Importar…</span>
                <span className="app-menu-shortcut">Ctrl+O</span>
              </button>

              <button
                role="menuitem"
                className="app-menu-item"
                onClick={handleSave}
              >
                <Save />
                <span>Guardar</span>
                <span className="app-menu-shortcut">Ctrl+S</span>
              </button>

              <div
                className="app-menu-item has-submenu"
                onMouseEnter={() => setExportSubmenuOpen(true)}
                onMouseLeave={() => setExportSubmenuOpen(false)}
              >
                <Download />
                <span>Exportar</span>
                <ChevronRight className="app-menu-caret" />
                {exportSubmenuOpen && (
                  <div className="app-menu-submenu">
                    {([
                      { fmt: 'geourban' as ExportFormat, label: 'GeoUrban (.geourban)' },
                      { fmt: 'geojson' as ExportFormat, label: 'GeoJSON (.geojson)' },
                      { fmt: 'kml' as ExportFormat, label: 'KML (.kml)' },
                      { fmt: 'kmz' as ExportFormat, label: 'KMZ (.kmz)' },
                      { fmt: 'shp' as ExportFormat, label: 'Shapefile (.shp)' },
                      { fmt: 'dxf' as ExportFormat, label: 'DXF (.dxf)' },
                    ]).map((o) => (
                      <button
                        key={o.fmt}
                        role="menuitem"
                        className="app-menu-item"
                        onClick={() => void handleExport(o.fmt)}
                      >
                        <span style={{ width: 14 }} />
                        <span>{o.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="app-menu-divider" />

              <button
                role="menuitem"
                className="app-menu-item"
                onClick={handleAbout}
              >
                <Info />
                <span>Acerca de GeoUrban</span>
              </button>

              <div className="app-menu-divider" />

              <button
                role="menuitem"
                className="app-menu-item danger"
                onClick={handleExit}
              >
                <LogOut />
                <span>Salir</span>
              </button>
            </div>
          )}
        </div>

        {RIBBON_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`topbar-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(tab.id);
              if (ribbonCollapsed) setRibbonCollapsed(false);
            }}
          >
            {tab.label}
          </button>
        ))}
        <div className="topbar-tab-spacer" />
        <button
          className={`topbar-collapse-btn ${ribbonCollapsed ? 'collapsed' : ''}`}
          onClick={() => setRibbonCollapsed(!ribbonCollapsed)}
          data-tooltip={ribbonCollapsed ? 'Expandir cinta' : 'Contraer cinta'}
          aria-label={ribbonCollapsed ? 'Expandir cinta' : 'Contraer cinta'}
          title={ribbonCollapsed ? 'Expandir cinta' : 'Contraer cinta'}
        >
          <ChevronUp />
        </button>
      </div>

      {/* ═══════════════ RIBBON PANELS ═══════════════ */}
      {!ribbonCollapsed && (
        <RibbonContext.Provider value={{ currentMode: mode, setMode }}>
          <div className="topbar-ribbon">
          {/* ─── MAP TAB ─── */}
          {activeTab === 'map' && (
            <>
              <RibbonGroup label="Navegación">
                <RibbonTool
                  mode="select"
                  icon={<IconCursor />}
                  label="Seleccionar"
                  shortcut="V"
                />
                <RibbonTool
                  mode="erase"
                  icon={<IconEraser />}
                  label="Borrar"
                  shortcut="E"
                />
              </RibbonGroup>

              <RibbonGroup label="Dibujo">
                <RibbonTool mode="polygon" icon={<IconPolygon />} label="Polígono" shortcut="P" />
                <RibbonTool mode="line" icon={<IconLine />} label="Línea" shortcut="L" />
                <RibbonTool mode="rectangle" icon={<IconRect />} label="Rectángulo" shortcut="R" />
                <RibbonTool mode="circle" icon={<IconCircle />} label="Círculo" shortcut="C" />
                <RibbonTool mode="arc" icon={<IconArc />} label="Arco" shortcut="A" />
                <RibbonTool mode="text" icon={<IconText />} label="Texto" shortcut="X" />
              </RibbonGroup>

              <RibbonGroup label="Modificar">
                <RibbonTool
                  icon={<IconCopy />}
                  label="Copiar"
                  shortcut="Ctrl+D"
                  disabled={selectedCount === 0}
                  onClick={handleCopy}
                />
                <RibbonTool
                  icon={<IconRotate />}
                  label="Rotar"
                  shortcut="H"
                  disabled={selectedCount === 0}
                  active={mode === 'rotate'}
                  onClick={handleRotate}
                />
                <RibbonTool
                  icon={<IconScale />}
                  label="Escalar"
                  shortcut="K"
                  disabled={selectedCount === 0}
                  active={mode === 'scale'}
                  onClick={handleScale}
                />
                <RibbonTool
                  icon={<IconMirror />}
                  label="Reflejar"
                  shortcut="M"
                  disabled={selectedCount === 0}
                  active={mode === 'mirror'}
                  onClick={handleMirror}
                />
              </RibbonGroup>

              <RibbonGroup label="Edición">
                <RibbonTool
                  icon={<IconMerge />}
                  label="Fusionar"
                  disabled={selectedCount < 2 || mergeBusy}
                  onClick={handleMergeSelected}
                />
                <RibbonTool
                  icon={<IconEdit />}
                  label="Vértices"
                  disabled={!primarySelected}
                  active={mode === 'edit'}
                  onClick={handleToggleEdit}
                />
                <RibbonTool
                  icon={<Trash2 />}
                  label="Eliminar"
                  disabled={selectedCount === 0}
                  badge={selectedCount > 0 ? selectedCount : undefined}
                  onClick={handleDeleteSelected}
                />
              </RibbonGroup>

              <RibbonGroup label="Subdivisión">
                <RibbonTool
                  icon={<IconSubdivide />}
                  label="Subdividir"
                  disabled={!primarySelected}
                  onClick={handleOpenSubdivision}
                />
                <RibbonTool
                  icon={<IconLots />}
                  label="Gen. Lotes"
                  disabled={lotsBusy}
                  onClick={handleGenerateLots}
                />
              </RibbonGroup>

              <RibbonGroup label="Calles">
                <RibbonTool
                  mode="street"
                  icon={<IconStreet />}
                  label="Trazar calle"
                  shortcut="S"
                  active={mode === 'street'}
                />
                <div className="ribbon-inline-control">
                  <input
                    type="number"
                    className="ribbon-inline-input"
                    value={defaultWidthM}
                    min={1}
                    max={50}
                    step={1}
                    onChange={(e) => setDefaultWidth(parseFloat(e.target.value) || 8)}
                    title="Ancho de vía (m)"
                    aria-label="Ancho de vía en metros"
                  />
                  <span className="ribbon-inline-text">Ancho (m) · {streets.length} trazadas</span>
                </div>
                {streets.length > 0 && (
                  <button
                    className="ribbon-tool small"
                    onClick={clearStreets}
                    style={{ color: 'var(--cad-accent-red)' }}
                    data-tooltip="Limpiar todas las calles"
                    title="Limpiar todas las calles"
                  >
                    <Trash2 />
                    <span className="ribbon-tool-label">Limpiar</span>
                  </button>
                )}
              </RibbonGroup>
            </>
          )}

          {/* ─── EDIT TAB ─── */}
          {activeTab === 'edit' && (
            <>
              <RibbonGroup label="Selección">
                <RibbonTool
                  mode="select"
                  icon={<IconCursor />}
                  label="Seleccionar"
                  shortcut="V"
                />
                <RibbonTool
                  mode="edit"
                  icon={<IconEdit />}
                  label="Editar vértices"
                  disabled={!primarySelected}
                  active={mode === 'edit'}
                  onClick={handleToggleEdit}
                />
                <RibbonTool
                  icon={<IconRectDashed />}
                  label="Rect"
                  active={selectMode === 'rect'}
                  onClick={() => { useDrawStore.getState().setMode('select'); setSelectMode('rect'); }}
                  shortcut="Shft+R"
                />
                <RibbonTool
                  icon={<IconLasso />}
                  label="Lazo"
                  active={selectMode === 'lasso'}
                  onClick={() => { useDrawStore.getState().setMode('select'); setSelectMode('lasso'); }}
                  shortcut="Shft+L"
                />
              </RibbonGroup>
              <RibbonGroup label="Transformar">
                <RibbonTool icon={<IconCopy />} label="Copiar" shortcut="Ctrl+D" disabled={selectedCount === 0} onClick={handleCopy} />
                <RibbonTool icon={<IconRotate />} label="Rotar" shortcut="H" disabled={selectedCount === 0} active={mode === 'rotate'} onClick={handleRotate} />
                <RibbonTool icon={<IconScale />} label="Escalar" shortcut="K" disabled={selectedCount === 0} active={mode === 'scale'} onClick={handleScale} />
                <RibbonTool icon={<IconMirror />} label="Reflejar" shortcut="M" disabled={selectedCount === 0} active={mode === 'mirror'} onClick={handleMirror} />
              </RibbonGroup>
              <RibbonGroup label="Topología">
                <RibbonTool icon={<IconMerge />} label="Fusionar" disabled={selectedCount < 2 || mergeBusy} onClick={handleMergeSelected} />
                <RibbonTool icon={<Trash2 />} label="Eliminar" disabled={selectedCount === 0} badge={selectedCount > 0 ? selectedCount : undefined} onClick={handleDeleteSelected} />
              </RibbonGroup>
              <RibbonGroup label="Validación">
                <RibbonTool icon={<IconAlertTriangle />} label="Overlaps" onClick={handleFindOverlaps} data-tooltip="Detectar superposiciones entre lotes/manzanos" />
                <RibbonTool icon={<IconAlertCircle />} label="Huecos" onClick={handleFindGaps} data-tooltip="Detectar huecos entre manzanos" />
              </RibbonGroup>
            </>
          )}

          {/* ─── INSERT TAB ─── */}
          {activeTab === 'insert' && (
            <>
              <RibbonGroup label="Geometría">
                <RibbonTool mode="polygon" icon={<IconPolygon />} label="Polígono" shortcut="P" />
                <RibbonTool mode="line" icon={<IconLine />} label="Línea" shortcut="L" />
                <RibbonTool mode="rectangle" icon={<IconRect />} label="Rectángulo" shortcut="R" />
                <RibbonTool mode="circle" icon={<IconCircle />} label="Círculo" shortcut="C" />
                <RibbonTool mode="arc" icon={<IconArc />} label="Arco" shortcut="A" />
                <RibbonTool mode="text" icon={<IconText />} label="Texto" shortcut="X" />
                <RibbonTool
                  icon={<IconGreen />}
                  label="Área verde"
                  shortcut="Shift+G"
                  onClick={() => { setAreaKind('area_verde'); setMode('polygon'); }}
                  data-tooltip="Crear área verde (Shift+G)"
                />
                <RibbonTool
                  icon={<IconEquip />}
                  label="Equipamiento"
                  shortcut="Shift+E"
                  onClick={() => { setAreaKind('equipamiento'); setMode('polygon'); }}
                  data-tooltip="Crear equipamiento (Shift+E)"
                />
              </RibbonGroup>
              <RibbonGroup label="Vialidad">
                <RibbonTool mode="street" icon={<IconStreet />} label="Trazar calle" shortcut="S" active={mode === 'street'} />
                <div className="ribbon-inline-control">
                  <input
                    type="number"
                    className="ribbon-inline-input"
                    value={defaultWidthM}
                    min={1}
                    max={50}
                    step={1}
                    onChange={(e) => setDefaultWidth(parseFloat(e.target.value) || 8)}
                    title="Ancho de vía (m)"
                    aria-label="Ancho de vía en metros"
                  />
                  <span className="ribbon-inline-text">Ancho (m)</span>
                </div>
              </RibbonGroup>
              <RibbonGroup label="Subdivisión">
                <RibbonTool icon={<IconSubdivide />} label="Subdividir" disabled={!primarySelected} onClick={handleOpenSubdivision} />
                <RibbonTool icon={<IconLots />} label="Gen. Lotes" disabled={lotsBusy} onClick={handleGenerateLots} />
              </RibbonGroup>
            </>
          )}

          {/* ─── VIEW TAB ─── */}
          {activeTab === 'view' && (
            <>
              <RibbonGroup label="Mapa base">
                {(Object.keys(BASE_MAP_DEFS) as BaseMapId[]).map((id) => {
                  const def = BASE_MAP_DEFS.find((d) => d.id === id);
                  if (!def) return null;
                  const icon =
                    def.id === 'cad' ? <IconGrid /> :
                    def.id === 'googleSatellite' ? <IconSat /> :
                    def.id === 'googleRoadmap' ? <IconRoad /> :
                    <IconGrid />;
                  return (
                    <RibbonTool
                      key={def.id}
                      icon={icon}
                      label={def.label}
                      active={baseMap === def.id}
                      onClick={() => setBaseMap(def.id)}
                    />
                  );
                })}
              </RibbonGroup>
              <RibbonGroup label="Capas">
                <RibbonTool
                  icon={<LayersIcon />}
                  label="Lotes"
                  active={workVisibility.lots}
                  onClick={() => setWorkVisibility('lots', !workVisibility.lots)}
                />
                <RibbonTool
                  icon={<IconStreet />}
                  label="Calles"
                  active={workVisibility.streets}
                  onClick={() => setWorkVisibility('streets', !workVisibility.streets)}
                />
                <RibbonTool
                  icon={<Settings2 />}
                  label="Cotas"
                  active={workVisibility.measurements}
                  onClick={() => setWorkVisibility('measurements', !workVisibility.measurements)}
                />
              </RibbonGroup>
              <RibbonGroup label="Paneles">
                <RibbonTool
                  icon={<BarChart3 />}
                  label="Estadísticas"
                  active={statsPanelVisible}
                  onClick={() => setStatsPanelVisible(!statsPanelVisible)}
                />
                <RibbonTool
                  icon={<IconCursor />}
                  label="Propiedades"
                  active={propsPanelVisible}
                  onClick={() => useLayerStore.getState().setPanelVisibility('properties', !propsPanelVisible)}
                />
              </RibbonGroup>
            </>
          )}
          </div>
        </RibbonContext.Provider>
      )}
    </div>
  );
}
