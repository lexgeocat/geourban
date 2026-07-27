import { useState, type ChangeEvent, type RefObject } from 'react';
import { useMapStore } from '../store/map/mapStore';
import { resetIncrementalRoadTracking } from '../geo/recomputeManzanos';
import { useCurrentProjectStore } from '../store/project/currentProjectStore';
import { useUiShellStore } from '../store/ui/uiShellStore';
import { useCommandStack } from '../commands/core/CommandStack';
import { ClearFeaturesCommand } from '../commands/features/ClearFeaturesCommand';
import { AddFeaturesCommand } from '../commands/features/AddFeaturesCommand';
import { useSelectionStore } from '../store/map/selectionStore';
import { useSubdivisionStore } from '../store/ui/subdivisionStore';
import { useStreetStore } from '../store/entities/streetStore';
import { useRoundaboutStore } from '../store/entities/roundaboutStore';
import { useManzanoStore } from '../store/entities/manzanoStore';
import { useLayersStore } from '../store/entities/layersRegistryStore';
import { useDrawStore } from '../store/map/drawStore';
import { GenerateLotsCommand } from '../commands/lots/GenerateLotsCommand';
import {
  importFile,
  exportProject,
  writeProjectFromOlFeatures,
  readOlFeaturesFromProject,
  type ExportFormat,
} from '../io';
import { refreshSourceMetrics } from '../geo/metrics';
import { useProjectCrsStore, getProjectCrsConfig } from '../store/project/projectCrsStore';
import { getFeatureKind } from '../core/objectModel';
import type { GeoUrbanProject } from '../io/types';

export function useTopBarActions(fileInputRef: RefObject<HTMLInputElement | null>) {
  const [lotsBusy, setLotsBusy] = useState(false);
  const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);

  const getCurrentProject = (): GeoUrbanProject => {
    const drawSource = useMapStore.getState().drawSource;
    const baseMap = useUiShellStore.getState().baseMap;
    const viewConfig = useMapStore.getState().viewConfig;
    const features = drawSource?.getFeatures() ?? [];
    const project = writeProjectFromOlFeatures(features);
    project.name = 'Proyecto GeoUrban';
    project.baseMap = baseMap;
    project.view = { center: viewConfig.center, zoom: viewConfig.zoom };
    project.crs = getProjectCrsConfig();
    // Fase 2 (persistencia): antes esto nunca se volcaba a project.layers
    // — nombres/colores/opacidades/bloqueos custom se perdían en cada
    // guardado/exportación (ver diagnóstico §2.1).
    project.layers = useLayersStore.getState().layers;
    project.activeLayerId = useLayersStore.getState().activeLayerId;
    return project;
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const drawSource = useMapStore.getState().drawSource;
    if (!file || !drawSource) return;
    try {
      const { project, warnings } = await importFile(file);
      if (file.name.toLowerCase().endsWith('.geourban')) {
        useProjectCrsStore.getState().loadConfig(project.crs);
      }

      // Fase 2 (persistencia): el registro de capas se restaura ANTES de
      // agregar los features, así resolveLayerId() (fallback para
      // features sin layerId propio) resuelve contra las capas del
      // proyecto que se está abriendo, no contra las que había antes.
      useLayersStore.getState().loadLayers(project.layers ?? [], project.activeLayerId ?? null);

      const features = readOlFeaturesFromProject(project);
      const commandStack = useCommandStack.getState();
      await commandStack.run(new ClearFeaturesCommand());
      await commandStack.run(new AddFeaturesCommand(features));

      // Reconciliación de huérfanos: layerId que no resuelven a ninguna
      // capa del registro recién cargado se mueven a "Sin capa".
      const orphanCount = useLayersStore.getState().reconcileOrphanFeatures(features);

      refreshSourceMetrics(drawSource);
      drawSource.changed();
      useMapStore.getState().fitToExtent();

      const allWarnings = [...warnings];
      if (orphanCount > 0) {
        allWarnings.push(`${orphanCount} elemento(s) pertenecían a capas que ya no existen — se reasignaron a "Sin capa".`);
      }
      if (allWarnings.length) alert(allWarnings.join('\n'));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Error al importar archivo');
    } finally {
      event.target.value = '';
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleExportPng = async () => {
    try {
      const map = useMapStore.getState().mapInstance;
      if (!map) throw new Error('Mapa no inicializado');
      await new Promise<void>((resolve) => {
        map.once('rendercomplete', () => {
          const canvas = map.getViewport().querySelector('canvas') as HTMLCanvasElement;
          if (canvas) {
            canvas.toBlob((blob) => {
              if (blob) {
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = 'geourban-proyecto.png';
                anchor.click();
                URL.revokeObjectURL(url);
              }
              resolve();
            }, 'image/png');
          } else {
            resolve();
          }
        });
        map.renderSync();
      });
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Error al exportar PNG');
    }
  };

  const handleExport = async (format: ExportFormat) => {
    try {
      if (format === 'png') {
        await handleExportPng();
        return;
      }
      const result = await exportProject(getCurrentProject(), format, 'geourban-proyecto');
      if (result?.message) alert(result.message);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Error al exportar');
    }
  };

  const handleSave = async () => {
    await handleExport('geourban');
  };

  const handleNewProject = async () => {
    const drawSource = useMapStore.getState().drawSource;
    const ok = window.confirm(
      '¿Crear un nuevo proyecto? Se borrarán todos los features del mapa actual.',
    );
    if (!ok || !drawSource) return;
    await useCommandStack.getState().run(new ClearFeaturesCommand());
    useStreetStore.getState().clearStreets();
    useRoundaboutStore.getState().clearRoundabouts();
    resetIncrementalRoadTracking();
    useLayersStore.getState().resetToDefaults();
    refreshSourceMetrics(drawSource);
    drawSource.changed();
    useSelectionStore.getState().clear();
    useCurrentProjectStore.getState().setCurrentProjectId(null);
  };

  const handleProjectOpen = async (project: GeoUrbanProject) => {
    setProjectBrowserOpen(false);
    const drawSource = useMapStore.getState().drawSource;
    if (!drawSource) return;
    try {
      useLayersStore.getState().loadLayers(project.layers ?? [], project.activeLayerId ?? null);

      const features = readOlFeaturesFromProject(project);
      const commandStack = useCommandStack.getState();
      await commandStack.run(new ClearFeaturesCommand());
      await commandStack.run(new AddFeaturesCommand(features));

      const orphanCount = useLayersStore.getState().reconcileOrphanFeatures(features);

      refreshSourceMetrics(drawSource);
      drawSource.changed();
      useMapStore.getState().fitToExtent();
      useCurrentProjectStore.getState().setCurrentProjectId(
        typeof project.id === 'number' ? project.id : null,
      );
      if (orphanCount > 0) {
        alert(`${orphanCount} elemento(s) pertenecían a capas que ya no existen — se reasignaron a "Sin capa".`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al abrir proyecto');
    }
  };

  const handleExit = () => {
    window.alert('GeoUrban se ejecuta en el navegador. Para salir, cerrá la pestaña o la ventana.');
  };

  const handleAbout = () => {
    window.alert(
      'GeoUrban v0.1\n\nEditor CAD/GIS client-side para planificación urbana.\nConstruido con React + TypeScript + OpenLayers + Tauri.\n\n© 2026',
    );
  };

  const handleDeleteSelected = () => {
    const primarySelected = useSelectionStore.getState().primaryId !== null;
    const removed = useMapStore.getState().deleteSelected();
    if (removed === 0 && primarySelected) {
      useSelectionStore.getState().clear();
    }
  };

  const handleFindOverlaps = async () => {
    const src = useMapStore.getState().drawSource;
    if (!src) return;
    try {
      const GeoJSON = (await import('ol/format/GeoJSON')).default;
      const format = new GeoJSON();
      const features = src.getFeatures().map((f) =>
        format.writeFeatureObject(f, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:3857' }),
      );
      const { findOverlapsInWorker } = await import('../workers/geoWorkerClient');
      const overlaps = await findOverlapsInWorker({ type: 'FeatureCollection', features });
      if (overlaps.length > 0) {
        alert(
          `Se detectaron ${overlaps.length} superposiciones:\n${overlaps
            .map((o: any) => `Lote ${o.indexA} ↔ Lote ${o.indexB}: ${o.area.toFixed(2)} m²`)
            .join('\n')}`,
        );
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
      const features = src.getFeatures().map((f) =>
        format.writeFeatureObject(f, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:3857' }),
      );
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
    const src = useMapStore.getState().drawSource;
    const feat = src?.getFeatureById(primaryId) as any;
    const openSubdivision = useSubdivisionStore.getState().open;
    if (feat && getFeatureKind(feat) === 'manzana') {
      const { targetAreaM2, frontMinM } = useManzanoStore.getState();
      openSubdivision(primaryId, 'auto', { targetAreaM2, frontMinM });
    } else {
      openSubdivision(primaryId);
    }
  };

  const handleGenerateLots = async () => {
    if (lotsBusy) return;
    const src = useMapStore.getState().drawSource;
    if (!src) return;
    let manzanoCount = 0;
    src.forEachFeature((f) => {
      if (getFeatureKind(f as any) === 'manzana') manzanoCount++;
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
        const k = getFeatureKind(f as any);
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
    const mode = useDrawStore.getState().mode;
    if (mode === 'edit') {
      useDrawStore.getState().setMode('select');
      return;
    }
    const primaryId = useSelectionStore.getState().primaryId;
    if (!primaryId) {
      alert('Seleccioná un polígono para editar sus vértices.');
      return;
    }
    useDrawStore.getState().setMode('edit');
  };

  return {
    lotsBusy,
    projectBrowserOpen,
    setProjectBrowserOpen,
    handleImport,
    handleImportClick,
    handleExport,
    handleSave,
    handleNewProject,
    handleProjectOpen,
    handleExit,
    handleAbout,
    handleDeleteSelected,
    handleFindOverlaps,
    handleFindGaps,
    handleOpenSubdivision,
    handleGenerateLots,
    handleToggleEdit,
  };
}